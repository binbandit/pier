-- Inline comments written in pier that haven't been submitted as part of a review yet.
-- They live only here (GitHub's pending review is per user and shared with github.com, so pier
-- submits drafts in one write rather than mirroring them there as you type).
CREATE TABLE draft (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  pr_id TEXT NOT NULL,
  head_oid TEXT NOT NULL,
  path TEXT NOT NULL,
  side TEXT NOT NULL,
  line INTEGER NOT NULL,
  start_line INTEGER,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX draft_pr ON draft (pr_id, account);
