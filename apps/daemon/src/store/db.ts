import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { paths } from "@/config";

import cache001 from "./migrations/cache/001-init.sql" with { type: "text" };
import state001 from "./migrations/state/001-init.sql" with { type: "text" };

// Migrations are applied in order; `PRAGMA user_version` records how many have run.
// Append new files to these lists, never edit or reorder existing ones.
const CACHE_MIGRATIONS = [cache001];
const STATE_MIGRATIONS = [state001];

export type Stores = { cache: Database; state: Database };

export function openStores(): Stores {
  mkdirSync(paths.home, { recursive: true });
  return { cache: openCache(paths.cacheDb), state: openState(paths.stateDb) };
}

/** In-memory stores for tests. */
export function memoryStores(): Stores {
  const cache = configure(new Database(":memory:", { strict: true }));
  const state = configure(new Database(":memory:", { strict: true }));
  migrate(cache, CACHE_MIGRATIONS);
  migrate(state, STATE_MIGRATIONS);
  return { cache, state };
}

function configure(db: Database): Database {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

/** The cache can always be rebuilt from GitHub, so a failed migration just starts it over. */
function openCache(file: string): Database {
  try {
    const db = configure(new Database(file, { create: true, strict: true }));
    migrate(db, CACHE_MIGRATIONS);
    return db;
  } catch (error) {
    console.warn(`cache.db could not be migrated, rebuilding it: ${String(error)}`);
    for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
    const db = configure(new Database(file, { create: true, strict: true }));
    migrate(db, CACHE_MIGRATIONS);
    return db;
  }
}

/** State holds decisions and queued writes, so it is backed up before any migration runs. */
function openState(file: string): Database {
  const db = configure(new Database(file, { create: true, strict: true }));
  if (pendingMigrations(db, STATE_MIGRATIONS) > 0 && version(db) > 0) backup(db, "pre-migration");
  migrate(db, STATE_MIGRATIONS);
  return db;
}

export function backup(db: Database, label: string): string {
  mkdirSync(paths.backups, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const target = join(paths.backups, `state-${stamp}-${label}.db`);
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  return target;
}

function version(db: Database): number {
  const row = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
  return row?.user_version ?? 0;
}

function pendingMigrations(db: Database, migrations: string[]): number {
  return migrations.length - version(db);
}

function migrate(db: Database, migrations: string[]): void {
  const current = version(db);
  if (current > migrations.length) {
    throw new Error(
      `database is at version ${current}, newer than this build (${migrations.length})`,
    );
  }
  for (const [index, sql] of migrations.entries()) {
    if (index < current) continue;
    db.transaction(() => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    })();
  }
}
