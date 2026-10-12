import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import type { CampusTask, CreateTaskPayload, UploadData } from '../../shared/contracts.js'
import { createId } from '../db/database.js'
import { createAdminManagedUser, updateAdminManagedUser } from '../modules/accounts.service.js'
import {
  approveApplication,
  cancelTask,
  claimTask,
  createTask,
  getTaskForViewer,
  inviteStudent,
  restoreTask,
  updateTask
} from '../modules/tasks.service.js'
import {
  bindParticipant,
  closeoutWorkflow,
  getTaskWorkflow,
  importRoster,
  previewRosterImport,
  reopenParticipant,
  reviewWorkflowRevision,
  setParticipantOutcome,
  submitWorkflowRevision
} from '../modules/workflow.service.js'
import { buildCompletionExport } from '../modules/completion-export.js'
import { closeTestApp, createAdmin, createTestApp, dataOf, login, testOrigin } from './helpers.js'

const payload = (claimMode: 'direct' | 'application' = 'direct', capacity = 10): CreateTaskPayload => ({
  title: 'Fictional participant regression',
  categoryId: 'category-event',
  campusId: 'campus-main',
  description: 'Fictional identities, admission and evidence regression.',
  checklist: [],
  date: '2098-10-10',
  startTime: '10:00',
  endTime: '12:00',
  signupDeadline: '2098-10-09 10:00',
  place: 'Fixture room',
  duration: '120 minutes',
  capacity,
  audienceScope: 'school',
  requirements: [],
  proofTypes: ['text'],
  claimMode,
  contacts: [{ type: 'office', label: 'Fictional office', value: 'PRIVATE-CONTACT-FIXTURE' }]
})
const hasCode = (expected: string) => (error: unknown) =>
  Boolean(error && typeof error === 'object' && 'code' in error && error.code === expected)
