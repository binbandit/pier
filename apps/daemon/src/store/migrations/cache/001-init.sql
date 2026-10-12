-- cache.db is disposable: everything here can be refetched from GitHub.
-- A schema change that can't migrate cleanly just deletes the file and resyncs.

CREATE TABLE pr_doc (
  id TEXT PRIMARY KEY,
  reader TEXT NOT NULL,
  tier TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  json TEXT NOT NULL,
  repo TEXT GENERATED ALWAYS AS (json ->> '$.repo') VIRTUAL,
  state TEXT GENERATED ALWAYS AS (json ->> '$.state') VIRTUAL,
  head_oid TEXT GENERATED ALWAYS AS (json ->> '$.headRefOid') VIRTUAL,
  updated_at TEXT GENERATED ALWAYS AS (json ->> '$.updatedAt') VIRTUAL
);
CREATE INDEX pr_doc_state ON pr_doc (state);

-- Fields that differ per account: your latest review, review requests to you.
CREATE TABLE pr_viewer (
  pr_id TEXT NOT NULL,
  account TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (pr_id, account)
);

-- Which account found a PR through which search scope.
CREATE TABLE pr_scope (
  pr_id TEXT NOT NULL,
  account TEXT NOT NULL,
  scope TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (pr_id, account, scope)
);

-- Changed files with patches, immutable per head commit.
CREATE TABLE pr_files (
  pr_id TEXT NOT NULL,
  head_oid TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (pr_id, head_oid)
);

-- Conditional-request cache for REST GETs (ETag / Last-Modified).
CREATE TABLE http_cache (
  key TEXT PRIMARY KEY,
  etag TEXT,
  last_modified TEXT,
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

-- Package registry lookups (release dates, advisories, install scripts).
CREATE TABLE registry (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE cursor (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
