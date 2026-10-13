import { homedir } from "node:os";
import { join } from "node:path";

// Where pier keeps its state. PIER_HOME isolates tests and fake mode from the real install.
const home = process.env.PIER_HOME ?? join(homedir(), "Library", "Application Support", "pier");

export const paths = {
  home,
  cacheDb: join(home, "cache.db"),
  stateDb: join(home, "state.db"),
  backups: join(home, "backups"),
  git: join(home, "git"),
  logs: process.env.PIER_HOME ? join(home, "logs") : join(homedir(), "Library", "Logs", "pier"),
};

export const PORT = Number(process.env.PIER_PORT ?? 4477);
export const HOST = "127.0.0.1";
export const ORIGIN = `http://${HOST}:${PORT}`;
/** The Vite dev server always runs one port above the daemon. Allowed only with --dev. */
export const DEV_HOST = `${HOST}:${PORT + 1}`;

export const VERSION = "0.1.0";
