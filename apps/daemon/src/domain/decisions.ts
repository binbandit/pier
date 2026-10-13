import type { Database } from "bun:sqlite";

import type { Ecosystem, SemverClass, Verdict } from "@pier/core/wire";

// Brayden's own decisions, which GitHub has no place for: verdicts on bumps, verdicts an advisory
// withdrew, and items marked done.

export class Verdicts {
  version = 0;

  constructor(private readonly db: Database) {}

  /** `known`: the advisories against this version you could see when deciding. */
  record(
    key: string,
    semver: SemverClass,
    ttlDays: number,
    known: string[] = [],
    now = Date.now(),
  ): void {
    this.db
      .query(
        `INSERT INTO verdict (key, semver, decided_at, expires_at, known_advisories)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (key, semver) DO UPDATE SET decided_at = excluded.decided_at,
           expires_at = excluded.expires_at, known_advisories = excluded.known_advisories`,
      )
      .run(
        key,
        semver,
        new Date(now).toISOString(),
        new Date(now + ttlDays * 86_400_000).toISOString(),
        JSON.stringify(known.toSorted()),
      );
    this.version++;
  }

  /** Each version with an unexpired verdict: when it was decided, and what was known then. */
  standing(now = Date.now()): Map<string, { decidedAt: string; known: Set<string> }> {
    const rows = this.db
      .query<{ key: string; decided_at: string; known_advisories: string }, [string]>(
        "SELECT key, decided_at, known_advisories FROM verdict WHERE expires_at > ?",
      )
      .all(new Date(now).toISOString());
    const standing = new Map<string, { decidedAt: string; known: Set<string> }>();
    for (const row of rows) {
      const known = new Set(JSON.parse(row.known_advisories) as string[]);
      const seen = standing.get(row.key);
      // A version decided under two semver classes knows only what both decisions knew.
      standing.set(
        row.key,
        seen
          ? {
              decidedAt: seen.decidedAt < row.decided_at ? seen.decidedAt : row.decided_at,
              known: new Set([...known].filter((id) => seen.known.has(id))),
            }
          : { decidedAt: row.decided_at, known },
      );
    }
    return standing;
  }

  /** Withdraws every verdict on this version. */
  withdraw(key: string): void {
    this.db.query("DELETE FROM verdict WHERE key = ?").run(key);
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

export type StoredRevocation = {
  key: string;
  ecosystem: Ecosystem;
  pkg: string;
  to: string;
  advisories: string[];
  decidedAt: string;
  revokedAt: string;
};

type RevocationRow = {
  key: string;
  ecosystem: Ecosystem;
  pkg: string;
  version: string;
  advisories: string;
  decided_at: string;
  revoked_at: string;
};

function fromRow(row: RevocationRow): StoredRevocation {
  return {
    key: row.key,
    ecosystem: row.ecosystem,
    pkg: row.pkg,
    to: row.version,
    advisories: JSON.parse(row.advisories) as string[],
    decidedAt: row.decided_at,
    revokedAt: row.revoked_at,
  };
}

/** Verdicts an advisory withdrew, kept so the Deps split can say what's left to deal with. */
export class Revocations {
  version = 0;

  constructor(private readonly db: Database) {}

  /** Records the withdrawal; a later advisory against the same version raises it again. */
  record(revocation: Omit<StoredRevocation, "revokedAt">, now = Date.now()): void {
    this.db
      .query(
        `INSERT INTO revocation (key, ecosystem, pkg, version, advisories, decided_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET advisories = excluded.advisories,
           decided_at = excluded.decided_at, revoked_at = excluded.revoked_at, dismissed_at = NULL`,
      )
      .run(
        revocation.key,
        revocation.ecosystem,
        revocation.pkg,
        revocation.to,
        JSON.stringify(revocation.advisories),
        revocation.decidedAt,
        new Date(now).toISOString(),
      );
    this.version++;
  }

  /** Revocations whose notice is still up, newest first. */
  open(): StoredRevocation[] {
    return this.db
      .query<RevocationRow, []>(
        "SELECT * FROM revocation WHERE dismissed_at IS NULL ORDER BY revoked_at DESC",
      )
      .all()
      .map(fromRow);
  }

  /** This version's latest withdrawal, dismissed or not. */
  get(key: string): StoredRevocation | null {
    const row = this.db
      .query<RevocationRow, [string]>("SELECT * FROM revocation WHERE key = ?")
      .get(key);
    return row ? fromRow(row) : null;
  }

  dismiss(key: string, now = Date.now()): void {
    this.db
      .query("UPDATE revocation SET dismissed_at = ? WHERE key = ?")
      .run(new Date(now).toISOString(), key);
    this.version++;
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
