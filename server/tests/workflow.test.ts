import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CampusUser, CreateTaskPayload } from '../../shared/contracts.js'
import type { ReviewRevisionInput } from '../../shared/workflow-contracts.js'
import { createId, nowIso } from '../db/database.js'
import { seedWorkflowDemo } from '../demo/workflow-seed.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'
import {
  cancelTask,
  claimTask,
  copyTask,
  createTask,
  getTaskForViewer,
  restoreTask,
  reviewProof,
  startTask,
  submitProof,
  updateTask,
  withdrawTask
} from '../modules/tasks.service.js'
import {
  batchReviewWorkflow,
  bindParticipant,
  canReadWorkflowFile,
  closeoutWorkflow,
  configureWorkflow,
  confirmGroupParticipant,
  correctParticipantMinutes,
  fileIsReferenced,
  getTaskWorkflow,
  getWorkflowSnapshot,
  handoverWorkflow,
  importRoster,
  previewRosterImport,
  reopenParticipant,
  reopenWorkflow,
  reviewWorkflowRevision,
  setParticipantOutcome,
  submitCommonRevision,
  submitWorkflowRevision
} from '../modules/workflow.service.js'
import { closeTestApp, createAdmin, createTestApp, dataOf, login, testOrigin } from './helpers.js'
import { listReusableEvidence } from '../modules/workflow.service.js'

const payload = (capacity = 10): CreateTaskPayload => ({
  title: 'Volunteer garden / 校园花园',
  categoryId: 'category-event',
  campusId: 'campus-main',
  description: 'Document actual participation and reviewed evidence.',
  checklist: ['Record work completed'],
  date: '2098-10-10',
  startTime: '10:00',
  endTime: '12:00',
  signupDeadline: '2098-10-09 10:00',
  place: 'Community garden',
  duration: '120 planned minutes',
  capacity,
  audienceScope: 'school',
  requirements: [],
  proofTypes: ['text'],
  claimMode: 'direct',
  contacts: []
})
async function fixture() {
  const ctx = await createTestApp()
  const admin = await createAdmin(ctx)
  const make = (role: 'student' | 'teacher', account: string) =>
    createAdminManagedUser(ctx.db, {
      role,
      account,
      name: account,
      departmentId: 'dept-cs',
      ...(role === 'student' ? { gradeId: 'grade-2024', classId: 'class-24se1' } : {}),
      approval: 'approved',
      password: 'Campus@123'
    })
  const teacher = await make('teacher', 'WORKTEACH1')
  const replacement = await make('teacher', 'WORKTEACH2')
  const student = await make('student', 'WORKSTUD1')
  const otherStudent = await make('student', 'WORKSTUD2')
  const task = createTask(ctx.db, teacher, payload())
  return { ...ctx, admin, teacher, replacement, student, otherStudent, task }
}
function code(expected: string) {
  return (e: unknown) => Boolean(e && typeof e === 'object' && 'code' in e && e.code === expected)
}
function file(ctx: Awaited<ReturnType<typeof fixture>>, owner: CampusUser, taskId: string) {
  const id = createId('file')
  ctx.db.run(
    "INSERT INTO files(id,owner_user_id,task_id,purpose,stored_name,original_name,mime_type,size_bytes,width,height,status,expires_at,created_at) VALUES(?,?,?,'proof',?,?, 'image/png',10,1,1,'temporary',?,?)",
    id,
    owner.id,
    taskId,
    `${id}.png`,
    'evidence.png',
    Date.now() + 3600000,
    nowIso()
  )
  return id
}

