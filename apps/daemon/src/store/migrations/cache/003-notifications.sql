-- The latest notification thread per account for each PR, so "done" in pier can clear it on GitHub.
CREATE TABLE notif_thread (
  account TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  reason TEXT NOT NULL,
  unread INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account, thread_id)
);
CREATE INDEX notif_thread_pr ON notif_thread (repo, number);
