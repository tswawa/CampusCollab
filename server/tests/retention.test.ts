import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import type { CreateTaskPayload, UploadData } from '../../shared/contracts.js'
import { createId, nowIso } from '../db/database.js'
import { createEventNotice } from '../i18n/notices.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'
import { claimTask, createTask, startTask, submitProof } from '../modules/tasks.service.js'
import {
  closeoutWorkflow,
  getTaskWorkflow,
  reviewWorkflowRevision,
  submitWorkflowRevision
} from '../modules/workflow.service.js'
import {
  previewTaskRetention,
  purgeTaskRetention,
  retentionOverview,
  retryFileDeletions,
  type RetentionPreview
} from '../retention/service.js'
import { closeTestApp, createAdmin, createTestApp, dataOf, login, testOrigin } from './helpers.js'

const payload: CreateTaskPayload = {
  title: 'Fictional retained activity',
  categoryId: 'category-event',
  campusId: 'campus-main',
  description: 'Fictional records for retention verification.',
  checklist: [],
  date: '2099-01-03',
  startTime: '10:00',
  endTime: '12:00',
  signupDeadline: '2099-01-02 12:00',
  place: 'Garden',
  duration: '120 minutes',
  capacity: 8,
  audienceScope: 'school',
  requirements: [],
  proofTypes: ['text'],
  claimMode: 'direct',
  contacts: []
}

async function fixture() {
  const context = await createTestApp()
  const admin = await createAdmin(context)
  const teacher = await createAdminManagedUser(context.db, {
    role: 'teacher',
    account: 'RETTEACH1',
    name: 'Fictional owner',
    password: 'Example@123',
    approval: 'approved',
    departmentId: 'dept-cs'
  })
  const student = await createAdminManagedUser(context.db, {
    role: 'student',
    account: 'RETSTUD1',
    name: 'Fictional participant',
    password: 'Example@123',
    approval: 'approved',
    departmentId: 'dept-cs',
    gradeId: 'grade-2024',
    classId: 'class-24se1'
  })
  const task = createTask(context.db, teacher, payload)
  claimTask(context.db, student, task.id)
  startTask(context.db, student, task.id)
  return { ...context, admin, teacher, student, task }
}

function agedClosedSnapshot(context: Awaited<ReturnType<typeof fixture>>, taskId = context.task.id) {
  const old = new Date(Date.now() - 400 * 86400000).toISOString()
  context.db.run("UPDATE workflow_tasks SET status='closed',version=version+1 WHERE task_id=?", taskId)
  context.db.run(
    "INSERT INTO workflow_snapshots(id,task_id,version,reason,snapshot_json,created_by,created_at) VALUES(?,?,1,'Fictional retention fixture','{}',?,?)",
    createId('snapshot'),
    taskId,
    context.teacher.id,
    old
  )
}
const confirm = (preview: RetentionPreview) => ({
  version: preview.taskVersion,
  previewHash: preview.previewHash,
  confirmation: preview.taskId
})

