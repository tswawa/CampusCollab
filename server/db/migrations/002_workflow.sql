CREATE TABLE workflow_tasks (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE RESTRICT,
  original_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  template_id TEXT NOT NULL DEFAULT 'generic-practice', template_version INTEGER NOT NULL DEFAULT 1,
  template_json TEXT NOT NULL DEFAULT '{}',
  mode TEXT NOT NULL DEFAULT 'individual' CHECK(mode IN ('individual','group')),
  planned_minutes INTEGER CHECK(planned_minutes BETWEEN 0 AND 525600), submission_deadline TEXT,
  personal_submission_required INTEGER NOT NULL DEFAULT 1 CHECK(personal_submission_required IN (0,1)),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
) STRICT;
INSERT INTO workflow_tasks(task_id,original_owner_id,updated_at) SELECT id,teacher_id,updated_at FROM tasks;
CREATE TRIGGER workflow_task_insert AFTER INSERT ON tasks BEGIN
  INSERT INTO workflow_tasks(task_id,original_owner_id,updated_at) VALUES(NEW.id,NEW.teacher_id,NEW.updated_at);
END;

CREATE TABLE workflow_participants (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT, external_id TEXT, source TEXT NOT NULL,
  name TEXT NOT NULL, department TEXT NOT NULL DEFAULT '', class_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('applied','upcoming','in_progress','review','changes_requested','completed','withdrawn','rejected','incomplete','cancelled')),
  status_before_cancel TEXT, version INTEGER NOT NULL DEFAULT 1,
  latest_revision_id TEXT, confirmed_revision_id TEXT, common_revision_id TEXT,
  reported_minutes INTEGER CHECK(reported_minutes BETWEEN 0 AND 525600),
  confirmed_minutes INTEGER CHECK(confirmed_minutes BETWEEN 0 AND 525600),
  feedback TEXT NOT NULL DEFAULT '', missing_items_json TEXT NOT NULL DEFAULT '[]',
  joined_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(task_id,user_id), UNIQUE(task_id,source,external_id)
) STRICT;
INSERT INTO workflow_participants(id,task_id,user_id,source,name,department,class_name,status,status_before_cancel,version,feedback,joined_at,updated_at)
SELECT 'member:'||m.task_id||':'||m.user_id,m.task_id,m.user_id,'account',u.name,COALESCE(d.name,''),COALESCE(c.name,''),
CASE WHEN m.status='recruiting' THEN 'upcoming' ELSE m.status END,m.status_before_cancel,m.version,COALESCE(m.feedback,''),m.claimed_at,m.updated_at
FROM task_members m JOIN users u ON u.id=m.user_id LEFT JOIN departments d ON d.id=u.department_id LEFT JOIN classes c ON c.id=u.class_id;
CREATE INDEX workflow_participants_task ON workflow_participants(task_id,status);
CREATE TRIGGER workflow_member_insert AFTER INSERT ON task_members BEGIN
  INSERT INTO workflow_participants(id,task_id,user_id,source,name,department,class_name,status,version,feedback,joined_at,updated_at)
  SELECT 'member:'||NEW.task_id||':'||NEW.user_id,NEW.task_id,NEW.user_id,'account',u.name,COALESCE(d.name,''),COALESCE(c.name,''),
  CASE WHEN NEW.status='recruiting' THEN 'upcoming' ELSE NEW.status END,NEW.version,COALESCE(NEW.feedback,''),NEW.claimed_at,NEW.updated_at
  FROM users u LEFT JOIN departments d ON d.id=u.department_id LEFT JOIN classes c ON c.id=u.class_id WHERE u.id=NEW.user_id
  ON CONFLICT(task_id,user_id) DO NOTHING;
END;
CREATE TRIGGER workflow_member_update AFTER UPDATE ON task_members BEGIN
  UPDATE workflow_participants SET status=CASE
    WHEN NEW.status='cancelled' AND status IN ('withdrawn','rejected','incomplete') THEN status
    WHEN NEW.status='recruiting' THEN 'upcoming' ELSE NEW.status END,
    status_before_cancel=NEW.status_before_cancel,version=NEW.version,feedback=COALESCE(NEW.feedback,''),updated_at=NEW.updated_at
  WHERE task_id=NEW.task_id AND user_id=NEW.user_id;
END;

CREATE TRIGGER workflow_member_version_insert AFTER INSERT ON task_members BEGIN
  UPDATE workflow_tasks SET version=version+1,updated_at=NEW.updated_at WHERE task_id=NEW.task_id;
END;
CREATE TRIGGER workflow_member_version_update AFTER UPDATE ON task_members BEGIN
  UPDATE workflow_tasks SET version=version+1,updated_at=NEW.updated_at WHERE task_id=NEW.task_id;
