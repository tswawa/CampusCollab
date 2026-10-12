import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import type { LightMyRequestResponse } from 'fastify'
import sharp from 'sharp'
import type { CampusTask, CampusUser, CreateTaskPayload, SchoolProfile, UploadData } from '../../shared/contracts.js'
import type { TaskWorkflow, WorkflowSnapshot } from '../../shared/workflow-contracts.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'
import { closeTestApp, createAdmin, createTestApp, dataOf, login, testOrigin, type TestContext } from './helpers.js'

const password = 'Fictional@123'
const day = 86400000
const headers = (session: { cookie: string; csrf: string }) => ({
  origin: testOrigin,
  cookie: session.cookie,
  'x-csrf-token': session.csrf
})
type Session = Awaited<ReturnType<typeof login>>
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
const request = (ctx: TestContext, session: Session | undefined, method: Method, url: string, payload?: object) =>
  ctx.app.inject({
    method,
    url,
    headers: session ? headers(session) : {},
    ...(payload === undefined ? {} : { payload })
  })
function success<T>(response: LightMyRequestResponse): T {
  assert.ok(response.statusCode === 200 || response.statusCode === 201, response.body)
  return dataOf<T>(response)
}
function failure(response: LightMyRequestResponse, code: string, status = 409) {
  assert.equal(response.statusCode, status, response.body)
  assert.equal(response.json().code, code)
}
async function make(ctx: TestContext, role: CampusUser['role'], account: string): Promise<Session> {
  await createAdminManagedUser(ctx.db, {
    role,
    account,
    name: `Fictional ${account}`,
    password,
    approval: 'approved',
    departmentId: 'dept-cs',
    ...(role === 'student' ? { gradeId: 'grade-2024', classId: 'class-24se1' } : {})
  })
  return login(ctx, account, password)
}
function payload(title: string, extra: Partial<CreateTaskPayload> = {}): CreateTaskPayload {
  const dateAt = (days: number) => new Date(Date.now() + days * day).toISOString().slice(0, 10)
  return {
    title,
    categoryId: 'category-event',
    campusId: 'campus-main',
    description: 'Fictional task regression evidence.',
    checklist: [],
    date: dateAt(2),
    startTime: '10:00',
    endTime: '12:00',
    signupDeadline: `${dateAt(1)} 12:00`,
    place: 'Fictional room',
    duration: '60 minutes',
    capacity: 2,
    audienceScope: 'school',
    requirements: [],
    proofTypes: ['text'],
    claimMode: 'application',
    contacts: [{ type: 'office', label: 'Office', value: 'Fictional private contact' }],
    ...extra
  }
}
const taskView = async (ctx: TestContext, session: Session, id: string) =>
  success<CampusTask>(await request(ctx, session, 'GET', `/api/tasks/${id}`))
const workflow = async (ctx: TestContext, session: Session, id: string) =>
  success<TaskWorkflow>(await request(ctx, session, 'GET', `/api/tasks/${id}/workflow`))
const wpost = async (ctx: TestContext, session: Session, id: string, action: string, body: object) =>
  success<TaskWorkflow>(await request(ctx, session, 'POST', `/api/tasks/${id}/workflow/${action}`, body))
function participant(value: TaskWorkflow, userId: string) {
  const found = value.participants.find(item => item.userId === userId)
  assert.ok(found)
  return found
}
async function complete(ctx: TestContext, student: Session, teacher: Session, id: string) {
  let person = participant(await workflow(ctx, student, id), student.user.id)
  await wpost(ctx, student, id, 'submit', {
    participantId: person.id,
    version: person.version,
    description: 'Fictional completed work with sufficient detail.',
    note: '',
    fileIds: []
  })
  person = participant(await workflow(ctx, teacher, id), student.user.id)
  await wpost(ctx, teacher, id, 'review', {
    participantId: person.id,
    version: person.version,
    revisionId: person.latestRevisionId,
    decision: 'approved',
    feedback: '',
    confirmedMinutes: 60
  })
}
async function closeout(ctx: TestContext, teacher: Session, id: string) {
  const current = await workflow(ctx, teacher, id)
  return success<WorkflowSnapshot>(
    await request(ctx, teacher, 'POST', `/api/tasks/${id}/workflow/closeout`, {
      version: current.config.version,
      reason: 'Fictional closeout'
    })
  )
}

