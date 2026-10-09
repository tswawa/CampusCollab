-- Optional SMTP delivery never replaces the in-app notification.
CREATE TABLE mail_deliveries (
  id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL UNIQUE REFERENCES notices(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'accepted', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_mail_deliveries_status ON mail_deliveries(status, created_at);
CREATE TABLE mail_delivery_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id TEXT NOT NULL REFERENCES mail_deliveries(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'accepted', 'failed')),
  error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(delivery_id, attempt)
) STRICT;
