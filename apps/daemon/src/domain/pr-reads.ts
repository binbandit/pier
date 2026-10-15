import type { Database } from "bun:sqlite";

import { type PrDoc, volatileHash, volatileOf } from "@/github/pr-doc";
import type { PrActivity } from "@pier/core/wire";

/** CI and merge state can change without GitHub moving updatedAt. */
export function prActivityCursor(doc: PrDoc): string {
  return JSON.stringify([
    volatileHash(volatileOf(doc)),
    doc.checks.contexts.map(({ name, state }) => `${name}:${state}`).toSorted(),
  ]);
}

/** What was actually displayed, independent of GitHub notifications and items marked done. */
export class PrReads {
  version = 0;

  constructor(private readonly db: Database) {}

  activity(doc: PrDoc, account: string): PrActivity {
    const row = this.db
      .query<{ cursor: string }, [string, string]>(
        "SELECT cursor FROM pr_read WHERE pr_id = ? AND account = ?",
      )
      .get(doc.id, account);
    if (!row) return "new";
    return row.cursor === prActivityCursor(doc) ? "read" : "updated";
  }

  mark(doc: PrDoc, account: string, cursor: string): boolean {
    // A late acknowledgement of an old page must not hide an update that arrived meanwhile.
    if (cursor !== prActivityCursor(doc) || this.activity(doc, account) === "read") return false;
    this.db
      .query(
        `INSERT INTO pr_read (pr_id, account, cursor) VALUES (?, ?, ?)
         ON CONFLICT (pr_id, account) DO UPDATE SET cursor = excluded.cursor`,
      )
      .run(doc.id, account, cursor);
    this.version++;
    return true;
  }
}