test('roster preview preserves text IDs; conflict and replay create no accounts; binding is explicit and audited', async () => {
  const ctx = await fixture()
  try {
    const { db, teacher, task } = ctx
    const before = Number(db.get('SELECT COUNT(*) n FROM users')?.n)
    const input = {
      source: 'registration-2026',
      rows: [
        { externalId: '001', name: 'Same name' },
        { externalId: '002', name: 'Same name' }
      ]
    }
    const preview = previewRosterImport(db, teacher, task.id, input)
    assert.equal(preview.valid, true)
    assert.equal(preview.rows[0].externalId, '001')
    assert.deepEqual(preview.rows[0].warnings, ['SAME_NAME_DISTINCT_IDENTITIES'])
    const body = { ...input, hash: preview.hash, idempotencyKey: 'import-001' }
    let workflow = importRoster(db, teacher, task.id, body)
    assert.equal(workflow.participants.length, 2)
    assert.ok(workflow.participants.every(p => p.userId === null))
    workflow = importRoster(db, teacher, task.id, body)
    assert.equal(workflow.participants.length, 2)
    assert.equal(db.get('SELECT COUNT(*) n FROM users')?.n, before)
    const conflict = previewRosterImport(db, teacher, task.id, {
      source: input.source,
      rows: [{ externalId: '001', name: 'Different person' }]
    })
    assert.equal(conflict.valid, false)
    assert.ok(conflict.rows[0].errors.includes('EXISTING_ID_CONFLICT'))
    const duplicate = previewRosterImport(db, teacher, task.id, {
      source: input.source,
      rows: [
        { externalId: '009', name: 'A' },
        { externalId: '009', name: 'B' },
        { externalId: '', name: 'C' }
      ]
    })
    assert.equal(duplicate.valid, false)
    assert.ok(duplicate.rows[0].errors.includes('DUPLICATE_EXTERNAL_ID'))
    assert.ok(duplicate.rows[2].errors.includes('EXTERNAL_ID_REQUIRED'))
    const first = workflow.participants[0]
    workflow = bindParticipant(db, teacher, task.id, {
      participantId: first.id,
      userId: ctx.student.id,
      version: first.version
    })
    assert.equal(workflow.participants.length, 2)
    assert.equal(workflow.participants.find(p => p.id === first.id)?.externalId, first.externalId)
    assert.equal(getTaskWorkflow(db, ctx.student, task.id).participants.length, 1)
    assert.equal(getTaskWorkflow(db, ctx.otherStudent, task.id).participants.length, 0)
    assert.ok(db.get("SELECT id FROM audit_logs WHERE action='workflow.identity_bound' AND entity_id=?", task.id))
    assert.throws(
      () =>
        bindParticipant(db, teacher, task.id, {
          participantId: workflow.participants[1].id,
          userId: ctx.student.id,
          version: workflow.participants[1].version
        }),
      code('WORKFLOW_BIND_CONFLICT')
    )
    const session = await login(ctx, teacher.account, 'Campus@123')
    const unbound = workflow.participants.find(p => !p.userId)!
    const lookupUrl = `/api/tasks/${task.id}/workflow/binding-candidate`
    const lookup = await ctx.app.inject({
      method: 'POST',
      url: lookupUrl,
      headers: { cookie: session.cookie, origin: testOrigin, 'x-csrf-token': session.csrf },
      payload: { participantId: unbound.id, account: ctx.otherStudent.account.toLowerCase() }
    })
    assert.deepEqual(dataOf(lookup), {
      id: ctx.otherStudent.id,
      account: ctx.otherStudent.account,
      name: ctx.otherStudent.name,
      externalId: null
    })
    const nonOwner = await login(ctx, ctx.replacement.account, 'Campus@123')
    assert.equal(
      (
        await ctx.app.inject({
          method: 'POST',
          url: lookupUrl,
          headers: { cookie: nonOwner.cookie, origin: testOrigin, 'x-csrf-token': nonOwner.csrf },
          payload: { participantId: unbound.id, account: ctx.otherStudent.account }
        })
      ).statusCode,
      403
    )
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/workflow`,
      headers: { cookie: session.cookie, 'accept-language': 'en' }
    })
    assert.equal(response.statusCode, 200)
    assert.equal(dataOf<{ participants: unknown[] }>(response).participants.length, 2)
    const invalid = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/workflow/import/preview`,
      headers: { cookie: session.cookie, origin: testOrigin, 'x-csrf-token': session.csrf },
      payload: { source: 'test', rows: [{ externalId: 123, name: 'Numeric identity must not be coerced' }] }
    })
    // Fastify may coerce JSON scalar values. The API schema must preserve an identity as a string.
    assert.equal(invalid.statusCode, 400)
  } finally {
    await closeTestApp(ctx)
  }
})