const headers = (session: { cookie: string; csrf: string }) => ({
  origin: testOrigin,
  cookie: session.cookie,
  'x-csrf-token': session.csrf
})
async function fixture() {
  const ctx = await createTestApp()
  const admin = await createAdmin(ctx)
  const teacher = await createAdminManagedUser(ctx.db, {
    role: 'teacher',
    account: 'CORETEACH',
    name: 'Fictional teacher',
    departmentId: 'dept-cs',
    approval: 'approved',
    password: 'Fixture@123'
  })
  const student = await createAdminManagedUser(ctx.db, {
    role: 'student',
    account: 'CORESTUDENT',
    name: 'Fictional student',
    departmentId: 'dept-cs',
    gradeId: 'grade-2024',
    classId: 'class-24se1',
    approval: 'approved',
    password: 'Fixture@123',
    externalId: '000123'
  })
  const other = await createAdminManagedUser(ctx.db, {
    role: 'student',
    account: 'COREOTHER',
    name: 'Other fictional student',
    departmentId: 'dept-cs',
    gradeId: 'grade-2024',
    classId: 'class-24se1',
    approval: 'approved',
    password: 'Fixture@123',
    externalId: '000124'
  })
  return { ...ctx, admin, teacher, student, other }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const own = (ctx: Fixture, taskId: string) => getTaskWorkflow(ctx.db, ctx.student, taskId).participants[0]!
function roster(ctx: Fixture, taskId: string, ids: string[], source = 'fixture-roster') {
  const input = { source, rows: ids.map(externalId => ({ externalId, name: `Fictional ${externalId}` })) }
  const preview = previewRosterImport(ctx.db, ctx.teacher, taskId, input)
  assert.equal(preview.valid, true)
  return importRoster(ctx.db, ctx.teacher, taskId, {
    ...input,
    hash: preview.hash,
    idempotencyKey: createId('fixture')
  })
}

test('never-admitted outcomes and task restoration keep contacts private until explicit approval', async () => {
  const ctx = await fixture()
  try {
    const studentSession = await login(ctx, ctx.student.account, 'Fixture@123')
    const teacherSession = await login(ctx, ctx.teacher.account, 'Fixture@123')
    const read = async (taskId: string) => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/tasks/${taskId}`,
        headers: { cookie: studentSession.cookie }
      })
      assert.equal(response.statusCode, 200)
      return dataOf<CampusTask>(response)
    }
    for (const outcome of ['withdrawn', 'rejected', 'cancelled'] as const) {
      const task = createTask(ctx.db, ctx.teacher, payload('application'))
      claimTask(ctx.db, ctx.student, task.id)
      assert.deepEqual((await read(task.id)).contacts, [])
      const person = own(ctx, task.id)
      const response =
        outcome === 'withdrawn'
          ? await ctx.app.inject({
              method: 'POST',
              url: `/api/tasks/${task.id}/withdraw`,
              headers: headers(studentSession),
              payload: {}
            })
          : await ctx.app.inject({
              method: 'POST',
              url: `/api/tasks/${task.id}/workflow/outcome`,
              headers: headers(teacherSession),
              payload: {
                participantId: person.id,
                version: person.version,
                status: outcome,
                reason: 'Fictional outcome'
              }
            })
      assert.equal(response.statusCode, 200, response.body)
      assert.deepEqual((await read(task.id)).contacts, [])
      const cancelled = cancelTask(ctx.db, ctx.teacher, task.id, getTaskForViewer(ctx.db, task.id, ctx.teacher).version)
      restoreTask(ctx.db, ctx.admin, task.id, cancelled.version)
      assert.deepEqual((await read(task.id)).contacts, [])
      const terminal = own(ctx, task.id)
      reopenParticipant(ctx.db, ctx.teacher, task.id, {
        participantId: terminal.id,
        version: terminal.version,
        reason: 'Reconsider the application'
      })
      assert.equal(own(ctx, task.id).status, 'applied')
      assert.equal(
        ctx.db.get(
          'SELECT event_type FROM notices WHERE user_id=? AND target_id=? ORDER BY rowid DESC LIMIT 1',
          ctx.student.id,
          task.id
        )?.event_type,
        'task.updated'
      )
      assert.deepEqual((await read(task.id)).contacts, [])
      approveApplication(ctx.db, ctx.teacher, task.id, ctx.student.id, own(ctx, task.id).version)
      assert.equal((await read(task.id)).contacts[0]?.value, 'PRIVATE-CONTACT-FIXTURE')
      const accepted = own(ctx, task.id)
      setParticipantOutcome(ctx.db, ctx.student, task.id, {
        participantId: accepted.id,
        version: accepted.version,
        status: 'withdrawn',
        reason: 'Fictional admitted withdrawal'
      })
      assert.equal((await read(task.id)).contacts.length, 1, 'A genuine historical admission survives the outcome')
      const afterAdmission = cancelTask(
        ctx.db,
        ctx.teacher,
        task.id,
        getTaskForViewer(ctx.db, task.id, ctx.teacher).version
      )
      restoreTask(ctx.db, ctx.admin, task.id, afterAdmission.version)
      assert.equal((await read(task.id)).contacts.length, 1)
      assert.equal(getTaskForViewer(ctx.db, task.id, ctx.teacher).contacts.length, 1)
    }
  } finally {
    await closeTestApp(ctx)
  }
})

test('binding an imported terminal identity preserves its admission and imported identifier', async () => {
  const ctx = await fixture()
  try {
    const task = createTask(ctx.db, ctx.teacher, payload())
    const person = roster(ctx, task.id, ['IMPORTED-0001']).participants[0]!
    setParticipantOutcome(ctx.db, ctx.teacher, task.id, {
      participantId: person.id,
      version: person.version,
      status: 'incomplete',
      reason: 'Fictional absence'
    })
    const terminal = getTaskWorkflow(ctx.db, ctx.teacher, task.id).participants[0]!
    bindParticipant(ctx.db, ctx.teacher, task.id, {
      participantId: terminal.id,
      version: terminal.version,
      userId: ctx.student.id
    })
    assert.equal(own(ctx, task.id).externalId, 'IMPORTED-0001')
    assert.equal(getTaskForViewer(ctx.db, task.id, ctx.student).contacts.length, 1)
    const bound = own(ctx, task.id)
    reopenParticipant(ctx.db, ctx.teacher, task.id, {
      participantId: bound.id,
      version: bound.version,
      reason: 'Admitted participant supplies correction'
    })
    assert.equal(own(ctx, task.id).status, 'changes_requested')
    assert.equal(
      ctx.db.get(
        'SELECT event_type FROM notices WHERE user_id=? AND target_id=? ORDER BY rowid DESC LIMIT 1',
        ctx.student.id,
        task.id
      )?.event_type,
      'task.changes_requested'
    )
    assert.equal(getTaskWorkflow(ctx.db, ctx.teacher, task.id).participants.length, 1)
  } finally {
    await closeTestApp(ctx)
  }
})

test('cancelled capacity counts bound and unbound accepted identities but not prior withdrawal or pending application', async () => {
  const ctx = await fixture()
  try {
    const task = createTask(ctx.db, ctx.teacher, payload('application', 3))
    const people = roster(ctx, task.id, ['001', '002', '003']).participants
    bindParticipant(ctx.db, ctx.teacher, task.id, {
      participantId: people[0]!.id,
      version: people[0]!.version,
      userId: ctx.student.id
    })
    setParticipantOutcome(ctx.db, ctx.teacher, task.id, {
      participantId: people[2]!.id,
      version: people[2]!.version,
      status: 'withdrawn',
      reason: 'Fictional prior withdrawal'
    })
    claimTask(ctx.db, ctx.other, task.id)
    const cancelled = cancelTask(ctx.db, ctx.teacher, task.id, getTaskForViewer(ctx.db, task.id, ctx.teacher).version)
    assert.equal(cancelled.occupiedCount, 2)
    assert.throws(
      () => updateTask(ctx.db, ctx.admin, task.id, { version: cancelled.version, capacity: 1 }),
      hasCode('TASK_CAPACITY_OCCUPIED')
    )
    const resized = updateTask(ctx.db, ctx.admin, task.id, { version: cancelled.version, capacity: 2 })
    // Simulate an already-inconsistent pre-fix cancelled task. Restore must roll
    // back every member change instead of perpetuating that older corruption.
    ctx.db.run('UPDATE tasks SET capacity=1 WHERE id=?', task.id)
    const before = ctx.db.all(
      'SELECT id,status,status_before_cancel,version FROM workflow_participants WHERE task_id=? ORDER BY id',
      task.id
    )
    assert.throws(() => restoreTask(ctx.db, ctx.admin, task.id, resized.version), hasCode('TASK_CAPACITY_OCCUPIED'))
    assert.deepEqual(
      ctx.db.all(
        'SELECT id,status,status_before_cancel,version FROM workflow_participants WHERE task_id=? ORDER BY id',
        task.id
      ),
      before
    )
    assert.equal(getTaskForViewer(ctx.db, task.id, ctx.admin).status, 'cancelled')
    ctx.db.run('UPDATE tasks SET capacity=2 WHERE id=?', task.id)
    const restored = restoreTask(ctx.db, ctx.admin, task.id, resized.version)
    assert.equal(restored.occupiedCount, 2)
    const states = getTaskWorkflow(ctx.db, ctx.teacher, task.id)
      .participants.map(person => person.status)
      .sort()
    assert.deepEqual(states, ['applied', 'upcoming', 'upcoming', 'withdrawn'])
  } finally {
    await closeTestApp(ctx)
  }
})

test('native participation snapshots current text identifiers while imports and closed snapshots remain unchanged', async () => {
  const ctx = await fixture()
  try {
    const first = createTask(ctx.db, ctx.teacher, payload())
    claimTask(ctx.db, ctx.student, first.id)
    assert.equal(own(ctx, first.id).externalId, '000123')
    let person = own(ctx, first.id)
    submitWorkflowRevision(ctx.db, ctx.student, first.id, {
      participantId: person.id,
      version: person.version,
      description: 'Fictional completed work',
      note: '',
      fileIds: []
    })
    person = own(ctx, first.id)
    reviewWorkflowRevision(ctx.db, ctx.teacher, first.id, {
      participantId: person.id,
      version: person.version,
      revisionId: person.latestRevisionId!,
      decision: 'approved',
      feedback: '',
      confirmedMinutes: 60
    })
    const snapshot = closeoutWorkflow(ctx.db, ctx.teacher, first.id, {
      version: getTaskWorkflow(ctx.db, ctx.teacher, first.id).config.version,
      reason: 'Fictional closeout'
    })
    const saved = ctx.db.get('SELECT snapshot_json FROM workflow_snapshots WHERE id=?', snapshot.id)?.snapshot_json
    const changed = await updateAdminManagedUser(ctx.db, ctx.admin, ctx.student.id, {
      role: 'student',
      account: ctx.student.account,
      name: ctx.student.name,
      departmentId: ctx.student.departmentId,
      classId: ctx.student.classId,
      gradeId: ctx.student.gradeId,
      approval: 'approved',
      externalId: '000999',
      version: ctx.student.version
    })
    const second = createTask(ctx.db, ctx.teacher, payload())
    inviteStudent(ctx.db, ctx.teacher, second.id, changed.user.id, second.version)
    assert.equal(own(ctx, second.id).externalId, '000999')
    assert.equal(own(ctx, first.id).externalId, '000123')
    assert.equal(
      ctx.db.get('SELECT snapshot_json FROM workflow_snapshots WHERE id=?', snapshot.id)?.snapshot_json,
      saved
    )
    const exported = await buildCompletionExport(ctx.db, snapshot, 'en', 'csv')
    assert.ok(exported.data.toString('utf8').includes('"000123"'))
  } finally {
    await closeTestApp(ctx)
  }
})

test('native account-source ID collisions reject claim and invite without merging or dropping identifiers', async () => {
  const ctx = await fixture()
  try {
    for (const action of ['claim', 'invite'] as const) {
      const task = createTask(ctx.db, ctx.teacher, payload())
      const original = roster(ctx, task.id, ['000123'], 'account').participants[0]!
      assert.throws(
        () =>
          action === 'claim'
            ? claimTask(ctx.db, ctx.student, task.id)
            : inviteStudent(
                ctx.db,
                ctx.teacher,
                task.id,
                ctx.student.id,
                getTaskForViewer(ctx.db, task.id, ctx.teacher).version
              ),
        hasCode('WORKFLOW_BIND_CONFLICT')
      )
      const after = getTaskWorkflow(ctx.db, ctx.teacher, task.id).participants
      assert.equal(after.length, 1)
      assert.equal(after[0]!.externalId, '000123')
      assert.equal(after[0]!.userId, null)
      assert.equal(ctx.db.get('SELECT COUNT(*) n FROM task_members WHERE task_id=?', task.id)?.n, 0)
      bindParticipant(ctx.db, ctx.teacher, task.id, {
        participantId: original.id,
        version: original.version,
        userId: ctx.student.id
      })
      assert.equal(own(ctx, task.id).id, original.id)
      assert.equal(own(ctx, task.id).source, 'account')
      assert.equal(own(ctx, task.id).externalId, '000123')
    }
  } finally {
    await closeTestApp(ctx)
  }
})

test('shared uploaded images appear in formal DTOs and survive an authorized legacy correction submission', async () => {
  const ctx = await fixture()
  try {
    const a = createTask(ctx.db, ctx.teacher, payload()),
      b = createTask(ctx.db, ctx.teacher, payload())
    claimTask(ctx.db, ctx.student, a.id)
    claimTask(ctx.db, ctx.student, b.id)
    const studentSession = await login(ctx, ctx.student.account, 'Fixture@123')
    const teacherSession = await login(ctx, ctx.teacher.account, 'Fixture@123')
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#225588' } })
      .png()
      .toBuffer()
    const form = new FormData()
    form.append('file', new Blob([png], { type: 'image/png' }), 'fixture.png')
    const multipart = new Request('http://test.local/upload', { method: 'POST', body: form })
    const uploaded = await ctx.app.inject({
      method: 'POST',
      url: `/api/files/proof?taskId=${a.id}`,
      headers: { ...headers(studentSession), 'content-type': multipart.headers.get('content-type')! },
      payload: Buffer.from(await multipart.arrayBuffer())
    })
    assert.equal(uploaded.statusCode, 201, uploaded.body)
    const image = dataOf<UploadData>(uploaded)
    const pa = own(ctx, a.id)
    submitWorkflowRevision(ctx.db, ctx.student, a.id, {
      participantId: pa.id,
      version: pa.version,
      description: 'Fictional source evidence',
      note: '',
      fileIds: [image.id]
    })
    const sourceRevision = own(ctx, a.id).latestRevisionId!
    const pb = own(ctx, b.id)
    submitWorkflowRevision(ctx.db, ctx.student, b.id, {
      participantId: pb.id,
      version: pb.version,
      description: 'Fictional referenced evidence',
      note: '',
      fileIds: [image.id],
      sourceRevisionId: sourceRevision
    })
    const original = own(ctx, b.id).revisions[0]!
    assert.deepEqual(getTaskForViewer(ctx.db, b.id, ctx.student).members[0]!.proof?.fileIds, [image.id])
    const review = await ctx.app.inject({
      method: 'GET',
      url: `/api/reviews?taskId=${b.id}`,
      headers: { cookie: teacherSession.cookie }
    })
    assert.equal(review.statusCode, 200)
    assert.deepEqual(dataOf<{ items: Array<{ proof: { fileIds: string[] } }> }>(review).items[0]!.proof.fileIds, [
      image.id
    ])
    let person = own(ctx, b.id)
    reviewWorkflowRevision(ctx.db, ctx.teacher, b.id, {
      participantId: person.id,
      version: person.version,
      revisionId: person.latestRevisionId!,
      decision: 'changes_requested',
      feedback: 'Correct only the text'
    })
    const current = getTaskForViewer(ctx.db, b.id, ctx.student).members[0]!
    const correction = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${b.id}/proof`,
      headers: headers(studentSession),
      payload: {
        version: current.version,
        description: 'Corrected fictional text retaining image',
        note: '',
        fileIds: current.proof!.fileIds
      }
    })
    assert.equal(correction.statusCode, 200, correction.body)
    assert.deepEqual(dataOf<CampusTask>(correction).members[0]!.proof?.fileIds, [image.id])
    person = own(ctx, b.id)
    assert.equal(person.revisions.length, 2)
    assert.deepEqual({ ...person.revisions[0], reviews: [] }, { ...original, reviews: [] })
    assert.equal(person.revisions[0]!.reviews.length, 1, 'The correction request remains in review history')
    assert.deepEqual(person.revisions[1]!.fileIds, [image.id])
    assert.equal(person.revisions[0]!.sourceRevisionId, sourceRevision)
    claimTask(ctx.db, ctx.other, b.id)
    const otherPerson = getTaskWorkflow(ctx.db, ctx.other, b.id).participants[0]!
    assert.throws(
      () =>
        submitWorkflowRevision(ctx.db, ctx.other, b.id, {
          participantId: otherPerson.id,
          version: otherPerson.version,
          description: 'Attempt unauthorized image reuse',
          note: '',
          fileIds: [image.id]
        }),
      hasCode('PROOF_FILE_FORBIDDEN')
    )
    assert.throws(
      () =>
        submitWorkflowRevision(ctx.db, ctx.other, b.id, {
          participantId: otherPerson.id,
          version: otherPerson.version,
          description: 'Attempt unauthorized source reuse',
          note: '',
          fileIds: [image.id],
          sourceRevisionId: sourceRevision
        }),
      hasCode('WORKFLOW_SOURCE_FORBIDDEN')
    )
  } finally {
    await closeTestApp(ctx)
  }
})
