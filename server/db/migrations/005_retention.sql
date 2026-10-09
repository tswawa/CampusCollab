ALTER TABLE school_settings ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 365 CHECK (retention_days BETWEEN 1 AND 36500);
CREATE TABLE retention_context (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  task_id TEXT NOT NULL
) STRICT;
CREATE TABLE retention_file_deletions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  file_id TEXT NOT NULL UNIQUE,
  stored_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

-- A purge exception exists only inside the administrator's single transaction,
-- is scoped to exactly one task, and never permits rewriting immutable history.
DROP TRIGGER workflow_revision_no_delete;
CREATE TRIGGER workflow_revision_no_delete BEFORE DELETE ON workflow_revisions
WHEN NOT EXISTS (SELECT 1 FROM retention_context WHERE id=1 AND task_id=OLD.task_id)
BEGIN SELECT RAISE(ABORT,'Immutable proof revision'); END;
DROP TRIGGER workflow_revision_files_no_delete;
CREATE TRIGGER workflow_revision_files_no_delete BEFORE DELETE ON workflow_revision_files
WHEN NOT EXISTS (SELECT 1 FROM retention_context c JOIN workflow_revisions r ON r.task_id=c.task_id WHERE c.id=1 AND r.id=OLD.revision_id)
BEGIN SELECT RAISE(ABORT,'Immutable proof files'); END;
DROP TRIGGER workflow_reviews_no_delete;
CREATE TRIGGER workflow_reviews_no_delete BEFORE DELETE ON workflow_reviews
WHEN NOT EXISTS (SELECT 1 FROM retention_context c JOIN workflow_participants p ON p.task_id=c.task_id WHERE c.id=1 AND p.id=OLD.participant_id)
BEGIN SELECT RAISE(ABORT,'Immutable review'); END;
DROP TRIGGER workflow_snapshot_no_delete;
CREATE TRIGGER workflow_snapshot_no_delete BEFORE DELETE ON workflow_snapshots
WHEN NOT EXISTS (SELECT 1 FROM retention_context WHERE id=1 AND task_id=OLD.task_id)
BEGIN SELECT RAISE(ABORT,'Immutable closeout snapshot'); END;
