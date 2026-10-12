import type { Database } from "bun:sqlite";

import type { PrDetail } from "@/github/pr-detail";

// Full-tier detail per PR and account, refetched when the PR's activity timestamp moves or a write
// of ours lands on it. Only PRs you actually open are ever fetched at this tier.

type Entry = { detail: PrDetail; updatedAt: string; fetchedAt: number };

export class Details {
  private entries = new Map<string, Entry>();
  private dirty = new Set<string>();

  constructor(private readonly cache: Database) {}

  get(prId: string, account: string): Entry | null {
    const key = `${prId}:${account}`;
    const memory = this.entries.get(key);
    if (memory) return memory;
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
    this.entries.set(key, entry);
    return entry;
  }

  set(prId: string, account: string, detail: PrDetail, updatedAt: string): void {
    const key = `${prId}:${account}`;
    const fetchedAt = Date.now();
    this.entries.set(key, { detail, updatedAt, fetchedAt });
    this.dirty.delete(key);
    this.cache
      .query(
        `INSERT INTO pr_detail (pr_id, account, updated_at, fetched_at, json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (pr_id, account) DO UPDATE SET updated_at = excluded.updated_at,
           fetched_at = excluded.fetched_at, json = excluded.json`,
      )
      .run(prId, account, updatedAt, new Date(fetchedAt).toISOString(), JSON.stringify(detail));
  }

  /** Something we sent changed this PR; the next read refetches. */
  invalidate(prId: string, account: string): void {
    this.dirty.add(`${prId}:${account}`);
  }

  isFresh(prId: string, account: string, updatedAt: string): boolean {
    const entry = this.get(prId, account);
    return entry !== null && entry.updatedAt === updatedAt && !this.dirty.has(`${prId}:${account}`);
  }
}
