import type { Database } from "bun:sqlite";

import type { SemverClass, Verdict } from "@pier/core/wire";

// Brayden's own decisions, which GitHub has no place for: verdicts on bumps, and items marked done.

export class Verdicts {
  version = 0;

  constructor(private readonly db: Database) {}

  record(key: string, semver: SemverClass, ttlDays: number, now = Date.now()): void {
    this.db
      .query(
        `INSERT INTO verdict (key, semver, decided_at, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (key, semver) DO UPDATE SET decided_at = excluded.decided_at, expires_at = excluded.expires_at`,
      )
      .run(
        key,
        semver,
        new Date(now).toISOString(),
        new Date(now + ttlDays * 86_400_000).toISOString(),
      );
    this.version++;
  }

  /** Unexpired verdicts for a bump key. */
  active(key: string, now = Date.now()): Verdict[] {
    return this.db
      .query<
        { key: string; semver: SemverClass; decided_at: string; expires_at: string },
        [string, string]
      >("SELECT * FROM verdict WHERE key = ? AND expires_at > ?")
      .all(key, new Date(now).toISOString())
      .map((row) => ({
        key: row.key,
        semver: row.semver,
        decidedAt: row.decided_at,
        expiresAt: row.expires_at,
      }));
  }

  covers(key: string, semver: SemverClass, now = Date.now()): Verdict | null {
    return this.active(key, now).find((v) => v.semver === semver) ?? null;
  }
}

/**
 * Done items stay hidden until their cursor changes. The cursor is chosen per item kind so that
 * only meaningful activity brings something back (a new PR joining a bump group does; Dependabot
 * rebasing one doesn't).
 */
export class DoneItems {
  version = 0;

  constructor(private readonly db: Database) {}

  isDone(key: string, cursor: string): boolean {
    const row = this.db
      .query<{ cursor: string }, [string]>("SELECT cursor FROM done WHERE item_key = ?")
      .get(key);
    return row?.cursor === cursor;
  }

  mark(key: string, cursor: string): void {
    this.db
      .query(
        `INSERT INTO done (item_key, cursor, done_at) VALUES (?, ?, ?)
         ON CONFLICT (item_key) DO UPDATE SET cursor = excluded.cursor, done_at = excluded.done_at`,
      )
      .run(key, cursor, new Date().toISOString());
    this.version++;
  }

  undo(key: string): void {
    this.db.query("DELETE FROM done WHERE item_key = ?").run(key);
    this.version++;
  }
}
