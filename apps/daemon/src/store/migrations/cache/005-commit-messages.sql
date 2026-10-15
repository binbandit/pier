-- Commit details now include the message body. Refetch them when each PR is next opened.
DELETE FROM pr_detail;
