import type { Database } from "bun:sqlite";

import type { PrDoc, PrViewer, VolatileState } from "@/github/pr-doc";
import type { DiffFile } from "@pier/core/wire";

import { type ParsedBotPr, parseBotPr } from "./bumps";

// The live picture of every tracked PR. cache.db is its persistence; this map is what views are
// derived from, so reads never touch SQLite or the network. Every change bumps `version`, which
// lets derived views memoise until something actually moves.

export type PrRecord = {
  doc: PrDoc;
  reader: string;
  fetchedAt: string;
  /** Stored by an older build in an older shape: usable, but due a fresh read. */
  stale: boolean;
  viewers: Map<string, PrViewer>;
  /** `${account}:${scopeId}` entries that found this PR. */
  scopes: Set<string>;
  /** Files with patches at the current head, once fetched. */
  files: DiffFile[] | null;
  bot: ParsedBotPr | null;
};

export type VolatileResult = "unchanged" | "patched" | "rehydrate";

/** How long closed and merged PRs stay around (for In flight and undo context). */
const CLOSED_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export class Model {
  private records = new Map<string, PrRecord>();
  private listeners = new Set<(ids: string[]) => void>();
  version = 0;

  /**
   * @param rank Lower is preferred. When several accounts can read a PR, the preferred one
   *   reads (and acts on) it, so the choice never depends on which search finished first.
   */
  constructor(
    private readonly cache: Database,
    private readonly rank: (login: string) => number = () => 0,
  ) {
    this.load();
  }

  get(id: string): PrRecord | undefined {
    return this.records.get(id);
  }

  all(): IterableIterator<PrRecord> {
    return this.records.values();
  }

  get size() {
    return this.records.size;
  }

  /** Called with the ids that changed, after every mutation. */
  onChange(listener: (ids: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  upsert(doc: PrDoc, viewer: PrViewer, reader: string): void {
    const existing = this.records.get(doc.id);
    const fetchedAt = new Date().toISOString();
    const keepReader = existing && this.rank(existing.reader) <= this.rank(reader);
    const record: PrRecord = {
      doc,
      reader: keepReader ? existing.reader : reader,
      fetchedAt,
      stale: false,
      viewers: existing?.viewers ?? new Map(),
      scopes: existing?.scopes ?? new Set(),
      files:
        existing && existing.doc.headRefOid === doc.headRefOid
          ? existing.files
          : this.loadFiles(doc.id, doc.headRefOid),
      bot: parseBot(doc),
    };
    record.viewers.set(reader, viewer);
    this.records.set(doc.id, record);

    this.cache
      .query(
        `INSERT INTO pr_doc (id, reader, tier, fetched_at, json, reread) VALUES (?, ?, 'bot', ?, ?, 0)
         ON CONFLICT (id) DO UPDATE SET reader = excluded.reader, tier = excluded.tier,
           fetched_at = excluded.fetched_at, json = excluded.json, reread = 0`,
      )
      .run(doc.id, record.reader, fetchedAt, JSON.stringify(doc));
    this.cache
      .query(
        `INSERT INTO pr_viewer (pr_id, account, json) VALUES (?, ?, ?)
         ON CONFLICT (pr_id, account) DO UPDATE SET json = excluded.json`,
      )
      .run(doc.id, reader, JSON.stringify(viewer));
    this.changed([doc.id]);
  }

  /**
   * Applies swept fields. Head or activity changes need a full re-read; anything else (CI state,
   * mergeability, auto-merge) is patched in place, which costs nothing extra.
   */
  applyVolatile(v: VolatileState): VolatileResult {
    const record = this.records.get(v.id);
    if (!record) return "rehydrate";
    const doc = record.doc;
    if (
      doc.headRefOid !== v.headRefOid ||
      doc.updatedAt !== v.updatedAt ||
      doc.checks.state !== v.rollup
    ) {
      return "rehydrate";
    }
    const same =
      doc.state === v.state &&
      doc.isDraft === v.isDraft &&
      doc.mergeable === v.mergeable &&
      doc.mergeStateStatus === v.mergeStateStatus &&
      doc.reviewDecision === v.reviewDecision &&
      Boolean(doc.autoMerge) === Boolean(v.autoMerge) &&
      doc.mergeQueue?.state === v.mergeQueue?.state;
    if (same) return "unchanged";

    const next: PrDoc = {
      ...doc,
      state: v.state,
      isDraft: v.isDraft,
      mergeable: v.mergeable,
      mergeStateStatus: v.mergeStateStatus,
      reviewDecision: v.reviewDecision,
      autoMerge: v.autoMerge
        ? { enabledAt: v.autoMerge.enabledAt, method: doc.autoMerge?.method ?? "MERGE" }
        : null,
      mergeQueue: v.mergeQueue,
    };
    record.doc = next;
    this.cache.query("UPDATE pr_doc SET json = ? WHERE id = ?").run(JSON.stringify(next), next.id);
    this.changed([next.id]);
    return "patched";
  }

  setFiles(id: string, headOid: string, files: DiffFile[]): void {
    this.cache
      .query(
        `INSERT INTO pr_files (pr_id, head_oid, json) VALUES (?, ?, ?)
         ON CONFLICT (pr_id, head_oid) DO UPDATE SET json = excluded.json`,
      )
      .run(id, headOid, JSON.stringify(files));
    const record = this.records.get(id);
    if (record && record.doc.headRefOid === headOid) {
      record.files = files;
      this.changed([id]);
    }
  }

  addScope(id: string, account: string, scopeId: string): void {
    const record = this.records.get(id);
    const entry = `${account}:${scopeId}`;
    if (record) record.scopes.add(entry);
    this.cache
      .query(
        `INSERT INTO pr_scope (pr_id, account, scope, seen_at) VALUES (?, ?, ?, ?)
         ON CONFLICT DO UPDATE SET seen_at = excluded.seen_at`,
      )
      .run(id, account, scopeId, new Date().toISOString());
  }

  /** Drops closed PRs past retention, along with their cached files. */
  prune(now = Date.now()): number {
    const gone: string[] = [];
    for (const record of this.records.values()) {
      if (record.doc.state === "OPEN") continue;
      if (now - Date.parse(record.fetchedAt) > CLOSED_RETENTION_MS) gone.push(record.doc.id);
    }
    for (const id of gone) {
      this.records.delete(id);
      for (const table of ["pr_doc", "pr_viewer", "pr_scope", "pr_files"]) {
        this.cache
          .query(`DELETE FROM ${table} WHERE ${table === "pr_doc" ? "id" : "pr_id"} = ?`)
          .run(id);
      }
    }
    if (gone.length > 0) this.changed(gone);
    return gone.length;
  }

  // -------------------------------------------------------------------------

  private load(): void {
    const docs = this.cache
      .query<{ id: string; reader: string; fetched_at: string; json: string; reread: number }, []>(
        "SELECT id, reader, fetched_at, json, reread FROM pr_doc",
      )
      .all();
    for (const row of docs) {
      const doc = JSON.parse(row.json) as PrDoc;
      this.records.set(row.id, {
        doc,
        reader: row.reader,
        fetchedAt: row.fetched_at,
        stale: row.reread === 1,
        viewers: new Map(),
        scopes: new Set(),
        files: this.loadFiles(row.id, doc.headRefOid),
        bot: parseBot(doc),
      });
    }
    for (const row of this.cache
      .query<{ pr_id: string; account: string; json: string }, []>("SELECT * FROM pr_viewer")
      .all()) {
      this.records.get(row.pr_id)?.viewers.set(row.account, JSON.parse(row.json) as PrViewer);
    }
    for (const row of this.cache
      .query<{ pr_id: string; account: string; scope: string }, []>(
        "SELECT pr_id, account, scope FROM pr_scope",
      )
      .all()) {
      this.records.get(row.pr_id)?.scopes.add(`${row.account}:${row.scope}`);
    }
  }

  private loadFiles(id: string, headOid: string): DiffFile[] | null {
    const row = this.cache
      .query<{ json: string }, [string, string]>(
        "SELECT json FROM pr_files WHERE pr_id = ? AND head_oid = ?",
      )
      .get(id, headOid);
    return row ? (JSON.parse(row.json) as DiffFile[]) : null;
  }

  private changed(ids: string[]): void {
    this.version++;
    for (const listener of this.listeners) listener(ids);
  }
}

function parseBot(doc: PrDoc): ParsedBotPr | null {
  return parseBotPr({
    title: doc.title,
    body: doc.body,
    headRefName: doc.headRefName,
    authorLogin: doc.author?.login ?? null,
    commitMessages: doc.commits.map((c) => c.message),
    files: doc.files.map((f) => f.path),
  });
}
