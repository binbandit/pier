import type { Database } from "bun:sqlite";

import { bumpKey } from "@/domain/bumps";
import type { Model } from "@/domain/model";
import type { Scope, SettingsStore } from "@/domain/settings";
import { GitHubError } from "@/github/client";
import type { GitHubPort, NotificationThread } from "@/github/port";
import type { ReleaseRegistry } from "@/registry/release";

// Keeps the model in step with GitHub on a fixed point budget. Loops, per account:
//   search     every 60s; incremental (`updated:>=`) with a full pass every 30 min
//   notify     on GitHub's X-Poll-Interval; free when nothing changed (304)
//   sweep      volatile fields: hot PRs every 60s, the rest every 10 min, 100 per point
//   hydrate    full re-read of PRs that the above marked dirty, 25 at a time
// plus files (REST patches for bot PRs) and registry lookups (release dates, advisories).

export const SEARCH_EVERY_MS = 60_000;
export const FULL_SEARCH_EVERY_MS = 30 * 60_000;
export const HOT_SWEEP_MS = 60_000;
export const WARM_SWEEP_MS = 10 * 60_000;
const OVERLAP_MS = 3 * 60_000;

export type SyncStatus = {
  state: "idle" | "syncing" | "error";
  lastSyncAt: string | null;
  message: string | null;
};

export class SyncEngine {
  private dirty = new Map<string, string>(); // pr id -> reader account
  private hot = new Map<string, number>(); // pr id -> hot until (epoch ms)
  private lastSwept = new Map<string, number>();
  private stopped = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private status: SyncStatus = { state: "idle", lastSyncAt: null, message: null };
  private errors = new Map<string, string>();
  /** Scopes for PRs found before their first hydration, attached once the doc exists. */
  private pendingScopes: [string, string, string][] = [];
  private statusListeners = new Set<() => void>();
  private notificationsSeen = new Set<string>();
  private searching = new Set<string>();
  /** How many open PRs each scope ("account:id") found on its last full search. */
  private found = new Map<string, number>();
  private lastStatusKey = "";

  constructor(
    private readonly model: Model,
    private readonly ports: () => Map<string, GitHubPort>,
    private readonly settings: SettingsStore,
    private readonly registry: ReleaseRegistry,
    private readonly cache: Database,
  ) {}

  start(): void {
    // Docs an older build stored in an older shape get read again, in the background.
    for (const record of this.model.all()) {
      if (record.stale) this.markDirty(record.doc.id, record.reader);
    }
    for (const account of this.ports().keys()) {
      this.loop(`search:${account}`, () => this.searchAll(account), SEARCH_EVERY_MS);
      this.loop(`notify:${account}`, () => this.pollNotifications(account), 60_000);
    }
    this.loop("sweep", () => this.sweep(), 15_000);
    this.loop("hydrate", () => this.hydrate(), 2_000);
    this.loop("files", () => this.fetchFiles(), 5_000);
    this.loop("registry", () => this.lookupReleases(), 10_000);
    this.loop("prune", async () => void this.model.prune(), 6 * 60 * 60_000);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
  }