test('reopened admission and invitations use workflow state while self-signup keeps its deadline', async () => {
  const ctx = await createTestApp()
  const realNow = Date.now
  try {
    const teacher = await make(ctx, 'teacher', 'R2TEACHER')
    const otherTeacher = await make(ctx, 'teacher', 'R2OTHERTEACHER')
    const a = await make(ctx, 'student', 'R2STUDENTA')
    const b = await make(ctx, 'student', 'R2STUDENTB')
    const c = await make(ctx, 'student', 'R2STUDENTC')
    const task = success<CampusTask>(await request(ctx, teacher, 'POST', '/api/tasks', payload('Admission correction')))
    for (const student of [a, b]) success(await request(ctx, student, 'POST', `/api/tasks/${task.id}/claim`, {}))
    let current = await workflow(ctx, teacher, task.id)
    success(
      await request(ctx, teacher, 'POST', `/api/tasks/${task.id}/approve`, {
        userId: a.user.id,
        version: participant(current, a.user.id).version
      })
    )
    const rejected = participant(await workflow(ctx, teacher, task.id), b.user.id)
    await wpost(ctx, teacher, task.id, 'outcome', {
      participantId: rejected.id,
      version: rejected.version,
      status: 'rejected',
      reason: 'Fictional mistaken rejection'
    })
    await complete(ctx, a, teacher, task.id)
    const first = await closeout(ctx, teacher, task.id)
    const original = ctx.db.get('SELECT snapshot_json FROM workflow_snapshots WHERE id=?', first.id)?.snapshot_json
    assert.ok(original)
    const closedVersion = (await taskView(ctx, teacher, task.id)).version
    for (const [session, action, body] of [
      [teacher, 'approve', { userId: b.user.id, version: rejected.version }],
      [teacher, 'invite', { userId: c.user.id, version: closedVersion }],
      [c, 'claim', {}]
    ] as const)
      failure(await request(ctx, session, 'POST', `/api/tasks/${task.id}/${action}`, body), 'WORKFLOW_CLOSED')

    const inviteTask = success<CampusTask>(
      await request(
        ctx,
        teacher,
        'POST',
        '/api/tasks',
        payload('Managed invitation after deadline', { claimMode: 'direct' })
      )
    )
    success(await request(ctx, a, 'POST', `/api/tasks/${inviteTask.id}/claim`, {}))
    await complete(ctx, a, teacher, inviteTask.id)
    // Only this test process advances time; the session TTL still covers these four days.
    Date.now = () => realNow() + 4 * day
    current = await workflow(ctx, teacher, task.id)
    await wpost(ctx, teacher, task.id, 'reopen', {
      version: current.config.version,
      reason: 'Correct the rejected application'
    })
    const terminal = participant(await workflow(ctx, teacher, task.id), b.user.id)
    current = await wpost(ctx, teacher, task.id, 'reopen-participant', {
      participantId: terminal.id,
      version: terminal.version,
      reason: 'Require explicit admission'
    })
    const applicant = participant(current, b.user.id)
    assert.equal(current.config.status, 'open')
    assert.equal(applicant.status, 'applied')
    assert.equal((await taskView(ctx, teacher, task.id)).status, 'completed')
    assert.equal((await taskView(ctx, teacher, task.id)).remainingSeats, 1)
    assert.deepEqual((await taskView(ctx, b, task.id)).contacts, [])
    failure(await request(ctx, c, 'POST', `/api/tasks/${task.id}/claim`, {}), 'TASK_DEADLINE_PASSED')
    failure(
      await request(ctx, otherTeacher, 'POST', `/api/tasks/${task.id}/approve`, {
        userId: b.user.id,
        version: applicant.version
      }),
      'TASK_FORBIDDEN',
      403
    )
    failure(
      await request(ctx, teacher, 'POST', `/api/tasks/${task.id}/approve`, {
        userId: b.user.id,
        version: applicant.version - 1
      }),
      'STALE_VERSION'
    )
    success(
      await request(ctx, teacher, 'POST', `/api/tasks/${task.id}/approve`, {
        userId: b.user.id,
        version: applicant.version
      })
    )
    const admitted = participant(await workflow(ctx, teacher, task.id), b.user.id)
    assert.equal(admitted.status, 'upcoming')
    assert.equal((await taskView(ctx, b, task.id)).contacts[0]?.value, 'Fictional private contact')
    failure(
      await request(ctx, teacher, 'POST', `/api/tasks/${task.id}/approve`, {
        userId: b.user.id,
        version: admitted.version
      }),
      'TASK_APPLICATION_PROCESSED'
    )
    await complete(ctx, b, teacher, task.id)
    const second = await closeout(ctx, teacher, task.id)
    assert.equal(second.supersedesId, first.id)
    assert.equal(second.totals.completed, 2)
    assert.equal(
      ctx.db.get('SELECT snapshot_json FROM workflow_snapshots WHERE id=?', first.id)?.snapshot_json,
      original
    )

    const beforeInvite = await taskView(ctx, teacher, inviteTask.id)
    assert.equal(beforeInvite.status, 'completed')
    assert.equal((await workflow(ctx, teacher, inviteTask.id)).config.status, 'open')
    const invited = success<CampusTask>(
      await request(ctx, teacher, 'POST', `/api/tasks/${inviteTask.id}/invite`, {
        userId: c.user.id,
        version: beforeInvite.version
      })
    )
    assert.equal(participant(await workflow(ctx, teacher, inviteTask.id), c.user.id).status, 'upcoming')
    failure(
      await request(ctx, teacher, 'POST', `/api/tasks/${inviteTask.id}/invite`, {
        userId: b.user.id,
        version: invited.version
      }),
      'TASK_FULL'
    )
    assert.deepEqual(ctx.db.all('PRAGMA foreign_key_check'), [])
  } finally {
    Date.now = realNow
    await closeTestApp(ctx)
  }
})