test('retention clears image consumers in dependency order and deletes only files owned by each task', async t => {
  const context = await fixture()
  try {
    const { db, teacher, student, admin } = context
    const a = context.task
    const b = createTask(db, teacher, { ...payload, title: 'Fictional image consumer with own image' })
    const c = createTask(db, teacher, { ...payload, title: 'Fictional final image consumer' })
    for (const task of [b, c]) claimTask(db, student, task.id)
    const session = await login(context, student.account, 'Example@123')
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#236789' } })
      .png()
      .toBuffer()
    const uploadImage = async (taskId: string) => {
      const form = new FormData()
      form.append('file', new Blob([png], { type: 'image/png' }), 'fictional-shared.png')
      const request = new Request('http://test.local/upload', { method: 'POST', body: form })
      const response = await context.app.inject({
        method: 'POST',
        url: `/api/files/proof?taskId=${taskId}`,
        headers: {
          origin: testOrigin,
          cookie: session.cookie,
          'x-csrf-token': session.csrf,
          'content-type': request.headers.get('content-type')!
        },
        payload: Buffer.from(await request.arrayBuffer())
      })
      assert.equal(response.statusCode, 201, response.body)
      const file = dataOf<UploadData>(response)
      const storedName = String(db.get('SELECT stored_name FROM files WHERE id=?', file.id)?.stored_name)
      return { id: file.id, absolute: path.resolve(context.config.uploadDir, storedName) }
    }
    const imageA = await uploadImage(a.id)
    const imageB = await uploadImage(b.id)
    const originalA = fs.readFileSync(imageA.absolute)
    const submit = (taskId: string, fileIds: string[], sourceRevisionId?: string) => {
      const p = getTaskWorkflow(db, student, taskId).participants[0]
      const result = submitWorkflowRevision(db, student, taskId, {
        participantId: p.id,
        version: p.version,
        description: 'Fictional work completed with shared images.',
        note: '',
        fileIds,
        sourceRevisionId
      })
      return result.participants[0].latestRevisionId!
    }
    const sourceA = submit(a.id, [imageA.id])
    const sourceB = submit(b.id, [imageA.id, imageB.id], sourceA)
    submit(c.id, [imageA.id, imageB.id], sourceB)
    for (const task of [a, b, c]) {
      const p = getTaskWorkflow(db, teacher, task.id).participants[0]
      const result = reviewWorkflowRevision(db, teacher, task.id, {
        participantId: p.id,
        version: p.version,
        revisionId: p.latestRevisionId!,
        decision: 'approved',
        feedback: '',
        confirmedMinutes: 30
      })
      closeoutWorkflow(db, teacher, task.id, {
        version: result.config.version,
        reason: 'Fictional retained completion'
      })
    }
    const future = Date.now() + 401 * 86400000
    t.mock.method(Date, 'now', () => future)
    const previewA = previewTaskRetention(db, admin, a.id)
    const previewB = previewTaskRetention(db, admin, b.id)
    const previewC = previewTaskRetention(db, admin, c.id)
    assert.equal(previewA.eligible, false)
    assert.equal(previewB.eligible, false)
    assert.equal(previewC.eligible, true)
    assert.equal(previewC.counts.files, 0)
    assert.equal(previewC.counts.fileBytes, 0)
    purgeTaskRetention(db, admin, c.id, confirm(previewC))
    assert.ok(fs.existsSync(imageA.absolute))
    assert.ok(fs.existsSync(imageB.absolute))
    assert.equal(db.get('SELECT COUNT(*) n FROM retention_file_deletions')?.n, 0)
    assert.throws(() => purgeTaskRetention(db, admin, b.id, confirm(previewB)), { code: 'RETENTION_PREVIEW_STALE' })
    const freshB = previewTaskRetention(db, admin, b.id)
    assert.equal(freshB.eligible, true)
    assert.equal(freshB.counts.files, 1)
    const deletedB = purgeTaskRetention(db, admin, b.id, confirm(freshB))
    assert.equal(deletedB.files.deleted, 1)
    assert.equal(fs.existsSync(imageB.absolute), false)
    assert.deepEqual(fs.readFileSync(imageA.absolute), originalA)
    assert.ok(db.get('SELECT id FROM workflow_revisions WHERE id=?', sourceA))
    assert.equal(db.get('SELECT COUNT(*) n FROM retention_file_deletions WHERE file_id=?', imageA.id)?.n, 0)
    const freshA = previewTaskRetention(db, admin, a.id)
    assert.equal(freshA.eligible, true)
    const deletedA = purgeTaskRetention(db, admin, a.id, confirm(freshA))
    assert.equal(deletedA.files.deleted, 1)
    assert.equal(fs.existsSync(imageA.absolute), false)
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), [])
  } finally {
    await closeTestApp(context)
  }
})

test('retention pages cover every closed task exactly once and reject invalid page numbers', async () => {
  const context = await fixture()
  try {
    const expectedIds: string[] = []
    for (let index = 0; index < 205; index += 1) {
      const task = createTask(context.db, context.teacher, {
        ...payload,
        title: `Fictional retained activity ${index}`
      })
      agedClosedSnapshot(context, task.id)
      expectedIds.push(task.id)
    }
    // Equal timestamps exercise the task-id tiebreaker across page boundaries.
    context.db.run("UPDATE workflow_tasks SET updated_at=? WHERE status='closed'", '2000-01-01T00:00:00.000Z')
    const session = await login(context, 'ADMIN001', 'Admin@123')
    const readPage = async (page?: number) => {
      const response = await context.app.inject({
        method: 'GET',
        url: `/api/admin/retention${page === undefined ? '' : `?page=${page}`}`,
        headers: { cookie: session.cookie }
      })
      assert.equal(response.statusCode, 200, response.body)
      return dataOf<ReturnType<typeof retentionOverview>>(response)
    }
    const first = await readPage()
    const second = await readPage(2)
    const third = await readPage(3)
    const afterLast = await readPage(4)
    assert.deepEqual(
      [first, second, third, afterLast].map(result => [
        result.page,
        result.pageSize,
        result.total,
        result.items.length
      ]),
      [
        [1, 100, 205, 100],
        [2, 100, 205, 100],
        [3, 100, 205, 5],
        [4, 100, 205, 0]
      ]
    )
    const items = [...first.items, ...second.items, ...third.items]
    assert.deepEqual(
      items.map(item => item.taskId),
      expectedIds.sort()
    )
    assert.equal(new Set(items.map(item => item.taskId)).size, 205)
    assert.ok(items.every(item => item.eligible && item.blockers.length === 0))
    assert.deepEqual(
      retentionOverview(context.db, context.admin).items.map(item => item.taskId),
      first.items.map(item => item.taskId)
    )
    for (const page of [-1, 0, 1.5]) {
      const invalid = await context.app.inject({
        method: 'GET',
        url: `/api/admin/retention?page=${page}`,
        headers: { cookie: session.cookie }
      })
      assert.equal(invalid.statusCode, 400, `page=${page}`)
    }
  } finally {
    await closeTestApp(context)
  }
})

