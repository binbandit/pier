import type { Database } from "bun:sqlite";

import type { Draft, Side } from "@pier/core/wire";

// Inline comments waiting to go out with your next review. Stored per account and PR, with the
// head commit they were written against so a later push can't silently move them.

type Row = {
  id: string;
  account: string;
  pr_id: string;
  head_oid: string;
  path: string;
  side: Side;
  line: number;
  start_line: number | null;
  subject: "line" | "file";
  body: string;
  created_at: string;
  updated_at: string;
};

export type DraftInput = {
  id?: string | undefined;
  account: string;
  prId: string;
  headOid: string;
  path: string;
  side: Side;
  /** Null for a comment on the whole file. */
  line: number | null;
  startLine: number | null;
  body: string;
};

export class Drafts {
  constructor(private readonly db: Database) {}

  list(prId: string, account: string): Draft[] {
    return this.db
      .query<Row, [string, string]>(
        "SELECT * FROM draft WHERE pr_id = ? AND account = ? ORDER BY created_at",
      )
      .all(prId, account)
      .map((row) => ({
        id: row.id,
        path: row.path,
        side: row.side,
        line: row.subject === "file" ? null : row.line,
        startLine: row.start_line,
        body: row.body,
        headOid: row.head_oid,
        createdAt: row.created_at,
      }));
  }

  /** Creates a draft, or updates its body when `id` is given. Returns the draft id. */
  save(input: DraftInput): string {
    const now = new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    this.db
      .query(
        `INSERT INTO draft (id, account, pr_id, head_oid, path, side, line, start_line, subject, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.account,
        input.prId,
        input.headOid,
        input.path,
        input.side,
        input.line ?? 0,
        input.startLine,
        input.line === null ? "file" : "line",
        input.body,
        now,
        now,
      );
    return id;
  }

  delete(id: string): void {
    this.db.query("DELETE FROM draft WHERE id = ?").run(id);
  }

  /** Called once a review carrying these drafts has been accepted by GitHub. */
  clear(prId: string, account: string, ids: string[]): void {
    const placeholders = ids.map(() => "?").join(",");
    if (ids.length === 0) return;
    this.db
      .query(`DELETE FROM draft WHERE pr_id = ? AND account = ? AND id IN (${placeholders})`)
      .run(prId, account, ...ids);
  }
}