test('capacity and cancellation still reject approval, self-signup and invitations', async () => {
  const ctx = await createTestApp()
  try {
    const teacher = await make(ctx, 'teacher', 'R2CAPTEACH')
    const a = await make(ctx, 'student', 'R2CAPA')
    const b = await make(ctx, 'student', 'R2CAPB')
    const c = await make(ctx, 'student', 'R2CAPC')
    const task = success<CampusTask>(
      await request(ctx, teacher, 'POST', '/api/tasks', payload('Capacity and cancellation', { capacity: 1 }))
    )
    for (const student of [a, b]) success(await request(ctx, student, 'POST', `/api/tasks/${task.id}/claim`, {}))
    success(
      await request(ctx, teacher, 'POST', `/api/tasks/${task.id}/approve`, {
        userId: a.user.id,
        version: participant(await workflow(ctx, teacher, task.id), a.user.id).version
      })
    )
    failure(
      await request(ctx, teacher, 'POST', `/api/tasks/${task.id}/approve`, {
        userId: b.user.id,
        version: participant(await workflow(ctx, teacher, task.id), b.user.id).version
      }),
      'TASK_FULL'
    )
    failure(await request(ctx, c, 'POST', `/api/tasks/${task.id}/claim`, {}), 'TASK_FULL')
    failure(
      await request(ctx, teacher, 'POST', `/api/tasks/${task.id}/invite`, {
        userId: c.user.id,
        version: (await taskView(ctx, teacher, task.id)).version
      }),
      'TASK_FULL'
    )
    success(
      await request(ctx, teacher, 'POST', `/api/tasks/${task.id}/cancel`, {
        version: (await taskView(ctx, teacher, task.id)).version
      })
    )
    failure(
      await request(ctx, teacher, 'POST', `/api/tasks/${task.id}/approve`, {
        userId: b.user.id,
        version: participant(await workflow(ctx, teacher, task.id), b.user.id).version
      }),
      'TASK_CANCELLED'
    )
    failure(await request(ctx, c, 'POST', `/api/tasks/${task.id}/claim`, {}), 'TASK_CANCELLED')
    failure(
      await request(ctx, teacher, 'POST', `/api/tasks/${task.id}/invite`, {
        userId: c.user.id,
        version: (await taskView(ctx, teacher, task.id)).version
      }),
      'TASK_CANCELLED'
    )
  } finally {
    await closeTestApp(ctx)
  }
})

