import assert from 'node:assert/strict'
import { test } from 'node:test'
import { closeTestApp, createAdmin, createTestApp, dataOf, login, anonymousSession, testOrigin } from './helpers.js'
import {
  createAdminManagedUser,
  createRegisteredUser,
  updateAdminManagedUser,
  setUserStatus
} from '../modules/accounts.service.js'
import type { CampusUser } from '../../shared/contracts.js'

test('并发注册同一账号仅写入一次，哈希期间撤销管理员身份不会生效越权写入', async () => {
  const context = await createTestApp()
  try {
    const registration = {
      role: 'teacher' as const,
      account: 'RACETEACHER',
      name: '并发教师',
      departmentId: 'dept-cs',
      password: 'Teacher@123'
    }
    const results = await Promise.allSettled([
      createRegisteredUser(context.db, registration),
      createRegisteredUser(context.db, registration)
    ])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    assert.equal(rejected.reason.code, 'ACCOUNT_EXISTS')
    assert.equal(context.db.get('SELECT COUNT(*) count FROM users')?.count, 1)

    const adminA = await createAdmin(context, 'RACEADMIN1')
    const adminB = await createAdmin(context, 'RACEADMIN2')
    const pending = updateAdminManagedUser(context.db, adminA, adminB.id, {
      role: 'admin',
      account: adminB.account,
      name: adminB.name,
      departmentId: adminB.departmentId,
      approval: 'disabled',
      password: 'Updated@123',
      version: adminB.version
    }).then(
      () => ({ ok: true, code: '' }),
      (error: { code: string }) => ({ ok: false, code: error.code })
    )
    setUserStatus(context.db, adminB, adminA.id, 'disabled', adminA.version)
    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(result.code, 'FORBIDDEN')
    assert.equal(
      context.db.get("SELECT COUNT(*) count FROM users WHERE role = 'admin' AND approval = 'approved'")?.count,
      1
    )
  } finally {
    await closeTestApp(context)
  }
})

test('HTTP 拒绝额外身份字段、失效会话和畸形请求且返回统一错误体', async () => {
  const context = await createTestApp()
  try {
    await createAdmin(context)
    const admin = await login(context, 'ADMIN001', 'Admin@123')
    const anon = await anonymousSession(context)
    const registration = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { cookie: anon.cookie, origin: testOrigin, 'x-csrf-token': anon.csrf },
      payload: {
        role: 'student',
        account: 'FORGEDUSER',
        name: '伪造状态',
        departmentId: 'dept-cs',
        classId: 'class-24se1',
        gradeId: 'grade-2024',
        password: 'Student@123',
        approval: 'approved',
        userId: admin.user.id
      }
    })
    assert.equal(registration.statusCode, 400)
    assert.deepEqual(registration.json(), { ok: false, message: '请求数据格式不正确', code: 'VALIDATION_ERROR' })
    const user = await createAdminManagedUser(context.db, {
      role: 'student',
      account: 'AUTHSTUDENT',
      name: '权限学生',
      departmentId: 'dept-cs',
      classId: 'class-24se1',
      gradeId: 'grade-2024',
      password: 'Student@123',
      approval: 'approved'
    })
    const student = await login(context, user.account, 'Student@123')
    for (const url of ['/api/admin/accounts', '/api/admin/export']) {
      const response = await context.app.inject({ method: 'GET', url, headers: { cookie: student.cookie } })
      assert.equal(response.statusCode, 403)
      assert.equal(response.json().ok, false)
      assert.equal(response.headers['cache-control'], 'private, no-store')
    }
    const accounts = await context.app.inject({
      method: 'GET',
      url: '/api/admin/accounts',
      headers: { cookie: admin.cookie }
    })
    const page = dataOf<{ items: CampusUser[] }>(accounts)
    assert.ok(page.items.length > 1)
    assert.equal(/password|token_hash|csrf_token/.test(accounts.body), false)
    context.db.run('UPDATE sessions SET expires_at = 0 WHERE user_id = ?', user.id)
    const expired = await context.app.inject({ method: 'GET', url: '/api/tasks', headers: { cookie: student.cookie } })
    assert.equal(expired.statusCode, 401)
    assert.equal(expired.json().ok, false)
    assert.equal(expired.json().code, 'AUTH_REQUIRED')
  } finally {
    await closeTestApp(context)
  }
})
