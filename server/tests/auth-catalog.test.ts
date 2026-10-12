import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CampusUser, CatalogData, SessionData } from '../../shared/contracts.js'
import {
  anonymousSession,
  closeTestApp,
  cookieFrom,
  createAdmin,
  createTestApp,
  dataOf,
  login,
  testOrigin
} from './helpers.js'

test('空库不生成固定账号，注册登录使用服务端会话与 CSRF', async () => {
  const context = await createTestApp()
  try {
    assert.equal(context.db.get('SELECT COUNT(*) count FROM users')?.count, 0)
    const anonymous = await anonymousSession(context)
    const missingCsrf = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { origin: testOrigin, cookie: anonymous.cookie },
      payload: {}
    })
    assert.equal(missingCsrf.statusCode, 403)
    assert.equal(missingCsrf.json().code, 'CSRF_INVALID')
    const wrongOrigin = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { origin: 'http://attacker.invalid', cookie: anonymous.cookie, 'x-csrf-token': anonymous.csrf },
      payload: {}
    })
    assert.equal(wrongOrigin.statusCode, 403)
    assert.equal(wrongOrigin.json().code, 'ORIGIN_REJECTED')

    const registration = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { origin: testOrigin, cookie: anonymous.cookie, 'x-csrf-token': anonymous.csrf },
      payload: {
        role: 'student',
        account: '32409999',
        name: '测试学生',
        departmentId: 'dept-cs',
        gradeId: 'grade-2024',
        classId: 'class-24se1',
        password: 'Student@123'
      }
    })
    assert.equal(registration.statusCode, 201)
    const raw = context.db.get('SELECT password_hash FROM users WHERE account_normalized = ?', '32409999')!
    assert.notEqual(raw.password_hash, 'Student@123')
    assert.match(String(raw.password_hash), /^scrypt\$/)

    const signedIn = await login(context, '32409999', 'Student@123')
    assert.equal(signedIn.user.role, 'student')
    const session = await context.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: signedIn.cookie }
    })
    const sessionData = dataOf<SessionData>(session)
    assert.equal(sessionData.user?.account, '32409999')
    assert.equal('password' in (sessionData.user as unknown as Record<string, unknown>), false)
    assert.equal(String(signedIn.response.headers['set-cookie'] ?? '').includes('HttpOnly'), true)

    const logout = await context.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: testOrigin, cookie: signedIn.cookie, 'x-csrf-token': signedIn.csrf },
      payload: {}
    })
    assert.equal(logout.statusCode, 200)
    const afterLogout = await context.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: signedIn.cookie }
    })
    assert.equal(dataOf<SessionData>(afterLogout).user, null)
  } finally {
    await closeTestApp(context)
  }
})

test('教师审核、账号权限、会话失效与组织 CRUD 在服务端执行', async () => {
  const context = await createTestApp()
  try {
    await createAdmin(context)
    const admin = await login(context, 'ADMIN001', 'Admin@123')
    const adminHeaders = { origin: testOrigin, cookie: admin.cookie, 'x-csrf-token': admin.csrf }
    const anonymous = await anonymousSession(context)
    const teacherRegister = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { origin: testOrigin, cookie: anonymous.cookie, 'x-csrf-token': anonymous.csrf },
      payload: {
        role: 'teacher',
        account: 'T209999',
        name: '测试教师',
        departmentId: 'dept-cs',
        password: 'Teacher@123'
      }
    })
    assert.equal(teacherRegister.statusCode, 201)
    const pendingLogin = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: testOrigin, cookie: anonymous.cookie, 'x-csrf-token': anonymous.csrf },
      payload: { account: 'T209999', password: 'Teacher@123' }
    })
    assert.equal(pendingLogin.statusCode, 403)
    assert.equal(pendingLogin.json().code, 'ACCOUNT_PENDING')

    const accounts = await context.app.inject({
      method: 'GET',
      url: '/api/admin/accounts?pageSize=100',
      headers: { cookie: admin.cookie }
    })
    const page = dataOf<{ items: CampusUser[] }>(accounts)
    const teacher = page.items.find(item => item.account === 'T209999')!
    assert.ok(teacher)
    assert.equal(JSON.stringify(page).includes('password'), false)
    const approve = await context.app.inject({
      method: 'POST',
      url: `/api/admin/accounts/${teacher.id}/status`,
      headers: adminHeaders,
      payload: { approval: 'approved', version: teacher.version }
    })
    assert.equal(approve.statusCode, 200)
    const approvedTeacher = dataOf<CampusUser>(approve)
    const teacherSession = await login(context, 'T209999', 'Teacher@123')
    const denied = await context.app.inject({
      method: 'GET',
      url: '/api/admin/accounts',
      headers: { cookie: teacherSession.cookie }
    })
    assert.equal(denied.statusCode, 403)

    const resetPassword = await context.app.inject({
      method: 'POST',
      url: `/api/admin/accounts/${teacher.id}/password`,
      headers: adminHeaders,
      payload: { password: 'Changed@123', version: approvedTeacher.version }
    })
    assert.equal(resetPassword.statusCode, 200)
    const invalidated = await context.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: teacherSession.cookie }
    })
    assert.equal(dataOf<SessionData>(invalidated).user, null)
    await login(context, 'T209999', 'Changed@123')

    const selfDisable = await context.app.inject({
      method: 'POST',
      url: `/api/admin/accounts/${admin.user.id}/status`,
      headers: adminHeaders,
      payload: { approval: 'disabled', version: admin.user.version }
    })
    assert.equal(selfDisable.statusCode, 400)
    const staleApprove = await context.app.inject({
      method: 'POST',
      url: `/api/admin/accounts/${teacher.id}/status`,
      headers: adminHeaders,
      payload: { approval: 'disabled', version: teacher.version }
    })
    assert.equal(staleApprove.statusCode, 409)

    const createdDepartment = await context.app.inject({
      method: 'POST',
      url: '/api/admin/catalog/departments',
      headers: adminHeaders,
      payload: { name: '验收学院', code: 'QA' }
    })
    assert.equal(createdDepartment.statusCode, 201)
    const department = dataOf<{ id: string; version: number }>(createdDepartment)
    const createdGrade = await context.app.inject({
      method: 'POST',
      url: '/api/admin/catalog/grades',
      headers: adminHeaders,
      payload: { name: '2030级' }
    })
    const grade = dataOf<{ id: string }>(createdGrade)
    const createdClass = await context.app.inject({
      method: 'POST',
      url: '/api/admin/catalog/classes',
      headers: adminHeaders,
      payload: { name: '30验收1班', departmentId: department.id, gradeId: grade.id }
    })
    assert.equal(createdClass.statusCode, 201)
    const catalog = dataOf<CatalogData>(
      await context.app.inject({ method: 'GET', url: '/api/catalog', headers: { cookie: admin.cookie } })
    )
    assert.ok(catalog.departments.some(item => item.id === department.id))
    assert.ok(catalog.classes.some(item => item.name === '30验收1班'))
    const staleUpdate = await context.app.inject({
      method: 'PATCH',
      url: `/api/admin/catalog/departments/${department.id}`,
      headers: adminHeaders,
      payload: { name: '不应保存', version: department.version + 1 }
    })
    assert.equal(staleUpdate.statusCode, 409)
    const deleteReferenced = await context.app.inject({
      method: 'DELETE',
      url: `/api/admin/catalog/departments/${department.id}`,
      headers: adminHeaders,
      payload: { version: department.version }
    })
    assert.equal(deleteReferenced.statusCode, 409)
  } finally {
    await closeTestApp(context)
  }
})