test('handover history prevents deletion with 409 but does not forbid changing the current role or disabling', async () => {
  const ctx = await createTestApp()
  try {
    await createAdmin(ctx)
    const admin = await login(ctx, 'ADMIN001', 'Admin@123')
    const old = await make(ctx, 'teacher', 'R2OLDOWNER')
    const next = await make(ctx, 'teacher', 'R2NEWOWNER')
    const unused = await make(ctx, 'teacher', 'R2UNUSED')
    const task = success<CampusTask>(await request(ctx, old, 'POST', '/api/tasks', payload('Historical ownership')))
    failure(
      await request(ctx, admin, 'DELETE', `/api/admin/accounts/${old.user.id}`, { version: old.user.version }),
      'USER_HAS_TASKS'
    )
    await wpost(ctx, admin, task.id, 'handover', {
      ownerId: next.user.id,
      version: task.version,
      reason: 'Fictional handover'
    })
    failure(
      await request(ctx, admin, 'DELETE', `/api/admin/accounts/${old.user.id}`, { version: old.user.version }),
      'USER_HAS_WORKFLOW_HISTORY'
    )
    assert.equal(ctx.db.get('SELECT version FROM users WHERE id=?', old.user.id)?.version, old.user.version)
    assert.equal(
      ctx.db.get('SELECT original_owner_id FROM workflow_tasks WHERE task_id=?', task.id)?.original_owner_id,
      old.user.id
    )
    const changed = success<CampusUser>(
      await request(ctx, admin, 'PATCH', `/api/admin/accounts/${old.user.id}`, {
        account: old.user.account,
        name: old.user.name,
        role: 'student',
        approval: 'approved',
        departmentId: 'dept-cs',
        gradeId: 'grade-2024',
        classId: 'class-24se1',
        version: old.user.version
      })
    )
    assert.equal(changed.role, 'student')
    const disabled = success<CampusUser>(
      await request(ctx, admin, 'POST', `/api/admin/accounts/${old.user.id}/status`, {
        approval: 'disabled',
        version: changed.version
      })
    )
    assert.equal(disabled.approval, 'disabled')
    failure(
      await request(ctx, admin, 'DELETE', `/api/admin/accounts/${old.user.id}`, { version: disabled.version }),
      'USER_HAS_WORKFLOW_HISTORY'
    )
    success(
      await request(ctx, admin, 'DELETE', `/api/admin/accounts/${unused.user.id}`, { version: unused.user.version })
    )
    assert.equal(ctx.db.get('SELECT id FROM users WHERE id=?', unused.user.id), undefined)
    assert.deepEqual(ctx.db.all('PRAGMA foreign_key_check'), [])
  } finally {
    await closeTestApp(ctx)
  }
})

test('independent import, submission, review and closeout authors retain their historical identities', async () => {
  const ctx = await createTestApp()
  try {
    await createAdmin(ctx)
    const admin = await login(ctx, 'ADMIN001', 'Admin@123')
    const teacher = await make(ctx, 'teacher', 'R2HISTORYOWNER')
    const importer = await make(ctx, 'admin', 'R2IMPORTER')
    const submitter = await make(ctx, 'admin', 'R2SUBMITTER')
    const reviewer = await make(ctx, 'admin', 'R2REVIEWER')
    const closer = await make(ctx, 'admin', 'R2CLOSER')
    const task = success<CampusTask>(
      await request(ctx, teacher, 'POST', '/api/tasks', payload('Distinct historical actors'))
    )
    const roster = { source: 'Fictional roster', rows: [{ externalId: '0001', name: 'Fictional participant' }] }
    const preview = success<{ hash: string }>(
      await request(ctx, importer, 'POST', `/api/tasks/${task.id}/workflow/import/preview`, roster)
    )
    let current = await wpost(ctx, importer, task.id, 'import', {
      ...roster,
      hash: preview.hash,
      idempotencyKey: 'distinct-actors'
    })
    let person = current.participants[0]!
    current = await wpost(ctx, submitter, task.id, 'submit', {
      participantId: person.id,
      version: person.version,
      description: 'Fictional evidence entered by a separate administrator.',
      note: '',
      fileIds: []
    })
    person = current.participants[0]!
    await wpost(ctx, reviewer, task.id, 'review', {
      participantId: person.id,
      version: person.version,
      revisionId: person.latestRevisionId,
      decision: 'approved',
      feedback: '',
      confirmedMinutes: 30
    })
    const snapshot = await closeout(ctx, closer, task.id)
    const original = ctx.db.get('SELECT snapshot_json FROM workflow_snapshots WHERE id=?', snapshot.id)?.snapshot_json
    for (const actor of [importer, submitter, reviewer, closer]) {
      assert.equal(ctx.db.get('SELECT id FROM tasks WHERE teacher_id=?', actor.user.id), undefined)
      assert.equal(ctx.db.get('SELECT user_id FROM task_members WHERE user_id=?', actor.user.id), undefined)
      failure(
        await request(ctx, admin, 'DELETE', `/api/admin/accounts/${actor.user.id}`, { version: actor.user.version }),
        'USER_HAS_WORKFLOW_HISTORY'
      )
      assert.equal(ctx.db.get('SELECT version FROM users WHERE id=?', actor.user.id)?.version, actor.user.version)
    }
    assert.equal(
      ctx.db.get('SELECT snapshot_json FROM workflow_snapshots WHERE id=?', snapshot.id)?.snapshot_json,
      original
    )
    assert.deepEqual(ctx.db.all('PRAGMA foreign_key_check'), [])
  } finally {
    await closeTestApp(ctx)
  }
})

