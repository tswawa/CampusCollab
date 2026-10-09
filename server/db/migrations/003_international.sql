-- requires-foreign-keys-off
-- The runner disables foreign keys before BEGIN, validates every foreign key before
-- COMMIT, and restores the original pragmas. Restore the pre-upgrade backup to
-- downgrade: optional organizations cannot be represented by the original CHECK.
CREATE TABLE users_international (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  account TEXT NOT NULL,
  account_normalized TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  department_id TEXT REFERENCES departments(id) ON DELETE RESTRICT,
  class_id TEXT REFERENCES classes(id) ON DELETE RESTRICT,
  grade_id TEXT REFERENCES grades(id) ON DELETE RESTRICT,
  password_hash TEXT NOT NULL,
  approval TEXT NOT NULL CHECK (approval IN ('approved', 'pending', 'disabled')),
  skills_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  locale TEXT CHECK (locale IN ('zh-CN', 'en')),
  email TEXT,
  external_id TEXT,
  is_external INTEGER NOT NULL DEFAULT 0 CHECK (is_external IN (0, 1)),
  CHECK (class_id IS NULL OR (department_id IS NOT NULL AND grade_id IS NOT NULL))
) STRICT;
INSERT INTO users_international
  (id, role, account, account_normalized, name, department_id, class_id, grade_id,
   password_hash, approval, skills_json, version, created_at, updated_at)
SELECT id, role, account, account_normalized, name, department_id, class_id, grade_id,
   password_hash, approval, skills_json, version, created_at, updated_at FROM users;
DROP TABLE users;
ALTER TABLE users_international RENAME TO users;
CREATE INDEX idx_users_role_approval ON users(role, approval);
CREATE INDEX idx_users_department ON users(department_id);
CREATE UNIQUE INDEX idx_users_external_id ON users(external_id) WHERE external_id IS NOT NULL;

ALTER TABLE school_settings ADD COLUMN default_locale TEXT NOT NULL DEFAULT 'zh-CN' CHECK (default_locale IN ('zh-CN', 'en'));
ALTER TABLE school_settings ADD COLUMN registration_enabled INTEGER NOT NULL DEFAULT 1 CHECK (registration_enabled IN (0, 1));
ALTER TABLE school_settings ADD COLUMN require_department INTEGER NOT NULL DEFAULT 1 CHECK (require_department IN (0, 1));
ALTER TABLE school_settings ADD COLUMN require_grade INTEGER NOT NULL DEFAULT 1 CHECK (require_grade IN (0, 1));
ALTER TABLE school_settings ADD COLUMN require_class INTEGER NOT NULL DEFAULT 1 CHECK (require_class IN (0, 1));
ALTER TABLE school_settings ADD COLUMN allow_external_participants INTEGER NOT NULL DEFAULT 0 CHECK (allow_external_participants IN (0, 1));

ALTER TABLE notices ADD COLUMN event_type TEXT;
ALTER TABLE notices ADD COLUMN event_params_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE notices ADD COLUMN target_kind TEXT CHECK (target_kind IN ('task', 'accounts'));
ALTER TABLE notices ADD COLUMN target_id TEXT;
