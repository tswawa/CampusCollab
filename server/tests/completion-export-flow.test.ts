import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import { unzipSync, strFromU8 } from 'fflate'
import { buildApp } from '../app.js'
import type { UploadData } from '../../shared/contracts.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'
import { claimTask, createTask, getTaskForViewer } from '../modules/tasks.service.js'
import { closeoutWorkflow, getTaskWorkflow, handoverWorkflow, reviewWorkflowRevision, submitWorkflowRevision } from '../modules/workflow.service.js'
import { closeTestApp, createAdmin, createTestApp, dataOf, login, testOrigin } from './helpers.js'

test('real uploaded evidence survives correction cleanup, exports only the approved image and follows handover permissions', async () => {
  let ctx = await createTestApp()
  try {
    const admin = await createAdmin(ctx)
    const teacher = await createAdminManagedUser(ctx.db, { role: 'teacher', account: 'EXTEACH', name: 'Export coordinator', departmentId: 'dept-cs', approval: 'approved', password: 'Export@123' })
    const replacement = await createAdminManagedUser(ctx.db, { role: 'teacher', account: 'EXNEXT', name: 'New coordinator', departmentId: 'dept-cs', approval: 'approved', password: 'Export@123' })
    const student = await createAdminManagedUser(ctx.db, { role: 'student', account: 'EXSTUD', name: 'Export participant', departmentId: 'dept-cs', gradeId: 'grade-2024', classId: 'class-24se1', approval: 'approved', password: 'Export@123' })
    const task = createTask(ctx.db, teacher, { title: 'Real image closeout', categoryId: 'category-event', campusId: 'campus-main', description: 'Test real uploaded images across a correction and closeout.', checklist: ['Work record'], date: '2098-10-10', startTime: '10:00', endTime: '12:00', signupDeadline: '2098-10-09 10:00', place: 'Campus garden', duration: '120 planned minutes', capacity: 1, audienceScope: 'school', requirements: [], proofTypes: ['image', 'text'], claimMode: 'direct', contacts: [] })
    claimTask(ctx.db, student, task.id)
    const learner = await login(ctx, student.account, 'Export@123')
    const coordinator = await login(ctx, teacher.account, 'Export@123')
    const upload = async (colour: string) => {
      const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: colour } }).png().toBuffer()
      const form = new FormData()
      form.append('file', new Blob([png], { type: 'image/png' }), 'activity.png')
      const multipart = new Request('http://test.local/upload', { method: 'POST', body: form })
      const response = await ctx.app.inject({ method: 'POST', url: `/api/files/proof?taskId=${task.id}`, headers: { origin: testOrigin, cookie: learner.cookie, 'x-csrf-token': learner.csrf, 'content-type': multipart.headers.get('content-type')! }, payload: Buffer.from(await multipart.arrayBuffer()) })
      assert.equal(response.statusCode, 201, response.body)
      return dataOf<UploadData>(response)
    }
    const old = await upload('#224466')
    const current = await upload('#226644')
    let person = getTaskWorkflow(ctx.db, student, task.id).participants[0]!
    submitWorkflowRevision(ctx.db, student, task.id, { participantId: person.id, version: person.version, description: 'Initial work evidence requiring correction', note: '', fileIds: [old.id], reportedMinutes: 120 })
    person = getTaskWorkflow(ctx.db, student, task.id).participants[0]!
    reviewWorkflowRevision(ctx.db, teacher, task.id, { participantId: person.id, version: person.version, revisionId: person.latestRevisionId!, decision: 'changes_requested', feedback: 'Replace the image with the completed work.', missingItems: ['images'] })
    person = getTaskWorkflow(ctx.db, student, task.id).participants[0]!
    submitWorkflowRevision(ctx.db, student, task.id, { participantId: person.id, version: person.version, description: 'Corrected evidence of completed work', note: '', fileIds: [current.id], reportedMinutes: 95 })
    person = getTaskWorkflow(ctx.db, student, task.id).participants[0]!
    reviewWorkflowRevision(ctx.db, teacher, task.id, { participantId: person.id, version: person.version, revisionId: person.latestRevisionId!, decision: 'approved', feedback: '', confirmedMinutes: 90 })
    // A stale temporary flag must never override a historical reference.
    ctx.db.run("UPDATE files SET status='temporary',expires_at=1 WHERE id=?", old.id)
    const savedConfig = ctx.db.config
    await ctx.app.close()
    const cleanup = spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/cleanup-files.ts'], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', MAIL_ENABLED: 'false', DATABASE_PATH: ctx.db.config.databasePath, UPLOAD_DIR: ctx.db.config.uploadDir, BACKUP_DIR: ctx.db.config.backupDir } })
    ctx = { ...await buildApp({ config: savedConfig, logger: false }), root: ctx.root }
    assert.equal(cleanup.status, 0, cleanup.stderr)
    const oldPath = path.join(ctx.db.config.uploadDir, String(ctx.db.get('SELECT stored_name FROM files WHERE id=?', old.id)!.stored_name))
    assert.ok(fs.existsSync(oldPath))
    assert.equal((await ctx.app.inject({ method: 'GET', url: old.url, headers: { cookie: coordinator.cookie } })).statusCode, 200)
    const workflow = getTaskWorkflow(ctx.db, teacher, task.id)
    const snapshot = closeoutWorkflow(ctx.db, teacher, task.id, { version: workflow.config.version, reason: 'All outcomes checked' })
    const endpoint = `/api/tasks/${task.id}/workflow/snapshots/${snapshot.id}/export?format=zip&locale=en`
    assert.equal((await ctx.app.inject({ method: 'GET', url: endpoint })).statusCode, 401)
    assert.equal((await ctx.app.inject({ method: 'GET', url: endpoint, headers: { cookie: learner.cookie } })).statusCode, 403)
    const exported = await ctx.app.inject({ method: 'GET', url: endpoint, headers: { cookie: coordinator.cookie } })
    assert.equal(exported.statusCode, 200, exported.body.slice(0, 300))
    assert.equal(exported.headers['cache-control'], 'private, no-store')
    const entries = unzipSync(exported.rawPayload)
    const images = Object.keys(entries).filter(name => name.endsWith('.png'))
    assert.equal(images.length, 1)
    assert.ok(images[0]!.includes(current.id)); assert.ok(!images[0]!.includes(old.id))
    const expected = await ctx.app.inject({ method: 'GET', url: current.url, headers: { cookie: coordinator.cookie } })
    assert.deepEqual(Buffer.from(entries[images[0]!]!), expected.rawPayload)
    assert.equal(JSON.parse(strFromU8(entries['manifest.json']!)).totals.confirmedMinutes, 90)
    handoverWorkflow(ctx.db, admin, task.id, { ownerId: replacement.id, version: getTaskForViewer(ctx.db, task.id, teacher).version, reason: 'Coordinator handover' })
    assert.equal((await ctx.app.inject({ method: 'GET', url: endpoint, headers: { cookie: coordinator.cookie } })).statusCode, 403)
    assert.equal((await ctx.app.inject({ method: 'GET', url: current.url, headers: { cookie: coordinator.cookie } })).statusCode, 403)
    const next = await login(ctx, replacement.account, 'Export@123')
    assert.equal((await ctx.app.inject({ method: 'GET', url: endpoint, headers: { cookie: next.cookie } })).statusCode, 200)
  } finally { await closeTestApp(ctx) }
})
