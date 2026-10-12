import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import type { CampusTask, SchoolProfile, UploadData } from '../../shared/contracts.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'
import { nowIso } from '../db/database.js'
import { cleanupExpiredTemporaryFiles } from '../modules/file-cleanup.js'
import { anonymousSession, closeTestApp, createAdmin, createTestApp, dataOf, login, testOrigin } from './helpers.js'

async function multipart(file: Buffer, type: string, name: string) {
  const form = new FormData()
  form.append('file', new Blob([file], { type }), name)
  const request = new Request('http://test.local/upload', { method: 'POST', body: form })
  return {
    payload: Buffer.from(await request.arrayBuffer()),
    contentType: request.headers.get('content-type')!
  }
}

function taskTimes() {
  const start = new Date(Date.now() + 3 * 86400000)
  const end = new Date(start.getTime() + 2 * 3600000)
  const deadline = new Date(start.getTime() - 24 * 3600000)
  return { start: start.toISOString(), end: end.toISOString(), deadline: deadline.toISOString() }
}

test('Logo 与凭证图片采用隔离文件存储和访问控制', async () => {
  const context = await createTestApp()
  try {
    await createAdmin(context)
    const teacher = await createAdminManagedUser(context.db, {
      role: 'teacher',
      account: 'TFILE01',
      name: '文件教师',
      departmentId: 'dept-cs',
      password: 'Teacher@123',
      approval: 'approved'
    })
    const student = await createAdminManagedUser(context.db, {
      role: 'student',
      account: 'FILEST01',
      name: '文件学生',
      departmentId: 'dept-cs',
      gradeId: 'grade-2024',
      classId: 'class-24se1',
      password: 'Student@123',
      approval: 'approved'
    })
    const outsider = await createAdminManagedUser(context.db, {
      role: 'student',
      account: 'FILEST02',
      name: '其他学生',
      departmentId: 'dept-cs',
      gradeId: 'grade-2024',
      classId: 'class-24se1',
      password: 'Student@123',
      approval: 'approved'
    })
    const times = taskTimes()
    context.db.run(
      `INSERT INTO tasks
      (id, title, category_id, campus_id, location, description, checklist_json, start_at, end_at,
       signup_deadline_at, duration, capacity, audience_scope, audience_id, requirements_json,
       proof_types_json, claim_mode, teacher_id, status, featured, version, created_at, updated_at)
      VALUES ('task-file', '文件验收任务', 'category-device', 'campus-main', '实验楼', '用于测试真实文件上传。', '[]', ?, ?, ?,
       '2小时', 2, 'department', 'dept-cs', '[]', '["image","text"]', 'direct', ?, 'in_progress', 0, 1, ?, ?)`,
      times.start,
      times.end,
      times.deadline,
      teacher.id,
      nowIso(),
      nowIso()
    )
    context.db.run(
      `INSERT INTO task_members(task_id, user_id, status, claimed_at, started_at, version, updated_at)
      VALUES ('task-file', ?, 'in_progress', ?, ?, 1, ?)`,
      student.id,
      nowIso(),
      nowIso(),
      nowIso()
    )

    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#246A49' } })
      .png()
      .toBuffer()
    const proofBody = await multipart(png, 'image/png', 'proof.png')
    const studentSession = await login(context, student.account, 'Student@123')
    const proofUpload = await context.app.inject({
      method: 'POST',
      url: '/api/files/proof?taskId=task-file',
      headers: {
        origin: testOrigin,
        cookie: studentSession.cookie,
        'x-csrf-token': studentSession.csrf,
        'content-type': proofBody.contentType
      },
      payload: proofBody.payload
    })
    assert.equal(proofUpload.statusCode, 201)
    const proof = dataOf<UploadData>(proofUpload)
    const ownerRead = await context.app.inject({
      method: 'GET',
      url: proof.url,
      headers: { cookie: studentSession.cookie }
    })
    assert.equal(ownerRead.statusCode, 200)
    assert.equal(ownerRead.headers['content-type'], 'image/png')
    assert.match(String(ownerRead.headers['content-disposition']), /^inline;/)
    assert.equal(ownerRead.headers['cache-control'], 'private, no-store')
    const chineseBody = await multipart(png, 'image/png', '现场凭证.png')
    const removableUpload = await context.app.inject({
      method: 'POST',
      url: '/api/files/proof?taskId=task-file',
      headers: {
        origin: testOrigin,
        cookie: studentSession.cookie,
        'x-csrf-token': studentSession.csrf,
        'content-type': chineseBody.contentType
      },
      payload: chineseBody.payload
    })
    const removable = dataOf<UploadData>(removableUpload)
    const chineseRead = await context.app.inject({
      method: 'GET',
      url: removable.url,
      headers: { cookie: studentSession.cookie }
    })
    assert.match(String(chineseRead.headers['content-disposition']), /filename\*=UTF-8''/)
    const removed = await context.app.inject({
      method: 'DELETE',
      url: removable.url,
      headers: { origin: testOrigin, cookie: studentSession.cookie, 'x-csrf-token': studentSession.csrf },
      payload: {}
    })
    assert.equal(removed.statusCode, 200)
    assert.equal(
      (await context.app.inject({ method: 'GET', url: removable.url, headers: { cookie: studentSession.cookie } }))
        .statusCode,
      404
    )

    const outsiderSession = await login(context, outsider.account, 'Student@123')
    const outsiderRead = await context.app.inject({
      method: 'GET',
      url: proof.url,
      headers: { cookie: outsiderSession.cookie }
    })
    assert.equal(outsiderRead.statusCode, 403)
    const teacherSession = await login(context, teacher.account, 'Teacher@123')
    const teacherBeforeSubmit = await context.app.inject({
      method: 'GET',
      url: proof.url,
      headers: { cookie: teacherSession.cookie }
    })
    assert.equal(teacherBeforeSubmit.statusCode, 403)
    const badBody = await multipart(Buffer.from('<svg onload=alert(1)>'), 'image/png', 'fake.png')
    const invalidImage = await context.app.inject({
      method: 'POST',
      url: '/api/files/proof?taskId=task-file',
      headers: {
        origin: testOrigin,
        cookie: studentSession.cookie,
        'x-csrf-token': studentSession.csrf,
        'content-type': badBody.contentType
      },
      payload: badBody.payload
    })
    assert.equal(invalidImage.statusCode, 415)
    const submitted = await context.app.inject({
      method: 'POST',
      url: '/api/tasks/task-file/proof',
      headers: { origin: testOrigin, cookie: studentSession.cookie, 'x-csrf-token': studentSession.csrf },
      payload: { description: '已完成第一轮图片凭证提交。', note: '', fileIds: [proof.id], version: 1 }
    })
    assert.equal(submitted.statusCode, 200)
    const submittedTask = dataOf<CampusTask>(submitted)
    const submittedMember = submittedTask.members.find(member => member.userId === student.id)!
    const teacherAfterSubmit = await context.app.inject({
      method: 'GET',
      url: proof.url,
      headers: { cookie: teacherSession.cookie }
    })
    assert.equal(teacherAfterSubmit.statusCode, 200)
    const rejected = await context.app.inject({
      method: 'POST',
      url: '/api/tasks/task-file/review',
      headers: { origin: testOrigin, cookie: teacherSession.cookie, 'x-csrf-token': teacherSession.csrf },
      payload: { userId: student.id, approved: false, feedback: '请补充结果。', version: submittedMember.version }
    })
    assert.equal(rejected.statusCode, 200)
    const rejectedMember = dataOf<CampusTask>(rejected).members.find(member => member.userId === student.id)!
    const resubmitted = await context.app.inject({
      method: 'POST',
      url: '/api/tasks/task-file/proof',
      headers: { origin: testOrigin, cookie: studentSession.cookie, 'x-csrf-token': studentSession.csrf },
      payload: {
        description: '保留原图片并补充完整结果后重新提交。',
        note: '',
        fileIds: [proof.id],
        version: rejectedMember.version
      }
    })
    assert.equal(resubmitted.statusCode, 200)
    assert.equal(dataOf<CampusTask>(resubmitted).members[0].proof?.fileIds[0], proof.id)

    const admin = await login(context, 'ADMIN001', 'Admin@123')
    const logoBody = await multipart(png, 'image/png', 'logo.png')
    const logoUpload = await context.app.inject({
      method: 'POST',
      url: '/api/files/logo',
      headers: {
        origin: testOrigin,
        cookie: admin.cookie,
        'x-csrf-token': admin.csrf,
        'content-type': logoBody.contentType
      },
      payload: logoBody.payload
    })
    assert.equal(logoUpload.statusCode, 201)
    const logo = dataOf<UploadData>(logoUpload)
    const school = dataOf<SchoolProfile>(await context.app.inject({ method: 'GET', url: '/api/school' }))
    const update = await context.app.inject({
      method: 'PUT',
      url: '/api/admin/school',
      headers: { origin: testOrigin, cookie: admin.cookie, 'x-csrf-token': admin.csrf },
      payload: {
        name: '文件验收大学',
        platformName: school.platformName,
        badge: school.badge,
        announcement: school.announcement,
        primaryColor: '#246A49',
        logoFileId: logo.id,
        version: school.version
      }
    })
    assert.equal(update.statusCode, 200)
    const updated = dataOf<SchoolProfile>(update)
    assert.equal(updated.logo, logo.url)
    const staleUpdate = await context.app.inject({
      method: 'PUT',
      url: '/api/admin/school',
      headers: { origin: testOrigin, cookie: admin.cookie, 'x-csrf-token': admin.csrf },
      payload: {
        name: '不应覆盖大学',
        platformName: school.platformName,
        badge: school.badge,
        announcement: school.announcement,
        primaryColor: '#1E60D5',
        version: school.version
      }
    })
    assert.equal(staleUpdate.statusCode, 409)
    assert.equal(staleUpdate.json().code, 'STALE_VERSION')
    const anonymousRead = await context.app.inject({ method: 'GET', url: logo.url })
    assert.equal(anonymousRead.statusCode, 200)
    assert.match(String(anonymousRead.headers['cache-control']), /^public/)

    const exported = await context.app.inject({
      method: 'GET',
      url: '/api/admin/export',
      headers: { cookie: admin.cookie }
    })
    const serialized = JSON.stringify(dataOf<unknown>(exported))
    assert.equal(serialized.includes('password_hash'), false)
    assert.equal(serialized.includes('csrf'), false)
    assert.equal(serialized.includes('token_hash'), false)
  } finally {
    await closeTestApp(context)
  }
})