async function uploadLogo(ctx: TestContext, session: Session, color: string) {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: color } })
    .png()
    .toBuffer()
  const boundary = 'R2LogoRegressionBoundary'
  const multipart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fictional.png"\r\nContent-Type: image/png\r\n\r\n`
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ])
  return success<UploadData>(
    await ctx.app.inject({
      method: 'POST',
      url: '/api/files/logo',
      headers: { ...headers(session), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart
    })
  )
}
async function publishLogo(ctx: TestContext, session: Session, logoFileId: string) {
  const school = success<SchoolProfile>(await request(ctx, undefined, 'GET', '/api/school'))
  return success<SchoolProfile>(
    await request(ctx, session, 'PUT', '/api/admin/school', {
      name: school.name,
      platformName: school.platformName,
      badge: school.badge,
      announcement: school.announcement,
      primaryColor: school.primaryColor,
      version: school.version,
      logoFileId,
      defaultLocale: 'en'
    })
  )
}

test('current institution logo protects its uploader; replacement permits ordinary draft cleanup and deletion', async () => {
  const ctx = await createTestApp()
  try {
    await createAdmin(ctx)
    const admin = await login(ctx, 'ADMIN001', 'Admin@123')
    let author = await make(ctx, 'admin', 'R2LOGOAUTHOR')
    const unused = await make(ctx, 'admin', 'R2LOGOUNUSED')
    const logo = await uploadLogo(ctx, author, '#246A49')
    await publishLogo(ctx, author, logo.id)
    const row = ctx.db.get('SELECT stored_name,status FROM files WHERE id=?', logo.id)!
    const diskPath = path.join(ctx.config.uploadDir, String(row.stored_name))
    const bytes = fs.readFileSync(diskPath)
    const readLogo = () => request(ctx, undefined, 'GET', logo.url)
    const before = await readLogo()
    assert.equal(before.statusCode, 200)
    assert.deepEqual(before.rawPayload, bytes)
    success(
      await request(ctx, admin, 'DELETE', `/api/admin/accounts/${unused.user.id}`, { version: unused.user.version })
    )
    assert.equal((await readLogo()).statusCode, 200)
    const protectedDelete = await request(ctx, admin, 'DELETE', `/api/admin/accounts/${author.user.id}`, {
      version: author.user.version
    })
    failure(protectedDelete, 'USER_OWNS_CURRENT_LOGO')
    assert.match(protectedDelete.json().message, /Replace the logo first or disable the account/)
    assert.equal(ctx.db.get('SELECT version FROM users WHERE id=?', author.user.id)?.version, author.user.version)
    assert.deepEqual(ctx.db.get('SELECT stored_name,status FROM files WHERE id=?', logo.id), row)
    assert.equal(ctx.db.get('SELECT logo_file_id FROM school_settings WHERE id=1')?.logo_file_id, logo.id)
    assert.deepEqual(fs.readFileSync(diskPath), bytes)
    const disabled = success<CampusUser>(
      await request(ctx, admin, 'POST', `/api/admin/accounts/${author.user.id}/status`, {
        approval: 'disabled',
        version: author.user.version
      })
    )
    assert.equal((await readLogo()).statusCode, 200)
    failure(
      await request(ctx, admin, 'DELETE', `/api/admin/accounts/${author.user.id}`, { version: disabled.version }),
      'USER_OWNS_CURRENT_LOGO'
    )
    success(
      await request(ctx, admin, 'POST', `/api/admin/accounts/${author.user.id}/status`, {
        approval: 'approved',
        version: disabled.version
      })
    )
    author = await login(ctx, author.user.account, password)

    const replacement = await uploadLogo(ctx, admin, '#1E60D5')
    await publishLogo(ctx, admin, replacement.id)
    assert.equal(ctx.db.get('SELECT status FROM files WHERE id=?', logo.id)?.status, 'temporary')
    success(await request(ctx, author, 'DELETE', logo.url, {}))
    assert.equal(ctx.db.get('SELECT id FROM files WHERE id=?', logo.id), undefined)
    assert.equal(fs.existsSync(diskPath), false)
    success(
      await request(ctx, admin, 'DELETE', `/api/admin/accounts/${author.user.id}`, { version: author.user.version })
    )
    assert.equal(ctx.db.get('SELECT id FROM users WHERE id=?', author.user.id), undefined)
    assert.equal(ctx.db.get('SELECT logo_file_id FROM school_settings WHERE id=1')?.logo_file_id, replacement.id)
    assert.equal((await request(ctx, undefined, 'GET', replacement.url)).statusCode, 200)
    assert.deepEqual(ctx.db.all('PRAGMA foreign_key_check'), [])
  } finally {
    await closeTestApp(ctx)
  }
})