test('immutable proof revisions retain old files; review locks each item; ownership handover revokes material access', async () => {
  const ctx = await fixture()
  try {
    const { db, teacher, student, otherStudent, task } = ctx
    claimTask(db, student, task.id)
    claimTask(db, otherStudent, task.id)
    startTask(db, student, task.id)
    let own = getTaskWorkflow(db, student, task.id).participants[0]
    const oldFile = file(ctx, student, task.id)
    submitProof(db, student, task.id, {
      version: own.version,
      description: 'First completed work description',
      note: '',
      fileIds: [oldFile]
    })
    own = getTaskWorkflow(db, student, task.id).participants[0]
    const revision1 = own.latestRevisionId!
    reviewWorkflowRevision(db, teacher, task.id, {
      participantId: own.id,
      version: own.version,
      revisionId: revision1,
      decision: 'changes_requested',
      feedback: 'Please clarify the work completed',
      missingItems: ['description']
    })
    own = getTaskWorkflow(db, student, task.id).participants[0]
    submitProof(db, student, task.id, {
      version: own.version,
      description: 'Corrected description of work completed',
      note: '',
      fileIds: []
    })
    own = getTaskWorkflow(db, student, task.id).participants[0]
    assert.equal(own.revisions.length, 2)
    assert.ok(own.revisions[1].changedFields.includes('fileIds'))
    assert.equal(own.revisions[0].reviews[0].feedback, 'Please clarify the work completed')
    assert.equal(db.get('SELECT status FROM files WHERE id=?', oldFile)?.status, 'attached')
    assert.equal(fileIsReferenced(db, oldFile), true)
    assert.equal(canReadWorkflowFile(db, student, oldFile), true)
    assert.equal(canReadWorkflowFile(db, otherStudent, oldFile), false)
    assert.throws(
      () => db.run('UPDATE workflow_revisions SET description=? WHERE id=?', 'tampered', revision1),
      /Immutable/
    )
    assert.throws(
      () =>
        reviewWorkflowRevision(db, teacher, task.id, {
          participantId: own.id,
          version: own.version,
          revisionId: revision1,
          decision: 'approved',
          feedback: '',
          confirmedMinutes: 60
        }),
      code('WORKFLOW_REVISION_STALE')
    )
    const other = getTaskWorkflow(db, otherStudent, task.id).participants[0]
    submitWorkflowRevision(db, otherStudent, task.id, {
      participantId: other.id,
      version: other.version,
      description: 'Another participant completed work',
      note: '',
      fileIds: []
    })
    const ready = getTaskWorkflow(db, teacher, task.id).participants
    const items: ReviewRevisionInput[] = ready.map(p => ({
      participantId: p.id,
      version: p.version,
      revisionId: p.latestRevisionId!,
      decision: 'approved',
      feedback: '',
      confirmedMinutes: 37
    }))
    items[1].version--
    const batch = batchReviewWorkflow(db, teacher, task.id, items)
    assert.equal(batch.results[0].ok, true)
    assert.equal(batch.results[1].ok, false)
    assert.equal(batch.results[1].code, 'STALE_VERSION')
    assert.equal(getTaskWorkflow(db, teacher, task.id).participants.filter(p => p.status === 'completed').length, 1)
    assert.equal(canReadWorkflowFile(db, teacher, oldFile), true)
    const version = getTaskForViewer(db, task.id, teacher).version
    handoverWorkflow(db, ctx.admin, task.id, {
      ownerId: ctx.replacement.id,
      version,
      reason: 'Staff responsibility changed'
    })
    assert.equal(canReadWorkflowFile(db, teacher, oldFile), false)
    assert.equal(canReadWorkflowFile(db, ctx.replacement, oldFile), true)
    assert.throws(() => getTaskWorkflow(db, teacher, task.id), code('TASK_FORBIDDEN'))
    assert.throws(
      () => reviewProof(db, teacher, task.id, { userId: otherStudent.id, version: 1, approved: true, feedback: '' }),
      code('TASK_FORBIDDEN')
    )
  } finally {
    await closeTestApp(ctx)
  }
})

