-- Approvals that wait for another PR in the same repo to merge first (one merge in flight per repo).
ALTER TABLE outbox ADD COLUMN after_pr TEXT;
