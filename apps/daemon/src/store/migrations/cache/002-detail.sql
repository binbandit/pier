-- Full-tier detail (threads, reviews, timeline) for PRs that have been opened, per account.
CREATE TABLE pr_detail (
  pr_id TEXT NOT NULL,
  account TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (pr_id, account)
);
