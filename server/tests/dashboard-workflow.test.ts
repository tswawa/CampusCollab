import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CampusTask, CreateTaskPayload, DashboardData } from '../../shared/contracts.js'
import type { RosterImportPreview, TaskWorkflow } from '../../shared/workflow-contracts.js'
import { nowIso } from '../db/database.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'
import { createTask } from '../modules/tasks.service.js'
import { closeTestApp, createAdmin, createTestApp, dataOf, login, testOrigin } from './helpers.js'

type Context = Awaited<ReturnType<typeof createTestApp>>
type Session = Awaited<ReturnType<typeof login>>
const password = 'Dashboard@123'
const taskPayload = (title: string): CreateTaskPayload => ({ title, categoryId: 'category-event', campusId: 'campus-main',
  description: 'Fictional dashboard acceptance activity.', checklist: ['Record actual participation'], date: '2098-10-10',
  startTime: '10:00', endTime: '12:00', signupDeadline: '2098-10-09 10:00', place: 'Fictional garden',
  duration: '120 planned minutes', capacity: 2, audienceScope: 'school', requirements: [], proofTypes: ['text'], claimMode: 'direct', contacts: [] })
async function post<T>(context: Context, session: Session, url: string, payload: unknown): Promise<T> {
  const response = await context.app.inject({ method: 'POST', url,
    headers: { origin: testOrigin, cookie: session.cookie, 'x-csrf-token': session.csrf }, payload: payload as Record<string, unknown> })
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${url}: ${response.body}`)
  return dataOf<T>(response)
}
async function dashboard(context: Context, session: Session): Promise<DashboardData> {
  const response = await context.app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: session.cookie } })
  assert.equal(response.statusCode, 200, response.body)
  return dataOf<DashboardData>(response)
}

test('dashboard counts unbound workflow reviews once through binding, correction, cancellation and approval', async () => {
  const context = await createTestApp()
  try {
    const admin = await createAdmin(context, 'DASHADMIN', password)
    const teacher = await createAdminManagedUser(context.db, { role: 'teacher', account: 'DASHTEACH', name: 'Fictional coordinator',
      departmentId: 'dept-cs', password, approval: 'approved' })
    const student = await createAdminManagedUser(context.db, { role: 'student', account: 'DASHSTUDENT', name: 'Fictional participant',
      departmentId: 'dept-cs', gradeId: 'grade-2024', classId: 'class-24se1', password, approval: 'approved' })
    const adminSession = await login(context, admin.account, password)
    const teacherSession = await login(context, teacher.account, password)
    const studentSession = await login(context, student.account, password)
    const pending = async (expected: number) => assert.equal((await dashboard(context, adminSession)).stats.pendingProofs, expected)
    const task = await post<CampusTask>(context, teacherSession, '/api/tasks', taskPayload('Fictional roster reviews'))
    const base = `/api/tasks/${task.id}/workflow`
    const input = { source: 'fictional-dashboard-roster', rows: [{ externalId: '001', name: 'Fictional A' }, { externalId: '002', name: 'Fictional B' }] }
    const preview = await post<RosterImportPreview>(context, teacherSession, `${base}/import/preview`, input)
    let workflow = await post<TaskWorkflow>(context, teacherSession, `${base}/import`, { ...input, hash: preview.hash, idempotencyKey: 'dashboard-roster' })
    const firstId = workflow.participants.find(person => person.externalId === '001')!.id
    const secondId = workflow.participants.find(person => person.externalId === '002')!.id
    const person = (id: string) => workflow.participants.find(participant => participant.id === id)!
    const submit = async (id: string, session = teacherSession) => {
      workflow = await post<TaskWorkflow>(context, session, `${base}/submit`, { participantId: id, version: person(id).version,
        description: 'Recorded fictional participation and completed work.', note: '', fileIds: [], reportedMinutes: 75 })
    }
    const review = async (id: string, decision: 'approved' | 'changes_requested') => {
      workflow = await post<TaskWorkflow>(context, teacherSession, `${base}/review`, { participantId: id, version: person(id).version,
        revisionId: person(id).latestRevisionId, decision, feedback: decision === 'approved' ? 'Evidence checked' : 'Please clarify departure time',
        ...(decision === 'approved' ? { confirmedMinutes: 75 } : {}) })
    }

    await pending(0)
    await submit(firstId)
    assert.equal(person(firstId).status, 'review')
    assert.equal(context.db.get('SELECT COUNT(*) n FROM task_members WHERE task_id=?', task.id)?.n, 0)
    await pending(1)
    const teacherPending = await dashboard(context, teacherSession)
    assert.equal(teacherPending.stats.review, 1)
    assert.equal(teacherPending.recentTasks.find(item => item.id === task.id)?.status, 'review')
    await submit(secondId)
    await pending(2)
    assert.equal((await dashboard(context, teacherSession)).stats.review, 1, 'Teacher card counts tasks, not participants')

    workflow = await post<TaskWorkflow>(context, teacherSession, `${base}/bind`, { participantId: firstId, userId: student.id, version: person(firstId).version })
    assert.equal(context.db.get("SELECT COUNT(*) n FROM task_members WHERE task_id=? AND status='review'", task.id)?.n, 1)
    await pending(2)
    assert.deepEqual((await dashboard(context, studentSession)).stats, { active: 0, review: 1, completed: 0 })
    await review(firstId, 'changes_requested')
    await pending(1)
    assert.deepEqual((await dashboard(context, studentSession)).stats, { active: 1, review: 0, completed: 0 })
    await submit(firstId, studentSession)
    // A student response intentionally includes only their own row; restore the manager's full view.
    workflow = dataOf<TaskWorkflow>(await context.app.inject({ method: 'GET', url: base, headers: { cookie: teacherSession.cookie } }))
    await pending(2)
    await review(firstId, 'approved')
    await pending(1)
    assert.deepEqual((await dashboard(context, studentSession)).stats, { active: 0, review: 0, completed: 1 })

    const latestTask = dataOf<CampusTask>(await context.app.inject({ method: 'GET', url: `/api/tasks/${task.id}`, headers: { cookie: teacherSession.cookie } }))
    const cancelled = await post<CampusTask>(context, teacherSession, `/api/tasks/${task.id}/cancel`, { version: latestTask.version })
    await pending(0)
    assert.equal((await dashboard(context, teacherSession)).stats.review, 0)
    await post<CampusTask>(context, adminSession, `/api/tasks/${task.id}/restore`, { version: cancelled.version })
    workflow = dataOf<TaskWorkflow>(await context.app.inject({ method: 'GET', url: base, headers: { cookie: teacherSession.cookie } }))
    await pending(1)
    await review(secondId, 'approved')
    await pending(0)
    assert.equal((await dashboard(context, teacherSession)).stats.completed, 1)
    assert.deepEqual((await dashboard(context, studentSession)).stats, { active: 0, review: 0, completed: 1 })

    // Retain a legacy-only row alongside the same user's completed workflow in a different task.
    // This synthetic fixture represents data without a workflow projection; it never changes real data or triggers.
    const legacyTask = createTask(context.db, teacher, taskPayload('Fictional legacy review'))
    const timestamp = nowIso()
    context.db.run("INSERT INTO task_members(task_id,user_id,status,claimed_at,updated_at) VALUES(?,?,'review',?,?)", legacyTask.id, student.id, timestamp, timestamp)
    context.db.run('DELETE FROM workflow_participants WHERE task_id=? AND user_id=?', legacyTask.id, student.id)
    context.db.run('INSERT INTO proofs(id,task_id,user_id,description,note,submitted_at,version) VALUES(?,?,?,?,?,?,1)',
      'fixture-legacy-proof', legacyTask.id, student.id, 'Fictional legacy evidence', '', timestamp)
    await pending(1)
    assert.deepEqual((await dashboard(context, studentSession)).stats, { active: 0, review: 1, completed: 1 })
    context.db.run("UPDATE task_members SET status='completed' WHERE task_id=? AND user_id=?", legacyTask.id, student.id)
    await pending(0)
    assert.deepEqual(context.db.all('PRAGMA foreign_key_check'), [])
  } finally { await closeTestApp(context) }
})
