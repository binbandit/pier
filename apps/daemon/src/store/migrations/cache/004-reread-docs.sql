-- PR docs gained assignees and milestone. Stored docs get empty values so the inbox stays full,
-- and are flagged so the sync engine reads each one again in the background at the next start.
ALTER TABLE pr_doc ADD COLUMN reread INTEGER NOT NULL DEFAULT 0;
UPDATE pr_doc SET
  json = json_set(json, '$.assignees', json('[]'), '$.milestone', json('null')),
  reread = 1;
-- The detail timeline now carries assignment, milestone and review-request-removed events.
-- Details are read when a PR opens, so dropping them only costs that read.
DELETE FROM pr_detail;
