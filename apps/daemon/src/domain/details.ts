import type { Database } from "bun:sqlite";

import type { PrDetail } from "@/github/pr-detail";

// Full-tier detail per PR and account, refetched when the PR's activity timestamp moves, a write
// of ours lands on it, or it's a couple of minutes old: some things you do on github.com (start a
// review, mark a file viewed, react) don't move the timestamp. Only PRs you open are fetched.

const MAX_AGE_MS = 2 * 60_000;
/** Details kept in memory, the most recently read; older ones are read back from the cache db. */
const IN_MEMORY = 200;

type Entry = { detail: PrDetail; updatedAt: string; fetchedAt: number };

export class Details {
  private entries = new Map<string, Entry>();
  private dirty = new Set<string>();

  constructor(private readonly cache: Database) {}

  get(prId: string, account: string): Entry | null {
    const key = `${prId}:${account}`;
    const memory = this.entries.get(key);
    if (memory) {
      this.remember(key, memory);
      return memory;
    }
    const row = this.cache
      .query<{ json: string; updated_at: string; fetched_at: string }, [string, string]>(
        "SELECT json, updated_at, fetched_at FROM pr_detail WHERE pr_id = ? AND account = ?",
      )
      .get(prId, account);
    if (!row) return null;
    const entry = {
      detail: JSON.parse(row.json) as PrDetail,
      updatedAt: row.updated_at,
      fetchedAt: Date.parse(row.fetched_at),
    };
    this.remember(key, entry);
    return entry;
  }

  set(prId: string, account: string, detail: PrDetail, updatedAt: string): void {
    const key = `${prId}:${account}`;
    const fetchedAt = Date.now();
    this.remember(key, { detail, updatedAt, fetchedAt });
    this.dirty.delete(key);
    this.cache
      .query(
        `INSERT INTO pr_detail (pr_id, account, updated_at, fetched_at, json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (pr_id, account) DO UPDATE SET updated_at = excluded.updated_at,
           fetched_at = excluded.fetched_at, json = excluded.json`,
      )
      .run(prId, account, updatedAt, new Date(fetchedAt).toISOString(), JSON.stringify(detail));
  }

  /** Keeps `key` as the most recently used, dropping the least recently used past the limit. */
  private remember(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > IN_MEMORY) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  /** Something we sent changed this PR; the next read refetches. */
  invalidate(prId: string, account: string): void {
    this.dirty.add(`${prId}:${account}`);
  }

  isFresh(prId: string, account: string, updatedAt: string, now = Date.now()): boolean {
    const entry = this.get(prId, account);
    return (
      entry !== null &&
      entry.updatedAt === updatedAt &&
      now - entry.fetchedAt < MAX_AGE_MS &&
      !this.dirty.has(`${prId}:${account}`)
    );
  }
}