test('清理过期且未引用的临时文件并保留未过期文件', async () => {
  const context = await createTestApp()
  try {
    const owner = await createAdmin(context)
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#246A49' } })
      .png()
      .toBuffer()
    fs.mkdirSync(path.join(context.config.uploadDir, 'logo'), { recursive: true })
    const files = [
      { id: 'file-expired', storedName: 'logo/expired.png', expiresAt: Date.now() - 60_000 },
      { id: 'file-unexpired', storedName: 'logo/unexpired.png', expiresAt: Date.now() + 3_600_000 }
    ]
    for (const file of files) {
      fs.writeFileSync(path.join(context.config.uploadDir, file.storedName), png)
      context.db.run(
        `INSERT INTO files(id, owner_user_id, purpose, stored_name, original_name, mime_type,
        size_bytes, width, height, status, expires_at, created_at)
        VALUES (?, ?, 'logo', ?, ?, 'image/png', ?, 1, 1, 'temporary', ?, ?)`,
        file.id,
        owner.id,
        file.storedName,
        path.basename(file.storedName),
        png.length,
        file.expiresAt,
        nowIso()
      )
    }
    assert.deepEqual(cleanupExpiredTemporaryFiles(context.db), { deleted: 1, failed: 0 })
    assert.equal(context.db.get('SELECT id FROM files WHERE id = ?', 'file-expired'), undefined)
    assert.equal(fs.existsSync(path.join(context.config.uploadDir, 'logo/expired.png')), false)
    assert.ok(context.db.get('SELECT id FROM files WHERE id = ?', 'file-unexpired'))
    assert.equal(fs.existsSync(path.join(context.config.uploadDir, 'logo/unexpired.png')), true)
  } finally {
    await closeTestApp(context)
  }
})