test('eight-person group closes with six confirmations and two distinct non-completions; corrections create a new snapshot', async () => {
  const ctx = await fixture()
  try {
    const { db, teacher, task } = ctx
    let workflow = getTaskWorkflow(db, teacher, task.id)
    workflow = configureWorkflow(db, teacher, task.id, {
      version: workflow.config.version,
      templateId: 'community-garden',
      templateVersion: 1,
      mode: 'group',
      plannedMinutes: 120,
      submissionDeadline: null,
      personalSubmissionRequired: false
    })
    const input = {
      source: 'external-roster',
      rows: Array.from({ length: 8 }, (_, i) => ({
        externalId: String(i + 1).padStart(4, '0'),
        name: `Participant ${i + 1}`
      }))
    }
    workflow = importRoster(db, teacher, task.id, {
      ...input,
      hash: previewRosterImport(db, teacher, task.id, input).hash,
      idempotencyKey: 'eight-people'
    })
    const publicFile = file(ctx, teacher, task.id)
    workflow = submitCommonRevision(db, teacher, task.id, {
      version: workflow.config.version,
      description: 'Shared record of community garden work',
      note: '',
      fileIds: [publicFile]
    })
    const commonRevisionId = workflow.commonRevisions[0].id
    assert.equal(
      workflow.participants.every(p => p.status === 'upcoming'),
      true
    )
    assert.throws(
      () => closeoutWorkflow(db, teacher, task.id, { version: workflow.config.version, reason: 'Close' }),
      code('WORKFLOW_UNRESOLVED_PARTICIPANTS')
    )
    for (const p of workflow.participants.slice(0, 6))
      confirmGroupParticipant(db, teacher, task.id, {
        participantId: p.id,
        version: p.version,
        commonRevisionId,
        confirmedMinutes: 45,
        feedback: 'Attendance and completed work confirmed individually'
      })
    for (const [index, status] of [
      [6, 'incomplete'],
      [7, 'withdrawn']
    ] as const) {
      const p = workflow.participants[index]
      setParticipantOutcome(db, teacher, task.id, {
        participantId: p.id,
        version: p.version,
        status,
        reason: status === 'incomplete' ? 'Did not attend' : 'Withdrew before attendance'
      })
    }
    workflow = getTaskWorkflow(db, teacher, task.id)
    const first = closeoutWorkflow(db, teacher, task.id, {
      version: workflow.config.version,
      reason: 'First verified closeout'
    })
    assert.deepEqual(first.totals, {
      participants: 8,
      completed: 6,
      confirmedMinutes: 270,
      byStatus: { completed: 6, incomplete: 1, withdrawn: 1 }
    })
    assert.equal(first.participants.filter(p => p.commonRevisionId === commonRevisionId).length, 6)
    assert.equal(first.participants.filter(p => p.confirmedMinutes === null).length, 2)
    assert.equal(first.config.plannedMinutes, 120)
    assert.throws(
      () =>
        updateTask(db, teacher, task.id, {
          version: getTaskForViewer(db, task.id, teacher).version,
          title: 'Must not mutate closed snapshot'
        }),
      code('WORKFLOW_CLOSED')
    )
    assert.throws(() => db.run('UPDATE workflow_snapshots SET reason=? WHERE id=?', 'tampered', first.id), /Immutable/)
    assert.throws(() => getWorkflowSnapshot(db, ctx.student, task.id, first.id), code('TASK_FORBIDDEN'))
    workflow = reopenWorkflow(db, teacher, task.id, {
      version: getTaskWorkflow(db, teacher, task.id).config.version,
      reason: 'Correct one recorded duration'
    })
    const completed = workflow.participants.find(p => p.status === 'completed')!
    correctParticipantMinutes(db, teacher, task.id, {
      participantId: completed.id,
      version: completed.version,
      confirmedMinutes: 55,
      reason: 'Corrected attendance record'
    })
    const second = closeoutWorkflow(db, teacher, task.id, {
      version: getTaskWorkflow(db, teacher, task.id).config.version,
      reason: 'Corrected closeout'
    })
    assert.equal(second.version, 2)
    assert.equal(second.supersedesId, first.id)
    assert.equal(second.totals.confirmedMinutes, 280)
    assert.equal(getWorkflowSnapshot(db, teacher, task.id, first.id).totals.confirmedMinutes, 270)
    const copied = copyTask(db, teacher, task.id, { ...payload(8), title: 'Copied garden activity' })
    const copiedWorkflow = getTaskWorkflow(db, teacher, copied.id)
    assert.equal(copiedWorkflow.participants.length, 0)
    assert.equal(copiedWorkflow.commonRevisions.length, 0)
    assert.equal(copiedWorkflow.snapshots.length, 0)
    assert.equal(copiedWorkflow.config.templateId, 'community-garden')
    assert.equal(copiedWorkflow.config.status, 'open')
    handoverWorkflow(db, ctx.admin, task.id, {
      ownerId: ctx.replacement.id,
      version: getTaskForViewer(db, task.id, teacher).version,
      reason: 'New coordinator'
    })
    assert.equal(canReadWorkflowFile(db, teacher, publicFile), false)
    assert.equal(canReadWorkflowFile(db, ctx.replacement, publicFile), true)
    assert.throws(() => getWorkflowSnapshot(db, teacher, task.id, first.id), code('TASK_FORBIDDEN'))
  } finally {
    await closeTestApp(ctx)
  }
})

