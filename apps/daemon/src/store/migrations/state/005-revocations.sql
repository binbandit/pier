-- What was known against a version when you decided on it, so only news withdraws the verdict.
ALTER TABLE verdict ADD COLUMN known_advisories TEXT NOT NULL DEFAULT '[]';

-- A verdict withdrawn because an advisory against its version appeared after it was given. The
-- notice stays on the Deps split until dismissed; a later advisory brings it back.
CREATE TABLE revocation (
  key TEXT PRIMARY KEY,
  ecosystem TEXT NOT NULL,
  pkg TEXT NOT NULL,
  version TEXT NOT NULL,
  advisories TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  revoked_at TEXT NOT NULL,
  dismissed_at TEXT
);
