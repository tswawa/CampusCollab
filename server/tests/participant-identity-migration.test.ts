import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { AppDatabase } from '../db/database.js'
import { loadConfig } from '../config.js'
import { getUserById } from '../db/models.js'
import { approveApplication, cancelTask, getTaskForViewer, restoreTask } from '../modules/tasks.service.js'
import {
  getTaskWorkflow,
  reopenParticipant,
  reviewWorkflowRevision,
  submitWorkflowRevision
} from '../modules/workflow.service.js'

test('007 migrates only proven admission and unambiguous never-closed native account identifiers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-identity-migration-'))
  const db = new AppDatabase(
    loadConfig({
      nodeEnv: 'test',
      databasePath: path.join(root, 'legacy.sqlite'),
      uploadDir: path.join(root, 'uploads'),
      backupDir: path.join(root, 'backups')
    })
  )
  try {
    // Build the actual 006 schema; old SQL files are read without modification.
    for (const name of fs
      .readdirSync('server/db/migrations')
      .filter(name => /^00[1-6]_.*\.sql$/.test(name))
      .sort()) {
      const sql = fs.readFileSync(path.join('server/db/migrations', name), 'utf8')
      const rebuild = sql.startsWith('-- requires-foreign-keys-off')
      if (rebuild) db.raw.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON;')
      try {
        db.raw.exec(sql)
        db.run(
          'INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)',
          Number(name.slice(0, 3)),
          name,
          '2026-01-01T00:00:00Z'
        )
      } finally {
        if (rebuild) db.raw.exec('PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;')
      }
    }
    db.raw.exec(`
      INSERT INTO school_settings(id,name,platform_name,logo_url,badge,announcement,primary_color,timezone,updated_at)
        VALUES(1,'Fictional institution','Fictional platform','','F','','#123456','UTC','2026-01-01T00:00:00Z');
      INSERT INTO campuses(id,name,created_at,updated_at) VALUES('campus','Fictional campus','2026-01-01','2026-01-01');
      INSERT INTO task_categories(id,name,created_at,updated_at) VALUES('category','Fictional category','2026-01-01','2026-01-01');
      INSERT INTO users(id,role,account,account_normalized,name,password_hash,approval,created_at,updated_at)
        VALUES('teacher','teacher','TEACHER','teacher','Fictional teacher','unused','approved','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
    `)
    const addUser = (id: string, externalId: string, version = 1) =>
      db.run(
        `INSERT INTO users
      (id,role,account,account_normalized,name,password_hash,approval,external_id,version,created_at,updated_at)
      VALUES(?,'student',?,?,?,'unused','approved',?,?,?,?)`,
        id,
        id,
        id,
        `Fictional ${id}`,
        externalId,
        version,
        '2026-01-01T00:00:00Z',
        version === 1 ? '2026-01-01T00:00:00Z' : '2026-02-01T00:00:00Z'
      )
    const addTask = (id: string) => {
      db.run(
        `INSERT INTO tasks(id,title,category_id,campus_id,location,description,start_at,end_at,signup_deadline_at,duration,capacity,audience_scope,claim_mode,teacher_id,status,created_at,updated_at)
        VALUES(?,?,'category','campus','Fixture room','Fictional legacy task','2098-01-02T10:00:00Z','2098-01-02T12:00:00Z','2098-01-01T12:00:00Z','120 minutes',20,'school','application','teacher','recruiting','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z')`,
        id,
        id
      )
      db.run(
        "INSERT INTO task_contacts(id,task_id,type,label,value) VALUES(?,?,'office','Fixture contact','PRIVATE')",
        `contact-${id}`,
        id
      )
    }
    const addMember = (task: string, user: string, status: string, before: string | null = null) =>
      db.run(
        `INSERT INTO task_members
      (task_id,user_id,status,status_before_cancel,claimed_at,version,updated_at) VALUES(?,?,?,?,?,1,?)`,
        task,
        user,
        status,
        before,
        '2026-01-02T00:00:00Z',
        '2026-01-02T00:00:00Z'
      )
    for (const [id, externalId, version] of [
      ['stable', '000123', 1],
      ['changed', '000999', 2],
      ['closed', '000777', 1],
      ['reopened', '000888', 1],
      ['collision', '000666', 1],
      ['unknown', '000555', 1],
      ['cancelledPending', '000444', 1],
      ['cancelledAccepted', '000333', 1],
      ['noticeAccepted', '000222', 1]
    ] as const)
      addUser(id, externalId, version)
    addTask('open')
    addTask('closed')
    addTask('reopened')
    addMember('open', 'stable', 'upcoming')
    addMember('open', 'changed', 'upcoming')
    addMember('open', 'collision', 'upcoming')
    addMember('open', 'unknown', 'cancelled')
    addMember('open', 'cancelledPending', 'applied')
    addMember('open', 'cancelledAccepted', 'upcoming')
    // The pre-007 trigger copies cancellation snapshots on UPDATE, as production does.
    db.run(
      "UPDATE task_members SET status_before_cancel=status,status='cancelled' WHERE task_id='open' AND user_id IN ('cancelledPending','cancelledAccepted')"
    )
    addMember('open', 'noticeAccepted', 'cancelled')
    addMember('closed', 'closed', 'completed')
    addMember('reopened', 'reopened', 'completed')
    db.run("UPDATE workflow_tasks SET status='closed' WHERE task_id='closed'")
    for (const task of ['closed', 'reopened'])
      db.run(
        `INSERT INTO workflow_snapshots(id,task_id,version,reason,snapshot_json,created_by,created_at)
      VALUES(?,?,1,'Preserve immutable history',?,'teacher','2026-01-03T00:00:00Z')`,
        `snapshot-${task}`,
        task,
        JSON.stringify({ externalId: null, marker: task })
      )
    db.run(`INSERT INTO workflow_participants(id,task_id,external_id,source,name,status,joined_at,updated_at)
      VALUES('participant_imported','open','000666','account','Fictional imported identity','withdrawn','2026-01-02','2026-01-02')`)
    db.run(`INSERT INTO notices(id,user_id,title,content,type,created_at,event_type,target_kind,target_id)
      VALUES('admission-notice','noticeAccepted','Fictional','Fictional','task','2026-01-02','task.application_approved','task','open')`)
    const snapshotsBefore = db.all('SELECT id,snapshot_json FROM workflow_snapshots ORDER BY id')
    db.migrate()
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), [])
    const participant = (user: string) => db.get('SELECT * FROM workflow_participants WHERE user_id=?', user)!
    assert.equal(participant('stable').external_id, '000123')
    for (const user of ['changed', 'closed', 'reopened', 'collision'])
      assert.equal(participant(user).external_id, null, `Do not infer the earlier ID of ${user}`)
    assert.equal(
      db.get("SELECT external_id FROM workflow_participants WHERE id='participant_imported'")?.external_id,
      '000666'
    )
    assert.deepEqual(db.all('SELECT id,snapshot_json FROM workflow_snapshots ORDER BY id'), snapshotsBefore)
    assert.equal(participant('unknown').admitted, 0)
    assert.equal(participant('cancelledPending').admitted, 0)
    assert.equal(participant('cancelledAccepted').admitted, 1)
    assert.equal(participant('noticeAccepted').admitted, 1)
    assert.equal(db.get("SELECT admitted FROM workflow_participants WHERE id='participant_imported'")?.admitted, 1)
    for (const user of ['unknown', 'cancelledPending'])
      assert.deepEqual(getTaskForViewer(db, 'open', getUserById(db, user)!).contacts, [])
    for (const user of ['stable', 'cancelledAccepted', 'noticeAccepted'])
      assert.equal(getTaskForViewer(db, 'open', getUserById(db, user)!).contacts.length, 1)
    assert.throws(
      () => db.run("UPDATE workflow_participants SET admitted=0 WHERE user_id='stable'"),
      /Admission history cannot be reset/
    )
    db.migrate()
    assert.deepEqual(db.all('SELECT id,snapshot_json FROM workflow_snapshots ORDER BY id'), snapshotsBefore)
  } finally {
    db.close()
    const full = path.resolve(root)
    assert.ok(
      full.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(full).startsWith('campus-identity-migration-')
    )
    fs.rmSync(full, { recursive: true, force: true })
  }
})

