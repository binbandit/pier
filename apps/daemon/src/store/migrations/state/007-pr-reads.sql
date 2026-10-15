CREATE TABLE pr_read (
  pr_id TEXT NOT NULL,
  account TEXT NOT NULL,
  cursor TEXT NOT NULL,
  PRIMARY KEY (pr_id, account)
);