END;
CREATE TRIGGER workflow_task_version_update AFTER UPDATE ON tasks BEGIN
  UPDATE workflow_tasks SET version=version+1,updated_at=NEW.updated_at WHERE task_id=NEW.id;
END;

CREATE TABLE workflow_revisions (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  participant_id TEXT REFERENCES workflow_participants(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL CHECK(scope IN ('personal','common')), revision INTEGER NOT NULL CHECK(revision>0),
  description TEXT NOT NULL, note TEXT NOT NULL, reported_minutes INTEGER CHECK(reported_minutes BETWEEN 0 AND 525600),
  submitted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, submitted_at TEXT NOT NULL,
  source_revision_id TEXT REFERENCES workflow_revisions(id) ON DELETE RESTRICT,
  changed_fields_json TEXT NOT NULL DEFAULT '[]',
  CHECK((scope='personal' AND participant_id IS NOT NULL) OR (scope='common' AND participant_id IS NULL)),
  UNIQUE(participant_id,revision)
) STRICT;
CREATE UNIQUE INDEX workflow_common_revision ON workflow_revisions(task_id,revision) WHERE scope='common';
CREATE TABLE workflow_revision_files (
  revision_id TEXT NOT NULL REFERENCES workflow_revisions(id) ON DELETE RESTRICT,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE RESTRICT, sort_order INTEGER NOT NULL,
  PRIMARY KEY(revision_id,file_id)
) STRICT;
CREATE TABLE workflow_reviews (
  id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES workflow_participants(id) ON DELETE RESTRICT,
  revision_id TEXT REFERENCES workflow_revisions(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL, feedback TEXT NOT NULL, missing_items_json TEXT NOT NULL DEFAULT '[]',
  confirmed_minutes INTEGER, actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at TEXT NOT NULL
) STRICT;
INSERT INTO workflow_revisions(id,task_id,participant_id,scope,revision,description,note,submitted_by,submitted_at,changed_fields_json)
SELECT 'legacy:'||p.id,p.task_id,w.id,'personal',p.version,p.description,p.note,p.user_id,p.submitted_at,'["description","note","fileIds"]'
FROM proofs p JOIN workflow_participants w ON w.task_id=p.task_id AND w.user_id=p.user_id;
INSERT INTO workflow_revision_files(revision_id,file_id,sort_order) SELECT 'legacy:'||proof_id,file_id,sort_order FROM proof_files;
UPDATE workflow_participants SET latest_revision_id=(SELECT id FROM workflow_revisions r WHERE r.participant_id=workflow_participants.id),
confirmed_revision_id=CASE WHEN status='completed' THEN (SELECT id FROM workflow_revisions r WHERE r.participant_id=workflow_participants.id) ELSE NULL END;
CREATE TRIGGER workflow_revision_no_update BEFORE UPDATE ON workflow_revisions BEGIN SELECT RAISE(ABORT,'Immutable proof revision'); END;
CREATE TRIGGER workflow_revision_no_delete BEFORE DELETE ON workflow_revisions BEGIN SELECT RAISE(ABORT,'Immutable proof revision'); END;
CREATE TRIGGER workflow_revision_files_no_update BEFORE UPDATE ON workflow_revision_files BEGIN SELECT RAISE(ABORT,'Immutable proof files'); END;
CREATE TRIGGER workflow_revision_files_no_delete BEFORE DELETE ON workflow_revision_files BEGIN SELECT RAISE(ABORT,'Immutable proof files'); END;
CREATE TRIGGER workflow_reviews_no_update BEFORE UPDATE ON workflow_reviews BEGIN SELECT RAISE(ABORT,'Immutable review'); END;
CREATE TRIGGER workflow_reviews_no_delete BEFORE DELETE ON workflow_reviews BEGIN SELECT RAISE(ABORT,'Immutable review'); END;

CREATE TABLE workflow_imports (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT, idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at TEXT NOT NULL,
  PRIMARY KEY(task_id,idempotency_key)
) STRICT;
CREATE TABLE workflow_snapshots (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT, version INTEGER NOT NULL,
  supersedes_id TEXT REFERENCES workflow_snapshots(id) ON DELETE RESTRICT, reason TEXT NOT NULL,
  snapshot_json TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at TEXT NOT NULL,
  UNIQUE(task_id,version)
) STRICT;
CREATE TRIGGER workflow_snapshot_no_update BEFORE UPDATE ON workflow_snapshots BEGIN SELECT RAISE(ABORT,'Immutable closeout snapshot'); END;
CREATE TRIGGER workflow_snapshot_no_delete BEFORE DELETE ON workflow_snapshots BEGIN SELECT RAISE(ABORT,'Immutable closeout snapshot'); END;
