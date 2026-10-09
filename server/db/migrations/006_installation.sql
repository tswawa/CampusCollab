CREATE TABLE installation_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  configured_at TEXT,
  source TEXT CHECK (source IN ('legacy', 'web', 'cli', 'fixture'))
) STRICT;

-- Existing accounts or business history must never become claimable through setup.
-- Anonymous pre-sessions and untouched system catalog seeds are not business data.
INSERT INTO installation_state (id, configured_at, source)
SELECT 1,
  CASE WHEN EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM tasks)
    OR EXISTS (SELECT 1 FROM files) OR EXISTS (SELECT 1 FROM notices)
    OR EXISTS (SELECT 1 FROM audit_logs) OR EXISTS (SELECT 1 FROM retention_file_deletions)
    OR EXISTS (SELECT 1 FROM school_settings WHERE version > 1)
  THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END,
  CASE WHEN EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM tasks)
    OR EXISTS (SELECT 1 FROM files) OR EXISTS (SELECT 1 FROM notices)
    OR EXISTS (SELECT 1 FROM audit_logs) OR EXISTS (SELECT 1 FROM retention_file_deletions)
    OR EXISTS (SELECT 1 FROM school_settings WHERE version > 1)
  THEN 'legacy' ELSE NULL END;

CREATE TRIGGER installation_no_reset BEFORE UPDATE ON installation_state
WHEN OLD.configured_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Installation is already configured'); END;
CREATE TRIGGER installation_no_delete BEFORE DELETE ON installation_state
BEGIN SELECT RAISE(ABORT, 'Installation state cannot be deleted'); END;
