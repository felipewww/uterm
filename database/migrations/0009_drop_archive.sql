-- Archiving is gone: a session is either in use or deleted. Sessions that had been archived simply become normal sessions again
-- (nothing is deleted here), then the column and its index are dropped.
ALTER TABLE sessions DROP INDEX ix_sessions_archived, DROP COLUMN archived_at;
