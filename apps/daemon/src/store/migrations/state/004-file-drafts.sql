-- Drafts can be about a whole file rather than a line. File drafts keep line 0, which the
-- drafts store never shows.
ALTER TABLE draft ADD COLUMN subject TEXT NOT NULL DEFAULT 'line';