test('real multipart proof upload under proof/ is retained until an explicit authorized purge and then removed', async () => {
  const context = await fixture()
  try {
    const studentSession = await login(context, context.student.account, 'Example@123')
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#123456' } })
      .png()
      .toBuffer()
    const form = new FormData()
    form.append('file', new Blob([png], { type: 'image/png' }), 'fictional-evidence.png')
    const multipart = new Request('http://test.local/upload', { method: 'POST', body: form })
    const upload = await context.app.inject({
      method: 'POST',
      url: `/api/files/proof?taskId=${context.task.id}`,
      headers: {
        origin: testOrigin,
        cookie: studentSession.cookie,
        'x-csrf-token': studentSession.csrf,
        'content-type': multipart.headers.get('content-type')!
      },
      payload: Buffer.from(await multipart.arrayBuffer())
    })
    assert.equal(upload.statusCode, 201)
    const file = dataOf<UploadData>(upload)
    const stored = String(context.db.get('SELECT stored_name FROM files WHERE id=?', file.id)?.stored_name)
    assert.match(stored, /^proof\//)
    const absolute = path.resolve(context.config.uploadDir, stored)
    assert.ok(fs.existsSync(absolute))
    let member = getTaskWorkflow(context.db, context.student, context.task.id).participants[0]
    submitProof(context.db, context.student, context.task.id, {
      version: member.version,
      description: 'Fictional completed work for retention.',
      note: '',
      fileIds: [file.id]
    })
    member = getTaskWorkflow(context.db, context.teacher, context.task.id).participants[0]
    reviewWorkflowRevision(context.db, context.teacher, context.task.id, {
      participantId: member.id,
      version: member.version,
      revisionId: member.latestRevisionId!,
      decision: 'approved',
      feedback: '',
      confirmedMinutes: 30
    })
    agedClosedSnapshot(context)
    assert.throws(() => context.db.run('DELETE FROM workflow_revisions WHERE task_id=?', context.task.id), /Immutable/)
    assert.throws(() => context.db.run('DELETE FROM workflow_snapshots WHERE task_id=?', context.task.id), /Immutable/)
    const adminSession = await login(context, 'ADMIN001', 'Admin@123')
    const adminHeaders = {
      origin: testOrigin,
      cookie: adminSession.cookie,
      'x-csrf-token': adminSession.csrf,
      'accept-language': 'en'
    }
    const previewResponse = await context.app.inject({
      method: 'GET',
      url: `/api/admin/retention/tasks/${context.task.id}/preview`,
      headers: adminHeaders
    })
    assert.equal(previewResponse.statusCode, 200)
    const preview = dataOf<RetentionPreview>(previewResponse)
    assert.deepEqual(preview.blockers, [])
    assert.equal(preview.counts.files, 1)
    assert.equal(preview.counts.revisions, 1)
    const unauthorized = await context.app.inject({
      method: 'POST',
      url: `/api/admin/retention/tasks/${context.task.id}/purge`,
      headers: { origin: testOrigin, cookie: studentSession.cookie, 'x-csrf-token': studentSession.csrf },
      payload: confirm(preview)
    })
    assert.equal(unauthorized.statusCode, 403)
    const missingConfirmation = await context.app.inject({
      method: 'POST',
      url: `/api/admin/retention/tasks/${context.task.id}/purge`,
      headers: adminHeaders,
      payload: { ...confirm(preview), confirmation: 'wrong-task' }
    })
    assert.equal(missingConfirmation.json().code, 'RETENTION_CONFIRMATION_REQUIRED')
    const purge = await context.app.inject({
      method: 'POST',
      url: `/api/admin/retention/tasks/${context.task.id}/purge`,
      headers: adminHeaders,
      payload: confirm(preview)
    })
    assert.equal(purge.statusCode, 200, purge.body)
    assert.equal(purge.json().data.files.deleted, 1)
    assert.equal(fs.existsSync(absolute), false)
    for (const table of [
      'tasks',
      'workflow_tasks',
      'task_members',
      'proofs',
      'workflow_participants',
      'workflow_revisions',
      'workflow_reviews',
      'workflow_snapshots',
      'files'
    ])
      assert.equal(context.db.get(`SELECT COUNT(*) n FROM ${table}`)?.n, 0, table)
    assert.equal(context.db.get('SELECT COUNT(*) n FROM users')?.n, 3, 'Account identity is retained')
    assert.equal(context.db.get('SELECT COUNT(*) n FROM retention_context')?.n, 0)
    assert.deepEqual(context.db.all('PRAGMA foreign_key_check'), [])
    const audit = context.db.all("SELECT * FROM audit_logs WHERE entity_type='task' AND entity_id=?", context.task.id)
    assert.equal(audit.length, 1)
    assert.equal(audit[0].action, 'retention.purge')
    assert.equal(String(audit[0].details_json).includes('Fictional participant'), false)
  } finally {
    await closeTestApp(context)
  }
})

test('retention blocks fresh/open tasks, cross-task evidence, sending mail, legacy notices, and stale previews', async () => {
  const context = await fixture()
  try {
    assert.ok(
      previewTaskRetention(context.db, context.admin, context.task.id).blockers.some(
        b => b.code === 'RETENTION_TASK_OPEN'
      )
    )
    let member = getTaskWorkflow(context.db, context.student, context.task.id).participants[0]
    submitProof(context.db, context.student, context.task.id, {
      version: member.version,
      description: 'Fictional retained evidence.',
      note: '',
      fileIds: []
    })
    member = getTaskWorkflow(context.db, context.student, context.task.id).participants[0]
    const other = createTask(context.db, context.teacher, { ...payload, title: 'Other fictional task' })
    const crossId = createId('revision')
    context.db.run(
      "INSERT INTO workflow_revisions(id,task_id,scope,revision,description,note,submitted_by,submitted_at,source_revision_id) VALUES(?,?,'common',1,'Fictional copied evidence','',?,?,?)",
      crossId,
      other.id,
      context.teacher.id,
      nowIso(),
      member.latestRevisionId!
    )
    const sharedFile = createId('file')
    context.db.run(
      "INSERT INTO files(id,owner_user_id,task_id,purpose,stored_name,original_name,mime_type,size_bytes,width,height,status,created_at) VALUES(?,?,?,'proof',?,'fixture.png','image/png',1,1,1,'attached',?)",
      sharedFile,
      context.student.id,
      context.task.id,
      `proof/${sharedFile}.png`,
      nowIso()
    )
    context.db.run(
      'INSERT INTO workflow_revision_files(revision_id,file_id,sort_order) VALUES(?,?,0)',
      member.latestRevisionId!,
      sharedFile
    )
    context.db.run(
      'INSERT INTO workflow_revision_files(revision_id,file_id,sort_order) VALUES(?,?,0)',
      crossId,
      sharedFile
    )
    agedClosedSnapshot(context)
    assert.ok(
      previewTaskRetention(context.db, context.admin, context.task.id).blockers.some(
        b => b.code === 'RETENTION_CROSS_TASK_REFERENCE'
      )
    )
    assert.ok(
      previewTaskRetention(context.db, context.admin, context.task.id).blockers.some(
        b => b.code === 'RETENTION_SHARED_FILE'
      )
    )
    assert.throws(
      () =>
        purgeTaskRetention(
          context.db,
          context.admin,
          context.task.id,
          confirm(previewTaskRetention(context.db, context.admin, context.task.id))
        ),
      { code: 'RETENTION_BLOCKED' }
    )
    context.db.run(
      "INSERT INTO notices(id,user_id,title,content,type,read,created_at) VALUES('legacy-retention',?,'Historical','Unattributed old message','task',0,?)",
      context.student.id,
      nowIso()
    )
    assert.ok(
      previewTaskRetention(context.db, context.admin, context.task.id).blockers.some(
        b => b.code === 'RETENTION_LEGACY_NOTICES'
      )
    )
    const notice = createEventNotice(
      context.db,
      context.student.id,
      'task.updated',
      { taskTitle: context.task.title },
      { kind: 'task', id: context.task.id }
    )
    context.db.run(
      "INSERT INTO mail_deliveries(id,notice_id,user_id,recipient_email,status,created_at,updated_at) VALUES('retention-sending',?,?,'fictional@example.invalid','sending',?,?)",
      notice,
      context.student.id,
      nowIso(),
      nowIso()
    )
    assert.ok(
      previewTaskRetention(context.db, context.admin, context.task.id).blockers.some(
        b => b.code === 'RETENTION_MAIL_IN_FLIGHT'
      )
    )
    const preview = previewTaskRetention(context.db, context.admin, context.task.id)
    context.db.run('UPDATE school_settings SET retention_days=366')
    assert.throws(() => purgeTaskRetention(context.db, context.admin, context.task.id, confirm(preview)), {
      code: 'RETENTION_PREVIEW_STALE'
    })
    assert.ok(context.db.get('SELECT id FROM workflow_revisions WHERE id=?', crossId))
    assert.ok(context.db.get('SELECT id FROM files WHERE id=?', sharedFile))
    assert.equal(context.db.get('SELECT COUNT(*) n FROM retention_context')?.n, 0)
  } finally {
    await closeTestApp(context)
  }
})

test('purge failures roll back the scoped context; tombstones reject traversal and junction escapes and can retry safely', async () => {
  const context = await fixture()
  try {
    agedClosedSnapshot(context)
    context.db.raw.exec(
      "CREATE TRIGGER fixture_purge_failure BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT,'fixture purge failure'); END"
    )
    const preview = previewTaskRetention(context.db, context.admin, context.task.id)
    assert.throws(
      () => purgeTaskRetention(context.db, context.admin, context.task.id, confirm(preview)),
      /fixture purge failure/
    )
    assert.ok(context.db.get('SELECT id FROM tasks WHERE id=?', context.task.id))
    assert.equal(context.db.get('SELECT COUNT(*) n FROM workflow_snapshots')?.n, 1)
    assert.equal(context.db.get('SELECT COUNT(*) n FROM retention_context')?.n, 0)
    assert.throws(() => context.db.run('DELETE FROM workflow_snapshots WHERE task_id=?', context.task.id), /Immutable/)
    context.db.raw.exec('DROP TRIGGER fixture_purge_failure')
    fs.mkdirSync(context.config.uploadDir, { recursive: true })
    const outside = path.join(context.root, 'outside')
    fs.mkdirSync(outside)
    const protectedFile = path.join(outside, 'protected.txt')
    fs.writeFileSync(protectedFile, 'preserve')
    const addTombstone = (id: string, name: string) =>
      context.db.run(
        'INSERT INTO retention_file_deletions(id,task_id,file_id,stored_name,size_bytes,created_at) VALUES(?,?,?,?,1,?)',
        id,
        context.task.id,
        id,
        name,
        nowIso()
      )
    addTombstone('traversal', '../outside/protected.txt')
    const junction = path.join(context.config.uploadDir, 'linked')
    fs.symlinkSync(outside, junction, process.platform === 'win32' ? 'junction' : 'dir')
    addTombstone('junction', 'linked/protected.txt')
    const first = retryFileDeletions(context.db, context.admin)
    assert.equal(first.failed, 2)
    assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'preserve')
    assert.equal(
      context.db.get("SELECT last_error_code FROM retention_file_deletions WHERE id='junction'")?.last_error_code,
      'RETENTION_FILE_PATH_INVALID'
    )
    // Remove just the verified junction, then create a normal in-scope directory.
    assert.ok(fs.lstatSync(junction).isSymbolicLink())
    fs.unlinkSync(junction)
    fs.mkdirSync(junction)
    fs.writeFileSync(path.join(junction, 'protected.txt'), 'in-scope retry')
    const retry = retryFileDeletions(context.db, context.admin)
    assert.equal(retry.deleted, 1)
    assert.equal(retry.failed, 1)
    assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'preserve')
    assert.equal(fs.existsSync(path.join(junction, 'protected.txt')), false)
    assert.deepEqual(context.db.all('PRAGMA foreign_key_check'), [])
  } finally {
    await closeTestApp(context)
  }
})