  /** Called whenever what the status line should say has changed. */
  onStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private statusChanged(): void {
    const s = this.getStatus();
    const key = `${s.state}|${s.lastSyncAt}|${s.message}|${s.pending > 0}`;
    if (key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    for (const listener of this.statusListeners) listener();
  }

  getStatus(): SyncStatus & { trackedPrs: number; pending: number } {
    const message =
      this.errors.size > 0 ? [...this.errors.values()].join("; ") : this.status.message;
    return {
      ...this.status,
      state: this.errors.size > 0 ? "error" : this.dirty.size > 0 ? "syncing" : this.status.state,
      message,
      trackedPrs: this.model.size,
      pending: this.dirty.size,
    };
  }

  /** Open PRs a scope found on its last full search, or null before it has run. */
  foundBy(scope: Scope): number | null {
    return this.found.get(`${scope.account}:${scope.id}`) ?? null;
  }

  /** Something changed on our side (a write landed, the PR is on screen): look again soon. */
  nudge(prIds: string[], forMs = 10 * 60_000): void {
    const until = Date.now() + forMs;
    for (const id of prIds) {
      this.hot.set(id, until);
      this.lastSwept.delete(id);
    }
  }

  /** Re-reads the volatile fields of these PRs right now, e.g. just before a bulk write. */
  async refresh(prIds: string[]): Promise<void> {
    const byReader = Map.groupBy(
      prIds.flatMap((id) => this.model.get(id) ?? []),
      (record) => record.reader,
    );
    for (const [reader, records] of byReader) {
      const port = this.ports().get(reader);
      if (!port) continue;
      for (const v of await port.sweep(records.map((r) => r.doc.id))) {
        this.lastSwept.set(v.id, Date.now());
        if (this.model.applyVolatile(v) === "rehydrate") this.markDirty(v.id, reader);
      }
    }
  }

  markDirty(prId: string, reader: string): void {
    const current = this.dirty.get(prId) ?? this.model.get(prId)?.reader;
    this.dirty.set(prId, current && this.rank(current) <= this.rank(reader) ? current : reader);
  }

  private rank(login: string): number {
    const index = [...this.ports().keys()].indexOf(login);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  }

  // -------------------------------------------------------------------------

  private loop(name: string, run: () => Promise<number | void>, everyMs: number): void {
    let failures = 0;
    const tick = async () => {
      if (this.stopped) return;
      let next = everyMs;
      try {
        const override = await run();
        if (typeof override === "number") next = override;
        failures = 0;
        this.errors.delete(name);
      } catch (error) {
        failures++;
        if (failures === 1 && isTransient(error)) {
          // A GitHub hiccup (a 502, a dropped connection) usually clears at once: try again
          // soon, and only say so if it happens twice running.
          next = Math.min(everyMs, TRANSIENT_RETRY_MS);
        } else {
          const wait =
            error instanceof GitHubError && error.retryAfterMs ? error.retryAfterMs : everyMs;
          next = Math.max(everyMs, Math.min(wait, 15 * 60_000));
          this.errors.set(name, describe(name, error));
        }
      }
      this.statusChanged();
      if (!this.stopped) this.timers.push(setTimeout(tick, next));
    };
    void tick();
  }

  private scopesFor(account: string): Scope[] {
    return this.settings.get("scopes").filter((scope) => scope.account === account);
  }

  /** Runs every account's searches now (scopes just changed) rather than on the next pass. */
  searchNow(): void {
    for (const account of this.ports().keys()) {
      this.searchAll(account).catch((error: unknown) =>
        this.errors.set(`search:${account}`, describe("search", error)),
      );
    }
  }

  private async searchAll(account: string): Promise<void> {
    const port = this.ports().get(account);
    // One pass per account at a time: the loop and searchNow can land together.
    if (!port || this.searching.has(account)) return;
    this.searching.add(account);
    try {
      this.status.state = "syncing";
      for (const scope of this.scopesFor(account)) await this.search(port, scope);
      this.status = { state: "idle", lastSyncAt: new Date().toISOString(), message: null };
    } finally {
      this.searching.delete(account);
    }
  }

  private async search(port: GitHubPort, scope: Scope): Promise<void> {
    const cursorKey = `search:${scope.account}:${scope.id}:${hash(scope.query)}`;
    const fullKey = `full:${cursorKey}`;
    const startedAt = Date.now();
    const lastFull = Number(this.cursor(fullKey) ?? 0);
    const watermark = this.cursor(cursorKey);
    const full = !watermark || startedAt - lastFull > FULL_SEARCH_EVERY_MS;
    const since = watermark
      ? new Date(Date.parse(watermark) - OVERLAP_MS).toISOString().slice(0, 19) + "Z"
      : null;
    const query = full || !since ? scope.query : `${scope.query} updated:>=${since}`;

    const hits = await port.search(query);
    for (const hit of hits) {
      const known = this.model.get(hit.id);
      const betterReader = known !== undefined && this.rank(port.login) < this.rank(known.reader);
      if (
        !known ||
        betterReader ||
        known.doc.updatedAt !== hit.updatedAt ||
        known.doc.headRefOid !== hit.headRefOid
      ) {
        this.markDirty(hit.id, port.login);
      }
      if (known) this.model.addScope(hit.id, port.login, scope.id);
      else this.pendingScopes.push([hit.id, port.login, scope.id]);
    }

    if (full) {
      this.found.set(`${scope.account}:${scope.id}`, hits.length);
      // Tracked PRs this scope no longer returns have probably closed; the sweep will confirm.
      const seen = new Set(hits.map((h) => h.id));
      for (const record of this.model.all()) {
        if (
          record.doc.state === "OPEN" &&
          record.scopes.has(`${port.login}:${scope.id}`) &&
          !seen.has(record.doc.id)
        ) {
          this.nudge([record.doc.id], 60_000);
        }
      }
      this.setCursor(fullKey, String(startedAt));
    }
    this.setCursor(cursorKey, new Date(startedAt).toISOString());
  }

  private async pollNotifications(account: string): Promise<number> {
    const port = this.ports().get(account);
    if (!port) return 60_000;
    // The first poll after a start fetches everything; after that, unchanged is a free 304.
    const fresh = !this.notificationsSeen.has(account);
    const poll = await port.notifications(fresh);
    this.notificationsSeen.add(account);
    if (poll.changed) this.rememberThreads(account, poll.threads);
    if (poll.changed) {
      const byRef = new Map<string, string>();
      for (const record of this.model.all())
        byRef.set(`${record.doc.repo}#${record.doc.number}`, record.doc.id);
      let unknownPr = false;
      for (const thread of poll.threads) {
        if (thread.type !== "PullRequest" || thread.number === null) continue;
        const id = byRef.get(`${thread.repo}#${thread.number}`);
        if (id) this.markDirty(id, account);
        else if (thread.unread) unknownPr = true;
      }
      // A notification about a PR we don't track yet: search now rather than in a minute.
      if (unknownPr) await this.searchAll(account);
    }
    return Math.max(60, poll.pollIntervalSec) * 1000;
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    const due = new Map<string, string[]>(); // reader -> ids
    for (const record of this.model.all()) {
      const id = record.doc.id;
      if (record.doc.state !== "OPEN" && !(this.hot.get(id) ?? 0)) continue;
      const isHot = (this.hot.get(id) ?? 0) > now || record.doc.checks.state === "pending";
      const interval = isHot ? HOT_SWEEP_MS : WARM_SWEEP_MS;
      if (now - (this.lastSwept.get(id) ?? Date.parse(record.fetchedAt)) < interval) continue;
      const list = due.get(record.reader) ?? [];
      list.push(id);
      due.set(record.reader, list);
    }
    for (const [reader, ids] of due) {
      const port = this.ports().get(reader);
      if (!port) continue;
      for (const v of await port.sweep(ids.slice(0, 500))) {
        this.lastSwept.set(v.id, now);
        if (this.model.applyVolatile(v) === "rehydrate") this.markDirty(v.id, reader);
      }
    }
    for (const [id, until] of this.hot) if (until < now) this.hot.delete(id);
  }

  private async hydrate(): Promise<void> {
    if (this.dirty.size === 0) return;
    const byReader = Map.groupBy(this.dirty.entries(), ([, reader]) => reader);
    for (const [reader, entries] of byReader) {
      const port = this.ports().get(reader);
      const ids = entries.slice(0, 50).map(([id]) => id);
      if (!port) {
        for (const id of ids) this.dirty.delete(id);
        continue;
      }
      const results = await port.hydrate(ids);
      const found = new Set<string>();
      for (const { doc, viewer } of results) {
        this.model.upsert(doc, viewer, reader);
        found.add(doc.id);
      }
      for (const id of ids) this.dirty.delete(id);
      // Attach scopes discovered before these PRs had docs.
      this.pendingScopes = this.pendingScopes.filter(([id, account, scope]) => {
        if (!found.has(id)) return !ids.includes(id);
        this.model.addScope(id, account, scope);
        return false;
      });
    }
  }

  /** REST files with patches, for bot PRs: needed for the transitive gate and the shown diff. */
  private async fetchFiles(): Promise<void> {
    const wanted = [...this.model.all()].filter(
      (r) => r.doc.state === "OPEN" && r.bot && r.files === null && r.doc.filesTotal <= 300,
    );
    await Promise.all(
      wanted.slice(0, 8).map(async (record) => {
        const port = this.ports().get(record.reader);
        if (!port) return;
        const files = await port.files(record.doc.repo, record.doc.number);
        this.model.setFiles(record.doc.id, record.doc.headRefOid, files);
      }),
    );
  }

  private async lookupReleases(): Promise<void> {
    const seen = new Set<string>();
    const wanted = [];
    for (const record of this.model.all()) {
      if (record.doc.state !== "OPEN" || !record.bot) continue;
      for (const bump of record.bot.bumps) {
        const key = `${bumpKey(bump)}<-${bump.from ?? ""}`;
        if (seen.has(key) || !this.registry.isStale(bump)) continue;
        seen.add(key);
        wanted.push(bump);
      }
    }
    await Promise.all(
      wanted.slice(0, 12).map((bump) => this.registry.lookup(bump).catch(() => null)),
    );
  }

  private rememberThreads(account: string, threads: NotificationThread[]): void {
    const upsert = this.cache.query(
      `INSERT INTO notif_thread (account, thread_id, repo, number, reason, unread, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (account, thread_id) DO UPDATE SET reason = excluded.reason,
         unread = excluded.unread, updated_at = excluded.updated_at`,
    );
    this.cache.transaction(() => {
      for (const t of threads) {
        if (t.type !== "PullRequest" || t.number === null) continue;
        upsert.run(account, t.id, t.repo, t.number, t.reason, t.unread ? 1 : 0, t.updatedAt);
      }
    })();
  }

  /** Notification threads (any account) about this PR, for clearing them when it's done. */
  threadsFor(repo: string, number: number): { account: string; threadId: string }[] {
    return this.cache
      .query<{ account: string; thread_id: string }, [string, number]>(
        "SELECT account, thread_id FROM notif_thread WHERE repo = ? AND number = ?",
      )
      .all(repo, number)
      .map((row) => ({ account: row.account, threadId: row.thread_id }));
  }

  /** This PR's unread notification threads (one account's, or any), now counted as read. */
  takeUnread(
    repo: string,
    number: number,
    account: string | null,
  ): { account: string; threadId: string }[] {
    const rows = this.cache
      .query<{ account: string; thread_id: string }, [string, number]>(
        "SELECT account, thread_id FROM notif_thread WHERE repo = ? AND number = ? AND unread = 1",
      )
      .all(repo, number)
      .filter((row) => account === null || row.account === account);
    const read = this.cache.query(
      "UPDATE notif_thread SET unread = 0 WHERE account = ? AND thread_id = ?",
    );
    for (const row of rows) read.run(row.account, row.thread_id);
    return rows.map((row) => ({ account: row.account, threadId: row.thread_id }));
  }

  /** Forgets a thread once it's been marked done on GitHub. */
  forgetThread(account: string, threadId: string): void {
    this.cache
      .query("DELETE FROM notif_thread WHERE account = ? AND thread_id = ?")
      .run(account, threadId);
  }

  private cursor(key: string): string | null {
    return (
      this.cache
        .query<{ value: string }, [string]>("SELECT value FROM cursor WHERE key = ?")
        .get(key)?.value ?? null
    );
  }

  private setCursor(key: string, value: string): void {
    this.cache
      .query(
        "INSERT INTO cursor (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }
}

const LOOP_NAMES: Record<string, string> = {
  search: "Finding PRs",
  notify: "Reading notifications",
  sweep: "Refreshing CI and merge state",
  hydrate: "Reading PRs",
  files: "Loading diffs",
  registry: "Looking up releases",
};

/** A status-line sentence: what was being done, and what went wrong, without GitHub's HTML. */
const TRANSIENT_RETRY_MS = 10_000;

function isTransient(error: unknown): boolean {
  return error instanceof GitHubError && (error.kind === "server" || error.kind === "network");
}

function describe(loop: string, error: unknown): string {
  const what = LOOP_NAMES[loop.split(":")[0] ?? ""] ?? loop;
  if (error instanceof GitHubError) {
    const why =
      error.kind === "server"
        ? `GitHub returned ${error.status ?? "an error"}`
        : error.kind === "network"
          ? "can't reach GitHub"
          : error.kind === "rate-limit" || error.kind === "secondary-limit"
            ? "rate limited"
            : error.message;
    return `${what} failed: ${why}. Retrying.`;
  }
  return `${what} failed: ${error instanceof Error ? error.message : String(error)}`;
}

function hash(text: string): string {
  return Bun.hash(text).toString(36);
}
