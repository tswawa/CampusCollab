PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS grades (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  grade_id TEXT NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_classes_department_grade ON classes(department_id, grade_id, enabled);

CREATE TABLE IF NOT EXISTS campuses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS task_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  account TEXT NOT NULL,
  account_normalized TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  class_id TEXT REFERENCES classes(id) ON DELETE RESTRICT,
  grade_id TEXT REFERENCES grades(id) ON DELETE RESTRICT,
  password_hash TEXT NOT NULL,
  approval TEXT NOT NULL CHECK (approval IN ('approved', 'pending', 'disabled')),
  skills_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((role = 'student' AND class_id IS NOT NULL AND grade_id IS NOT NULL) OR role <> 'student')
) STRICT;
CREATE INDEX IF NOT EXISTS idx_users_role_approval ON users(role, approval);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS school_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  platform_name TEXT NOT NULL,
  logo_file_id TEXT,
  logo_url TEXT NOT NULL,
  badge TEXT NOT NULL,
  announcement TEXT NOT NULL,
  primary_color TEXT NOT NULL,
  timezone TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES task_categories(id) ON DELETE RESTRICT,
  campus_id TEXT NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  signup_deadline_at TEXT NOT NULL,
  duration TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  audience_scope TEXT NOT NULL CHECK (audience_scope IN ('school', 'department', 'class', 'grade')),
  audience_id TEXT,
  requirements_json TEXT NOT NULL DEFAULT '[]',
  proof_types_json TEXT NOT NULL DEFAULT '[]',
  claim_mode TEXT NOT NULL CHECK (claim_mode IN ('direct', 'application')),
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('recruiting', 'upcoming', 'in_progress', 'review', 'changes_requested', 'completed', 'cancelled')),
  status_before_cancel TEXT,
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((audience_scope = 'school' AND audience_id IS NULL) OR (audience_scope <> 'school' AND audience_id IS NOT NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_tasks_teacher_created ON tasks(teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status_start ON tasks(status, start_at);
CREATE INDEX IF NOT EXISTS idx_tasks_catalog ON tasks(category_id, campus_id);
CREATE INDEX IF NOT EXISTS idx_tasks_audience ON tasks(audience_scope, audience_id);

CREATE TABLE IF NOT EXISTS task_contacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('wechat', 'phone', 'email', 'qq', 'office', 'chat', 'custom')),
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS idx_task_contacts_task ON task_contacts(task_id, sort_order);

CREATE TABLE IF NOT EXISTS task_members (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('applied', 'recruiting', 'upcoming', 'in_progress', 'review', 'changes_requested', 'completed', 'cancelled')),
  status_before_cancel TEXT,
  claimed_at TEXT NOT NULL,
  started_at TEXT,
  feedback TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, user_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_task_members_user ON task_members(user_id, status);
CREATE INDEX IF NOT EXISTS idx_task_members_task_status ON task_members(task_id, status);

CREATE TABLE IF NOT EXISTS proofs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  description TEXT NOT NULL,
  note TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (task_id, user_id),
  FOREIGN KEY (task_id, user_id) REFERENCES task_members(task_id, user_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('proof', 'logo')),
  stored_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  status TEXT NOT NULL CHECK (status IN ('temporary', 'attached', 'published')),
  expires_at INTEGER,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_files_owner_status ON files(owner_user_id, status);
CREATE INDEX IF NOT EXISTS idx_files_task ON files(task_id);

CREATE TABLE IF NOT EXISTS proof_files (
  proof_id TEXT NOT NULL REFERENCES proofs(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL UNIQUE REFERENCES files(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (proof_id, file_id)
) STRICT;

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('task', 'review', 'system')),
  read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_notices_user_created ON notices(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notices_unread ON notices(user_id, read);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
