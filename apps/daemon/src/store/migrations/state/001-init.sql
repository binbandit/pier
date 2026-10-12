-- state.db is precious: decisions and queued writes that GitHub doesn't hold.
-- Backed up before every migration; migrations only go forward.

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  plan_id TEXT,
  account TEXT NOT NULL,
  kind TEXT NOT NULL,
  pr_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  expected_head TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL,
  priority INTEGER NOT NULL,
  send_at TEXT NOT NULL,
  claimed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX outbox_due ON outbox (state, priority, send_at);
CREATE INDEX outbox_pr ON outbox (pr_id);

-- Content-creation writes actually sent, for the per-account hourly budget.
CREATE TABLE write_ledger (
  account TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX write_ledger_account ON write_ledger (account, at);

CREATE TABLE verdict (
  key TEXT NOT NULL,
  semver TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (key, semver)
);

-- An item marked done stays hidden until its cursor changes.
CREATE TABLE done (
  item_key TEXT PRIMARY KEY,
  cursor TEXT NOT NULL,
  done_at TEXT NOT NULL
);

CREATE TABLE setting (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE escape_log (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  reason TEXT NOT NULL,
  at TEXT NOT NULL
);