test('legacy withdrawal preserves a terminal record; selected reference creates a fresh unapproved revision', async () => {
  const ctx = await fixture()
  try {
    const { db, student, teacher, task } = ctx
    claimTask(db, ctx.otherStudent, task.id)
    withdrawTask(db, ctx.otherStudent, task.id)
    assert.equal(getTaskWorkflow(db, teacher, task.id).participants[0].status, 'withdrawn')
    assert.equal(db.get('SELECT COUNT(*) n FROM task_members WHERE task_id=?', task.id)?.n, 1)
    claimTask(db, student, task.id)
    let own = getTaskWorkflow(db, student, task.id).participants[0]
    const image = file(ctx, student, task.id)
    submitWorkflowRevision(db, student, task.id, {
      participantId: own.id,
      version: own.version,
      description: 'Original selected evidence record',
      note: '',
      fileIds: [image],
      reportedMinutes: 80
    })
    own = getTaskWorkflow(db, student, task.id).participants[0]
    reviewWorkflowRevision(db, teacher, task.id, {
      participantId: own.id,
      version: own.version,
      revisionId: own.latestRevisionId!,
      decision: 'approved',
      feedback: '',
      confirmedMinutes: 60
    })
    const newTask = createTask(db, teacher, { ...payload(), title: 'Independent later task' })
    claimTask(db, student, newTask.id)
    const newOwn = getTaskWorkflow(db, student, newTask.id).participants[0]
    const available = listReusableEvidence(db, student, newTask.id, newOwn.id)
    assert.ok(available.items.some(item => item.revision.id === own.latestRevisionId && item.taskId === task.id))
    assert.throws(() => listReusableEvidence(db, ctx.otherStudent, newTask.id, newOwn.id), code('TASK_FORBIDDEN'))
    submitWorkflowRevision(db, student, newTask.id, {
      participantId: newOwn.id,
      version: newOwn.version,
      description: 'Deliberate reference for a new use',
      note: '',
      fileIds: [image],
      sourceRevisionId: own.latestRevisionId!
    })
    const reused = getTaskWorkflow(db, student, newTask.id).participants[0]
    assert.equal(reused.status, 'review')
    assert.equal(reused.confirmedMinutes, null)
    assert.equal(reused.confirmedRevisionId, null)
    assert.equal(reused.revisions[0].sourceRevisionId, own.latestRevisionId)
    assert.equal(db.get('SELECT COUNT(*) n FROM workflow_revision_files WHERE file_id=?', image)?.n, 2)
    claimTask(db, ctx.otherStudent, newTask.id)
    const forbidden = getTaskWorkflow(db, ctx.otherStudent, newTask.id).participants[0]
    assert.throws(
      () =>
        submitWorkflowRevision(db, ctx.otherStudent, newTask.id, {
          participantId: forbidden.id,
          version: forbidden.version,
          description: 'Unauthorized reference attempt',
          note: '',
          fileIds: [image],
          sourceRevisionId: own.latestRevisionId!
        }),
      code('WORKFLOW_SOURCE_FORBIDDEN')
    )
  } finally {
    await closeTestApp(ctx)
  }
})

