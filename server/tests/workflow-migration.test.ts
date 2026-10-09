import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { AppDatabase } from '../db/database.js'
import { loadConfig } from '../config.js'
import { getUserById } from '../db/models.js'
import { canReadWorkflowFile, getTaskWorkflow } from '../modules/workflow.service.js'

test('001 database migrates existing participants and confirmed evidence without losing identities or files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-workflow-migrate-'))
  const db = new AppDatabase(loadConfig({ nodeEnv: 'test', databasePath: path.join(root, 'legacy.sqlite'), uploadDir: path.join(root, 'uploads'), backupDir: path.join(root, 'backups') }))
  try {
    db.raw.exec(fs.readFileSync(path.resolve('server/db/migrations/001_initial.sql'), 'utf8'))
    db.raw.exec(`
      INSERT INTO schema_migrations VALUES(1,'001_initial.sql','2026-01-01');
      -- Production migration 001 also calls seedBaseData, which always creates this singleton.
      INSERT INTO school_settings(id,name,platform_name,logo_url,badge,announcement,primary_color,timezone,version,updated_at)
        VALUES(1,'Legacy institution','Legacy collaboration','','I','Original announcement','#123456','Asia/Shanghai',1,'2026-01-01');
      INSERT INTO departments(id,name,code,created_at,updated_at) VALUES('d','Department','D','2026-01-01','2026-01-01');
      INSERT INTO grades(id,name,created_at,updated_at) VALUES('g','Grade','2026-01-01','2026-01-01');
      INSERT INTO classes(id,name,department_id,grade_id,created_at,updated_at) VALUES('c','Class','d','g','2026-01-01','2026-01-01');
      INSERT INTO campuses(id,name,created_at,updated_at) VALUES('campus','Campus','2026-01-01','2026-01-01');
      INSERT INTO task_categories(id,name,created_at,updated_at) VALUES('category','Category','2026-01-01','2026-01-01');
      INSERT INTO users(id,role,account,account_normalized,name,department_id,password_hash,approval,created_at,updated_at) VALUES('teacher','teacher','Teacher','teacher','Teacher','d','unused-fixture-hash','approved','2026-01-01','2026-01-01');
      INSERT INTO users(id,role,account,account_normalized,name,department_id,class_id,grade_id,password_hash,approval,created_at,updated_at) VALUES('student','student','001','001','Student','d','c','g','unused-fixture-hash','approved','2026-01-01','2026-01-01');
      INSERT INTO tasks(id,title,category_id,campus_id,location,description,start_at,end_at,signup_deadline_at,duration,capacity,audience_scope,claim_mode,teacher_id,status,created_at,updated_at) VALUES('task','Legacy task','category','campus','Room','Legacy task description','2026-01-02T10:00:00Z','2026-01-02T12:00:00Z','2026-01-01T12:00:00Z','2 hours',1,'school','direct','teacher','completed','2026-01-01','2026-01-01');
      INSERT INTO task_members(task_id,user_id,status,claimed_at,feedback,version,updated_at) VALUES('task','student','completed','2026-01-01','Reviewed before migration',7,'2026-01-02');
      INSERT INTO proofs(id,task_id,user_id,description,note,submitted_at,version) VALUES('proof','task','student','Legacy confirmed description','Legacy note','2026-01-02',3);
      INSERT INTO files(id,owner_user_id,task_id,purpose,stored_name,original_name,mime_type,size_bytes,width,height,status,created_at) VALUES('image','student','task','proof','proof/legacy.png','legacy.png','image/png',10,1,1,'attached','2026-01-02');
      INSERT INTO proof_files(proof_id,file_id,sort_order) VALUES('proof','image',0);
    `)
    db.migrate()
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), [])
    const teacher = getUserById(db, 'teacher')!
    const workflow = getTaskWorkflow(db, teacher, 'task')
    assert.equal(workflow.participants.length, 1)
    const person = workflow.participants[0]
    assert.equal(person.userId, 'student'); assert.equal(person.version, 7); assert.equal(person.status, 'completed')
    assert.equal(person.confirmedRevisionId, 'legacy:proof'); assert.equal(person.revisions[0].revision, 3)
    assert.equal(person.revisions[0].description, 'Legacy confirmed description'); assert.deepEqual(person.revisions[0].fileIds, ['image'])
    assert.equal(person.confirmedMinutes, null, 'migration must not turn planned text into confirmed minutes')
    assert.equal(canReadWorkflowFile(db, teacher, 'image'), true)
    db.migrate()
    assert.equal(db.get('SELECT COUNT(*) n FROM workflow_revisions')?.n, 1)
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})