test('007 does not preserve the B0 never-admitted reopen leak or regrant it through later evidence and restoration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-reopen-migration-'))
  const db = new AppDatabase(
    loadConfig({
      nodeEnv: 'test',
      databasePath: path.join(root, 'legacy.sqlite'),
      uploadDir: path.join(root, 'uploads'),
      backupDir: path.join(root, 'backups')
    })
  )
  try {
    for (const name of fs
      .readdirSync('server/db/migrations')
      .filter(name => /^00[1-6]_.*\.sql$/.test(name))
      .sort()) {
      const sql = fs.readFileSync(path.join('server/db/migrations', name), 'utf8')
      const rebuild = sql.startsWith('-- requires-foreign-keys-off')
      if (rebuild) db.raw.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON;')
      try {
        db.raw.exec(sql)
        db.run(
          'INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)',
          Number(name.slice(0, 3)),
          name,
          '2026-01-01T00:00:00Z'
        )
      } finally {
        if (rebuild) db.raw.exec('PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;')
      }
    }
    db.raw.exec(`
      INSERT INTO school_settings(id,name,platform_name,logo_url,badge,announcement,primary_color,timezone,updated_at)
        VALUES(1,'Fictional institution','Fictional platform','','F','','#123456','UTC','2026-01-01T00:00:00Z');
      INSERT INTO campuses(id,name,created_at,updated_at) VALUES('campus','Fictional campus','2026-01-01','2026-01-01');
      INSERT INTO task_categories(id,name,created_at,updated_at) VALUES('category','Fictional category','2026-01-01','2026-01-01');
      INSERT INTO users(id,role,account,account_normalized,name,password_hash,approval,created_at,updated_at)
        VALUES('teacher','teacher','TEACHER','teacher','Fictional teacher','unused','approved','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
        ('admin','admin','ADMIN','admin','Fictional admin','unused','approved','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
    `)
    const firstReopen = '2026-01-03T00:00:00.000Z'
    const variants: Array<{
      id: string
      evidence?: string
      cancelled?: 'changes_requested' | 'completed'
      secondReopen?: boolean
      noReopen?: boolean
      admitted: 0 | 1
    }> = [
      { id: 'ambiguous-empty', admitted: 0 },
      { id: 'ambiguous-review', evidence: '2026-01-03T00:00:00.001Z', admitted: 0 },
      { id: 'ambiguous-cancelled', cancelled: 'changes_requested', admitted: 0 },
      { id: 'ambiguous-completed', evidence: '2026-01-03T00:00:00.001Z', cancelled: 'completed', admitted: 0 },
      { id: 'same-instant', evidence: firstReopen, admitted: 0 },
      { id: 'same-instant-offset', evidence: '2026-01-03T08:00:00.000+08:00', admitted: 0 },
      { id: 'before-second-only', evidence: '2026-01-03T00:00:00.001Z', secondReopen: true, admitted: 0 },
      { id: 'proven-before-first', evidence: '2026-01-02T23:59:59.999Z', admitted: 1 },
      { id: 'proven-no-reopen', evidence: '2026-01-02T23:59:59.999Z', noReopen: true, admitted: 1 }
    ]
    for (const variant of variants) {
      const id = variant.id,
        participantId = `member:${id}:${id}`
      db.run(
        `INSERT INTO users(id,role,account,account_normalized,name,password_hash,approval,created_at,updated_at)
        VALUES(?,'student',?,?,?,'unused','approved','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        id,
        id,
        id,
        `Fictional ${id}`
      )
      db.run(
        `INSERT INTO tasks(id,title,category_id,campus_id,location,description,start_at,end_at,signup_deadline_at,duration,capacity,audience_scope,claim_mode,teacher_id,status,proof_types_json,created_at,updated_at)
        VALUES(?,?,'category','campus','Fixture room','Fictional legacy reopen','2098-01-02T10:00:00Z','2098-01-02T12:00:00Z','2098-01-01T12:00:00Z','120 minutes',2,'school','application','teacher','recruiting','["text"]','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z')`,
        id,
        id
      )
      db.run(
        "INSERT INTO task_contacts(id,task_id,type,label,value) VALUES(?,?,'office','Fixture contact','PRIVATE')",
        `contact-${id}`,
        id
      )
      db.run(
        `INSERT INTO task_members(task_id,user_id,status,claimed_at,version,updated_at)
        VALUES(?,?,?,'2026-01-02T00:00:00Z',1,'2026-01-02T00:00:00Z')`,
        id,
        id,
        variant.admitted ? 'upcoming' : 'applied'
      )
      // Reproduce B0's permitted applied -> withdrawn -> changes_requested SQL
      // history on the actual 006 schema, before the new admitted column exists.
      if (!variant.noReopen) {
        db.run("UPDATE workflow_participants SET status='withdrawn',version=2 WHERE id=?", participantId)
        db.run("UPDATE task_members SET status='cancelled',version=2 WHERE task_id=? AND user_id=?", id, id)
        db.run(
          `INSERT INTO workflow_reviews(id,participant_id,decision,feedback,actor_id,created_at)
          VALUES(?,?,'reopened','Fictional old reopen','teacher',?)`,
          `reopen-${id}`,
          participantId,
          firstReopen
        )
        db.run("UPDATE task_members SET status='changes_requested',version=3 WHERE task_id=? AND user_id=?", id, id)
      }
      if (variant.evidence) {
        db.run(
          `INSERT INTO workflow_revisions(id,task_id,participant_id,scope,revision,description,note,submitted_by,submitted_at)
          VALUES(?,?,?,'personal',1,'Fictional historical evidence','',?,?)`,
          `revision-${id}`,
          id,
          participantId,
          id,
          variant.evidence
        )
        db.run('UPDATE workflow_participants SET latest_revision_id=? WHERE id=?', `revision-${id}`, participantId)
        db.run("UPDATE task_members SET status='review',version=4 WHERE task_id=? AND user_id=?", id, id)
      }
      if (variant.secondReopen)
        db.run(
          `INSERT INTO workflow_reviews(id,participant_id,decision,feedback,actor_id,created_at)
        VALUES(?,?,'reopened','Fictional second reopen','teacher','2026-01-04T00:00:00.000Z')`,
          `second-${id}`,
          participantId
        )
      if (variant.cancelled) {
        db.run('UPDATE task_members SET status=?,version=5 WHERE task_id=? AND user_id=?', variant.cancelled, id, id)
        db.run(
          "UPDATE task_members SET status_before_cancel=status,status='cancelled',version=6 WHERE task_id=? AND user_id=?",
          id,
          id
        )
        db.run("UPDATE tasks SET status='cancelled',status_before_cancel=? WHERE id=?", variant.cancelled, id)
      }
    }
    const beforeParticipants = db.all(
      'SELECT id,status,status_before_cancel,version,latest_revision_id FROM workflow_participants ORDER BY id'
    )
    const beforeRevisions = db.all('SELECT * FROM workflow_revisions ORDER BY id')
    const beforeReviews = db.all('SELECT * FROM workflow_reviews ORDER BY id')
    db.migrate()
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), [])
    assert.deepEqual(
      db.all('SELECT id,status,status_before_cancel,version,latest_revision_id FROM workflow_participants ORDER BY id'),
      beforeParticipants
    )
    assert.deepEqual(db.all('SELECT * FROM workflow_revisions ORDER BY id'), beforeRevisions)
    assert.deepEqual(db.all('SELECT * FROM workflow_reviews ORDER BY id'), beforeReviews)
    const teacher = getUserById(db, 'teacher')!,
      admin = getUserById(db, 'admin')!
    const admitted = (id: string) =>
      db.get('SELECT admitted FROM workflow_participants WHERE task_id=? AND user_id=?', id, id)?.admitted
    for (const variant of variants) {
      assert.equal(admitted(variant.id), variant.admitted, variant.id)
      assert.equal(
        getTaskForViewer(db, variant.id, getUserById(db, variant.id)!).contacts.length,
        variant.admitted,
        variant.id
      )
      if (variant.cancelled) {
        restoreTask(db, admin, variant.id, getTaskForViewer(db, variant.id, admin).version)
        assert.equal(admitted(variant.id), 0, 'Restoring old changes_requested/completed cannot create admission')
        assert.deepEqual(getTaskForViewer(db, variant.id, getUserById(db, variant.id)!).contacts, [])
      }
    }
    for (const id of ['ambiguous-empty', 'ambiguous-review']) {
      const student = getUserById(db, id)!
      let person = getTaskWorkflow(db, teacher, id).participants[0]!
      if (person.status === 'review') {
        reviewWorkflowRevision(db, teacher, id, {
          participantId: person.id,
          version: person.version,
          revisionId: person.latestRevisionId!,
          decision: 'changes_requested',
          feedback: 'Fictional correction'
        })
        assert.equal(admitted(id), 0)
        person = getTaskWorkflow(db, teacher, id).participants[0]!
      }
      submitWorkflowRevision(db, student, id, {
        participantId: person.id,
        version: person.version,
        description: 'Fictional post-migration evidence',
        note: '',
        fileIds: []
      })
      assert.equal(admitted(id), 0, 'Submitting from an old ambiguous state is not admission')
      person = getTaskWorkflow(db, teacher, id).participants[0]!
      reviewWorkflowRevision(db, teacher, id, {
        participantId: person.id,
        version: person.version,
        revisionId: person.latestRevisionId!,
        decision: 'approved',
        feedback: '',
        confirmedMinutes: 30
      })
      assert.equal(admitted(id), 0, 'Evidence approval does not introduce an implicit admission policy')
      const cancelled = cancelTask(db, teacher, id, getTaskForViewer(db, id, teacher).version)
      restoreTask(db, admin, id, cancelled.version)
      assert.equal(admitted(id), 0)
      assert.deepEqual(getTaskForViewer(db, id, student).contacts, [])
      person = getTaskWorkflow(db, teacher, id).participants[0]!
      reopenParticipant(db, teacher, id, {
        participantId: person.id,
        version: person.version,
        reason: 'Reconsider actual admission'
      })
      assert.equal(getTaskWorkflow(db, teacher, id).participants[0]!.status, 'applied')
      assert.equal(
        db.get('SELECT event_type FROM notices WHERE user_id=? AND target_id=? ORDER BY rowid DESC LIMIT 1', id, id)
          ?.event_type,
        'task.updated'
      )
      assert.deepEqual(getTaskForViewer(db, id, student).contacts, [])
      approveApplication(db, teacher, id, id, getTaskWorkflow(db, teacher, id).participants[0]!.version)
      assert.equal(admitted(id), 1)
      assert.equal(getTaskForViewer(db, id, student).contacts.length, 1)
    }
  } finally {
    db.close()
    const full = path.resolve(root)
    assert.ok(
      full.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(full).startsWith('campus-reopen-migration-')
    )
    fs.rmSync(full, { recursive: true, force: true })
  }
})