test('atomic template creation, terminal corrections, and repeatable bilingual 525-minute demo', async () => {
  const ctx = await fixture()
  try {
    const count = ctx.db.get('SELECT COUNT(*) n FROM tasks')?.n
    assert.throws(
      () =>
        createTask(ctx.db, ctx.teacher, {
          ...payload(),
          workflow: {
            templateId: 'missing-template',
            templateVersion: 1,
            mode: 'group',
            plannedMinutes: 60,
            submissionDeadline: null,
            personalSubmissionRequired: true
          }
        }),
      code('WORKFLOW_TEMPLATE_INVALID')
    )
    assert.equal(ctx.db.get('SELECT COUNT(*) n FROM tasks')?.n, count)
    const accounts = ctx.db.get('SELECT COUNT(*) n FROM users')?.n
    const first = seedWorkflowDemo(ctx.db, ctx.teacher)
    const replay = seedWorkflowDemo(ctx.db, ctx.teacher)
    assert.equal(replay.reused, true)
    assert.equal(replay.taskId, first.taskId)
    assert.equal(first.snapshot.totals.confirmedMinutes, 525)
    assert.equal(first.snapshot.totals.completed, 6)
    assert.equal(first.snapshot.totals.participants, 8)
    assert.equal(ctx.db.get('SELECT COUNT(*) n FROM users')?.n, accounts)
    assert.equal(first.snapshot.participants.find(p => p.externalId === '0006')?.revisions.length, 2)
    let workflow = getTaskWorkflow(ctx.db, ctx.teacher, first.taskId)
    workflow = reopenWorkflow(ctx.db, ctx.teacher, first.taskId, {
      version: workflow.config.version,
      reason: 'Correct materials after closeout'
    })
    const person = workflow.participants.find(p => p.externalId === '0001')!
    workflow = reopenParticipant(ctx.db, ctx.teacher, first.taskId, {
      participantId: person.id,
      version: person.version,
      reason: 'New supporting evidence must be reviewed'
    })
    const reopened = workflow.participants.find(p => p.id === person.id)!
    assert.equal(reopened.status, 'changes_requested')
    assert.equal(reopened.confirmedRevisionId, null)
    assert.equal(reopened.confirmedMinutes, null)
    assert.equal(reopened.reviews.at(-1)?.decision, 'reopened')
    assert.equal(getWorkflowSnapshot(ctx.db, ctx.teacher, first.taskId, first.snapshot.id).totals.confirmedMinutes, 525)
    assert.throws(
      () =>
        closeoutWorkflow(ctx.db, ctx.teacher, first.taskId, {
          version: workflow.config.version,
          reason: 'Must not silently reuse old approval'
        }),
      code('WORKFLOW_UNRESOLVED_PARTICIPANTS')
    )
  } finally {
    await closeTestApp(ctx)
  }
})

test('cancel and restore include imported identities while preserving prior withdrawals', async () => {
  const ctx = await fixture()
  try {
    const { db, teacher, task, student, otherStudent } = ctx
    const input = { source: 'outside-signups', rows: [{ externalId: '001', name: 'Imported participant' }] }
    importRoster(db, teacher, task.id, {
      ...input,
      hash: previewRosterImport(db, teacher, task.id, input).hash,
      idempotencyKey: 'cancel-demo'
    })
    claimTask(db, student, task.id)
    claimTask(db, otherStudent, task.id)
    withdrawTask(db, otherStudent, task.id)
    const cancelled = cancelTask(db, teacher, task.id, getTaskForViewer(db, task.id, teacher).version)
    const cancelledRoster = getTaskWorkflow(db, teacher, task.id).participants
    assert.equal(cancelledRoster.filter(p => p.status === 'cancelled').length, 2)
    assert.equal(cancelledRoster.filter(p => p.status === 'withdrawn').length, 1)
    restoreTask(db, ctx.admin, task.id, cancelled.version)
    const restored = getTaskWorkflow(db, teacher, task.id).participants
    assert.equal(restored.filter(p => p.status === 'upcoming').length, 2)
    assert.equal(restored.filter(p => p.status === 'withdrawn').length, 1)
  } finally {
    await closeTestApp(ctx)
  }
})
