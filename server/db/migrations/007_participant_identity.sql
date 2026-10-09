-- Admission is a durable fact, separate from the current outcome or task cancellation.
ALTER TABLE workflow_participants ADD COLUMN admitted INTEGER NOT NULL DEFAULT 0 CHECK (admitted IN (0,1));

-- B0 could reopen a never-admitted withdrawal into changes_requested and then
-- accept evidence. Those states, and evidence after that reopen, are not proof
-- of admission. Only strictly earlier evidence resolves that historical ambiguity;
-- equal timestamps and later reopens must not turn it into a new permission.
UPDATE workflow_participants SET admitted=1
WHERE status IN ('upcoming','in_progress')
  OR status_before_cancel IN ('upcoming','in_progress')
  OR id GLOB 'participant_*'
  OR EXISTS (SELECT 1 FROM notices n WHERE n.user_id=workflow_participants.user_id
    AND n.target_kind='task' AND n.target_id=workflow_participants.task_id
    AND n.event_type IN ('task.application_approved','task.invited'))
  OR (
    (status IN ('review','changes_requested','completed')
      OR status_before_cancel IN ('review','changes_requested','completed')
      OR EXISTS (SELECT 1 FROM workflow_revisions r WHERE r.participant_id=workflow_participants.id))
    AND NOT EXISTS (SELECT 1 FROM workflow_reviews rv WHERE rv.participant_id=workflow_participants.id AND rv.decision='reopened')
  )
  OR EXISTS (SELECT 1 FROM workflow_revisions r WHERE r.participant_id=workflow_participants.id
    AND NOT EXISTS (SELECT 1 FROM workflow_reviews invalid WHERE invalid.participant_id=workflow_participants.id
      AND invalid.decision='reopened' AND julianday(invalid.created_at) IS NULL)
    AND julianday(r.submitted_at) < (SELECT MIN(julianday(rv.created_at)) FROM workflow_reviews rv
      WHERE rv.participant_id=workflow_participants.id AND rv.decision='reopened'));

CREATE TRIGGER workflow_participant_admission_insert AFTER INSERT ON workflow_participants
WHEN NEW.admitted=0 AND NEW.status IN ('upcoming','in_progress')
BEGIN UPDATE workflow_participants SET admitted=1 WHERE id=NEW.id; END;
CREATE TRIGGER workflow_participant_admission_update AFTER UPDATE OF status ON workflow_participants
WHEN NEW.admitted=0 AND NEW.status IN ('upcoming','in_progress')
BEGIN UPDATE workflow_participants SET admitted=1 WHERE id=NEW.id; END;
CREATE TRIGGER workflow_participant_admission_preserve BEFORE UPDATE OF admitted ON workflow_participants
WHEN OLD.admitted=1 AND NEW.admitted<>1
BEGIN SELECT RAISE(ABORT,'Admission history cannot be reset'); END;

-- Backfill only native account identities that have never been closed out and
-- whose unchanged account already carried this identifier when they joined.
-- Existing imports, ambiguous accounts and immutable snapshots remain untouched.
UPDATE workflow_participants SET external_id=(SELECT u.external_id FROM users u WHERE u.id=workflow_participants.user_id)
WHERE source='account' AND external_id IS NULL
  AND id='member:'||task_id||':'||user_id
  AND EXISTS (SELECT 1 FROM workflow_tasks w WHERE w.task_id=workflow_participants.task_id AND w.status='open')
  AND NOT EXISTS (SELECT 1 FROM workflow_snapshots s WHERE s.task_id=workflow_participants.task_id)
  AND EXISTS (SELECT 1 FROM users u WHERE u.id=workflow_participants.user_id AND u.external_id IS NOT NULL
    AND u.version=1 AND u.created_at<=workflow_participants.joined_at AND u.updated_at<=workflow_participants.joined_at
    AND NOT EXISTS (SELECT 1 FROM workflow_participants other WHERE other.task_id=workflow_participants.task_id
      AND other.source='account' AND other.external_id=u.external_id AND other.id<>workflow_participants.id));

DROP TRIGGER workflow_member_insert;
CREATE TRIGGER workflow_member_insert AFTER INSERT ON task_members BEGIN
  INSERT INTO workflow_participants(id,task_id,user_id,external_id,source,name,department,class_name,status,version,feedback,joined_at,updated_at)
  SELECT 'member:'||NEW.task_id||':'||NEW.user_id,NEW.task_id,NEW.user_id,u.external_id,'account',u.name,COALESCE(d.name,''),COALESCE(c.name,''),
    CASE WHEN NEW.status='recruiting' THEN 'upcoming' ELSE NEW.status END,NEW.version,COALESCE(NEW.feedback,''),NEW.claimed_at,NEW.updated_at
  FROM users u LEFT JOIN departments d ON d.id=u.department_id LEFT JOIN classes c ON c.id=u.class_id
  WHERE u.id=NEW.user_id AND NOT EXISTS (SELECT 1 FROM workflow_participants p WHERE p.task_id=NEW.task_id AND p.user_id=NEW.user_id);
END;
