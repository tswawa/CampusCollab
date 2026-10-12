import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import type {
  CampusUser,
  InstallationInput,
  InstallationResult,
  InstallationStatus,
  SessionData
} from '../../shared/contracts.js'
import { buildApp } from '../app.js'
import { AppDatabase, nowIso } from '../db/database.js'
import { loadConfig } from '../config.js'
import { getSchool } from '../db/models.js'
import { installFromTrustedHost, setupTokenPath } from '../installation/service.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'
import { seedWorkflowDemo } from '../demo/workflow-seed.js'
import { anonymousSession, closeTestApp, cookieFrom, dataOf, login, testOrigin, type TestContext } from './helpers.js'

const token = 'fixture-installation-code-000000000000000000000001'
const input = (): InstallationInput => ({
  setupToken: token,
  locale: 'en',
  name: 'Fictional Campus',
  platformName: 'Campus Collaboration',
  timezone: 'Europe/London',
  admin: { account: 'owner@example.edu', name: '李', password: 'Fixture@12345' }
})
async function fresh(setupToken = token): Promise<TestContext> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-installation-'))
  const built = await buildApp({
    logger: false,
    config: {
      nodeEnv: 'test',
      databasePath: path.join(root, 'campus.sqlite'),
      uploadDir: path.join(root, 'uploads'),
      backupDir: path.join(root, 'backups'),
      appOrigins: [testOrigin],
      secureCookie: false,
      serveClient: false,
      setupToken,
      mail: {
        enabled: false,
        host: '',
        port: 587,
        secure: false,
        user: '',
        password: '',
        from: '',
        pollIntervalMs: 15000
      }
    }
  })
  return { ...built, root }
}
async function setupHeaders(context: TestContext) {
  const anonymous = await anonymousSession(context)
  return { origin: testOrigin, cookie: anonymous.cookie, 'x-csrf-token': anonymous.csrf, 'accept-language': 'en' }
}

test('protected web setup atomically creates an institution and administrator session, and permanently closes', async () => {
  const context = await fresh()
  try {
    const initial = await context.app.inject({ method: 'GET', url: '/api/installation' })
    assert.deepEqual(dataOf<InstallationStatus>(initial), { status: 'required', locale: 'zh-CN', setupAvailable: true })
    assert.equal(initial.body.includes(token), false)
    const headers = await setupHeaders(context)
    const registration = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers,
      payload: { role: 'student', account: 'student1', name: 'First visitor', password: 'Fixture@12345' }
    })
    assert.equal(registration.json().code, 'INSTALLATION_REQUIRED')
    for (const url of ['/api/auth/login', '/api/admin/accounts', '/api/tasks']) {
      const blocked = await context.app.inject({ method: 'POST', url, headers, payload: {} })
      assert.equal(blocked.json().code, 'INSTALLATION_REQUIRED', url)
    }
    const response = await context.app.inject({ method: 'POST', url: '/api/installation', headers, payload: input() })
    assert.equal(response.statusCode, 201, response.body)
    const result = dataOf<InstallationResult>(response)
    assert.equal(result.session.user?.role, 'admin')
    assert.equal(result.session.user?.name, '李')
    assert.equal(result.session.locale, 'en')
    assert.equal(result.school.defaultLocale, 'en')
    assert.equal(result.school.requireClass, false)
    assert.equal(result.school.timezone, 'Europe/London')
    assert.equal(result.installation.setupAvailable, false)
    assert.equal(response.headers['content-language'], 'en')
    assert.equal(response.body.includes(token), false)
    assert.equal(response.body.includes(input().admin.password), false)
    assert.equal(context.db.get("SELECT name FROM departments WHERE id='dept-cs'")?.name, 'Computing')
    assert.equal(context.db.get('SELECT locale FROM users')?.locale, null)
    assert.equal(
      context.db.get("SELECT count(*) count FROM audit_logs WHERE action='installation.configure'")?.count,
      1
    )
    assert.match(String(context.db.get('SELECT password_hash FROM users')?.password_hash), /^scrypt\$/)
    const adminHeaders = {
      ...headers,
      cookie: cookieFrom(response),
      'x-csrf-token': result.session.csrfToken,
      'accept-language': 'zh-CN'
    }
    const again = await context.app.inject({
      method: 'POST',
      url: '/api/installation',
      headers: adminHeaders,
      payload: input()
    })
    assert.equal(again.statusCode, 409)
    assert.equal(again.json().code, 'INSTALLATION_CONFIGURED')
    assert.equal(context.db.get('SELECT count(*) count FROM users')?.count, 1)
    assert.throws(
      () => context.db.run('UPDATE installation_state SET configured_at=NULL WHERE id=1'),
      /already configured/
    )
    assert.throws(() => context.db.run('DELETE FROM installation_state'), /cannot be deleted/)
    const old = await context.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: headers.cookie }
    })
    assert.equal(dataOf<SessionData>(old).user, null, 'Setup rotates the anonymous session')
    context.db.run("UPDATE users SET locale='zh-CN'")
    const session = await context.app.inject({ method: 'GET', url: '/api/auth/session', headers: adminHeaders })
    assert.equal(dataOf<SessionData>(session).locale, 'en')
    assert.equal(dataOf<SessionData>(session).user?.locale, 'en')
    assert.equal(session.headers['content-language'], 'en')
    const teacher = await createAdminManagedUser(context.db, {
      role: 'teacher',
      account: 'COORD001',
      name: 'Original 姓名',
      password: 'Fixture@12345',
      approval: 'approved',
      locale: 'zh-CN'
    })
    const demo = seedWorkflowDemo(context.db, teacher)
    const exported = await context.app.inject({
      method: 'GET',
      url: `/api/tasks/${demo.taskId}/workflow/snapshots/${demo.snapshot.id}/export?format=csv&locale=zh-CN`,
      headers: adminHeaders
    })
    assert.equal(exported.statusCode, 200)
    assert.match(exported.body.split('\n')[0], /Name/)
    assert.doesNotMatch(exported.body.split('\n')[0], /姓名/)
    const preference = await context.app.inject({
      method: 'PATCH',
      url: '/api/auth/preferences',
      headers: adminHeaders,
      payload: { locale: 'zh-CN' }
    })
    assert.equal(preference.statusCode, 403)
    assert.equal(preference.json().code, 'INSTITUTION_LOCALE_MANAGED')
    const { logo: _logo, ...settings } = result.school
    const changed = await context.app.inject({
      method: 'PUT',
      url: '/api/admin/school',
      headers: adminHeaders,
      payload: { ...settings, defaultLocale: 'zh-CN' }
    })
    assert.equal(changed.statusCode, 200, changed.body)
    const refreshed = await context.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { ...adminHeaders, 'accept-language': 'en' }
    })
    assert.equal(dataOf<SessionData>(refreshed).locale, 'zh-CN')
    assert.equal(dataOf<SessionData>(refreshed).user?.locale, 'zh-CN')
    assert.equal(refreshed.headers['content-language'], 'zh-CN')
  } finally {
    await closeTestApp(context)
  }
})

test('closed registration policy rejects student self-registration', async () => {
  const context = await fresh()
  try {
    const installed = await context.app.inject({
      method: 'POST',
      url: '/api/installation',
      headers: await setupHeaders(context),
      payload: { ...input(), registrationPolicy: 'closed' }
    })
    assert.equal(installed.statusCode, 201, installed.body)
    const registration = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: await setupHeaders(context),
      payload: { role: 'student', account: 'closed-student', name: 'Student', password: 'Cedar!Harbor9' }
    })
    assert.equal(registration.statusCode, 403)
    assert.equal(registration.json().code, 'REGISTRATION_CLOSED')
  } finally {
    await closeTestApp(context)
  }
})

test('approval registration policy blocks student login until an administrator approves the account', async () => {
  const context = await fresh()
  try {
    const installed = await context.app.inject({
      method: 'POST',
      url: '/api/installation',
      headers: await setupHeaders(context),
      payload: { ...input(), registrationPolicy: 'approval' }
    })
    assert.equal(installed.statusCode, 201, installed.body)
    const adminHeaders = {
      origin: testOrigin,
      cookie: cookieFrom(installed),
      'x-csrf-token': dataOf<InstallationResult>(installed).session.csrfToken
    }
    const headers = await setupHeaders(context)
    const credentials = { account: 'approval-student', password: 'Cedar!Harbor9' }
    const registration = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers,
      payload: { ...credentials, role: 'student', name: 'Student' }
    })
    assert.equal(registration.statusCode, 201, registration.body)
    assert.deepEqual(dataOf<{ pending: boolean }>(registration), { pending: true })
    const pendingLogin = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: credentials
    })
    assert.equal(pendingLogin.statusCode, 403)
    assert.equal(pendingLogin.json().code, 'ACCOUNT_PENDING')
    const accounts = await context.app.inject({
      method: 'GET',
      url: '/api/admin/accounts?approval=pending',
      headers: adminHeaders
    })
    const student = dataOf<{ items: CampusUser[] }>(accounts).items.find(user => user.account === credentials.account)
    assert.ok(student)
    const approved = await context.app.inject({
      method: 'POST',
      url: `/api/admin/accounts/${student.id}/status`,
      headers: adminHeaders,
      payload: { approval: 'approved', version: student.version }
    })
    assert.equal(approved.statusCode, 200, approved.body)
    assert.equal((await login(context, credentials.account, credentials.password)).user.id, student.id)
  } finally {
    await closeTestApp(context)
  }
})

test('setup rejects missing credentials, schema violations, CSRF and foreign origins without creating accounts', async () => {
  const context = await fresh()
  try {
    const headers = await setupHeaders(context)
    const wrong = await context.app.inject({
      method: 'POST',
      url: '/api/installation',
      headers,
      payload: { ...input(), setupToken: 'incorrect' }
    })
    assert.equal(wrong.statusCode, 403)
    assert.equal(wrong.json().code, 'INSTALLATION_TOKEN_INVALID')
    assert.match(wrong.json().message, /setup code/)
    const { setupToken: _secret, ...missing } = input()
    const absent = await context.app.inject({ method: 'POST', url: '/api/installation', headers, payload: missing })
    assert.equal(absent.statusCode, 400)
    const extra = await context.app.inject({
      method: 'POST',
      url: '/api/installation',
      headers,
      payload: { ...input(), admin: { ...input().admin, role: 'admin' } }
    })
    assert.equal(extra.statusCode, 400)
    const csrf = await context.app.inject({
      method: 'POST',
      url: '/api/installation',
      headers: { origin: testOrigin },
      payload: input()
    })
    assert.equal(csrf.statusCode, 403)
    const origin = await context.app.inject({
      method: 'POST',
      url: '/api/installation',
      headers: { ...headers, origin: 'https://invalid.example' },
      payload: input()
    })
    assert.equal(origin.statusCode, 403)
    const invalidZone = await context.app.inject({
      method: 'POST',
      url: '/api/installation',
      headers,
      payload: { ...input(), timezone: '+08:00' }
    })
    assert.equal(invalidZone.json().code, 'TIMEZONE_INVALID')
    assert.equal(context.db.get('SELECT count(*) count FROM users')?.count, 0)
    assert.equal(context.db.get('SELECT configured_at FROM installation_state')?.configured_at, null)
  } finally {
    await closeTestApp(context)
  }
})

test('concurrent setup and retries create only one administrator', async () => {
  const context = await fresh()
  try {
    const headers = await setupHeaders(context)
    const results = await Promise.all(
      [input(), { ...input(), admin: { ...input().admin, account: 'second@example.edu' } }].map(payload =>
        context.app.inject({ method: 'POST', url: '/api/installation', headers, payload })
      )
    )
    assert.deepEqual(results.map(result => result.statusCode).sort(), [201, 409])
    assert.equal(context.db.get('SELECT count(*) count FROM users')?.count, 1)
    assert.equal(
      context.db.get("SELECT count(*) count FROM audit_logs WHERE action='installation.configure'")?.count,
      1
    )
    assert.deepEqual(context.db.all('PRAGMA foreign_key_check'), [])
  } finally {
    await closeTestApp(context)
  }
})

test('failure in the initialization transaction rolls back admin, school, catalog and permanent state', async () => {
  const context = await fresh()
  try {
    const before = getSchool(context.db)
    context.db.raw.exec(
      "CREATE TRIGGER fixture_reject_install BEFORE INSERT ON audit_logs WHEN NEW.action='installation.configure' BEGIN SELECT RAISE(ABORT,'fixture failure'); END"
    )
    const headers = await setupHeaders(context)
    const failed = await context.app.inject({ method: 'POST', url: '/api/installation', headers, payload: input() })
    assert.equal(failed.statusCode, 500)
    assert.deepEqual(getSchool(context.db), before)
    assert.equal(context.db.get('SELECT count(*) count FROM users')?.count, 0)
    assert.equal(context.db.get('SELECT configured_at FROM installation_state')?.configured_at, null)
    assert.equal(context.db.get("SELECT name FROM departments WHERE id='dept-cs'")?.name, '计算机科学与技术学院')
    context.db.raw.exec('DROP TRIGGER fixture_reject_install')
    const retry = await context.app.inject({ method: 'POST', url: '/api/installation', headers, payload: input() })
    assert.equal(retry.statusCode, 201, retry.body)
  } finally {
    await closeTestApp(context)
  }
})

test('generated host credential survives restart and installed state ignores both old and replacement tokens', async () => {
  let context = await fresh('')
  const root = context.root
  try {
    const generated = fs.readFileSync(setupTokenPath(context.db), 'utf8')
    assert.ok(generated.length >= 32)
    const config = context.config
    await context.app.close()
    context = { ...(await buildApp({ logger: false, config })), root }
    assert.equal(fs.readFileSync(setupTokenPath(context.db), 'utf8'), generated)
    const headers = await setupHeaders(context)
    const installed = await context.app.inject({
      method: 'POST',
      url: '/api/installation',
      headers,
      payload: { ...input(), locale: 'zh-CN', setupToken: generated }
    })
    assert.equal(installed.statusCode, 201, installed.body)
    assert.equal(dataOf<InstallationResult>(installed).school.requireClass, true)
    await context.app.close()
    context = { ...(await buildApp({ logger: false, config: { ...config, setupToken: token } })), root }
    const status = dataOf<InstallationStatus>(await context.app.inject({ method: 'GET', url: '/api/installation' }))
    assert.equal(status.status, 'configured')
    assert.equal(status.setupAvailable, false)
    const result = await context.app.inject({
      method: 'POST',
      url: '/api/installation',
      headers: await setupHeaders(context),
      payload: input()
    })
    assert.equal(result.json().code, 'INSTALLATION_CONFIGURED')
  } finally {
    await closeTestApp(context)
  }
})

test('missing host credential is unavailable setup, not a claimable instance or a misleading data conflict', async () => {
  let context = await fresh('')
  try {
    const filename = setupTokenPath(context.db)
    const config = context.config
    const root = context.root
    await context.app.close()
    fs.unlinkSync(filename)
    fs.mkdirSync(filename)
    context = { ...(await buildApp({ logger: false, config })), root }
    assert.deepEqual(
      dataOf<InstallationStatus>(await context.app.inject({ method: 'GET', url: '/api/installation' })),
      { status: 'required', locale: 'zh-CN', setupAvailable: false }
    )
    const rejected = await context.app.inject({
      method: 'POST',
      url: '/api/installation',
      headers: await setupHeaders(context),
      payload: input()
    })
    assert.equal(rejected.json().code, 'INSTALLATION_TOKEN_INVALID')
    assert.equal(context.db.get('SELECT count(*) count FROM users')?.count, 0)
  } finally {
    await closeTestApp(context)
  }
})

test('installation attempts are rate limited without changing installation state', async () => {
  const context = await fresh()
  try {
    const headers = await setupHeaders(context)
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await context.app.inject({
        method: 'POST',
        url: '/api/installation',
        headers,
        payload: { ...input(), setupToken: 'invalid-code' }
      })
      assert.equal(response.statusCode, attempt < 5 ? 403 : 429)
    }
    assert.equal(context.db.get('SELECT count(*) count FROM users')?.count, 0)
    assert.equal(context.db.get('SELECT configured_at FROM installation_state')?.configured_at, null)
  } finally {
    await closeTestApp(context)
  }
})

test('legacy populated migration is configured and post-migration business data blocks anonymous claiming', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-installation-legacy-'))
  const db = new AppDatabase(
    loadConfig({ nodeEnv: 'test', databasePath: path.join(root, 'legacy.sqlite'), setupToken: token })
  )
  try {
    for (const file of fs
      .readdirSync('server/db/migrations')
      .filter(file => /^00[1-5]_/.test(file))
      .sort()) {
      const sql = fs.readFileSync(path.join('server/db/migrations', file), 'utf8')
      if (file.startsWith('003')) db.raw.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON;')
      db.raw.exec(sql)
      db.run(
        'INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)',
        Number(file.slice(0, 3)),
        file,
        nowIso()
      )
      db.raw.exec('PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;')
    }
    db.run(
      `INSERT INTO school_settings(id,name,platform_name,logo_url,badge,announcement,primary_color,timezone,version,updated_at,default_locale)
      VALUES(1,'原有机构','Original platform','','I','用户原文','#123456','Asia/Taipei',1,?,'en')`,
      nowIso()
    )
    const timestamp = nowIso()
    db.run(
      `INSERT INTO users(id,role,account,account_normalized,name,password_hash,approval,created_at,updated_at)
      VALUES('existing','admin','Existing','existing','原有管理员','existing-hash','approved',?,?)`,
      timestamp,
      timestamp
    )
    db.run(
      "INSERT INTO sessions VALUES('existing-session','existing','existing-csrf',9999999999999,?,?)",
      timestamp,
      timestamp
    )
    db.migrate()
    assert.equal(db.get('SELECT source FROM installation_state')?.source, 'legacy')
    assert.equal(getSchool(db).defaultLocale, 'en')
    assert.equal(getSchool(db).announcement, '用户原文')
    assert.equal(db.get('SELECT token_hash FROM sessions')?.token_hash, 'existing-session')
    await assert.rejects(installFromTrustedHost(db, input()), { code: 'INSTALLATION_CONFIGURED' })
  } finally {
    db.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
  const context = await fresh()
  try {
    await createAdminManagedUser(context.db, {
      role: 'admin',
      account: 'EXISTING',
      name: 'Existing owner',
      departmentId: 'dept-admin',
      password: 'Fixture@12345',
      approval: 'approved'
    })
    const status = dataOf<InstallationStatus>(await context.app.inject({ method: 'GET', url: '/api/installation' }))
    assert.equal(status.status, 'blocked')
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/installation',
      headers: await setupHeaders(context),
      payload: input()
    })
    assert.equal(response.json().code, 'INSTALLATION_BLOCKED')
    assert.equal(context.db.get('SELECT count(*) count FROM users')?.count, 1)
  } finally {
    await closeTestApp(context)
  }
})

test('trusted admin CLI uses the same institution transaction and refuses to run twice', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-installation-cli-'))
  const databasePath = path.join(root, 'cli.sqlite')
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    APP_ORIGIN: testOrigin,
    DATABASE_PATH: databasePath,
    SETUP_TOKEN: token,
    MAIL_ENABLED: 'false',
    ADMIN_LOCALE: 'en',
    SCHOOL_NAME: 'Fictional CLI campus',
    PLATFORM_NAME: 'Campus Collaboration',
    SCHOOL_TIMEZONE: 'Europe/London',
    ADMIN_ACCOUNT: 'cli@example.edu',
    ADMIN_NAME: '李',
    ADMIN_PASSWORD: 'Fixture@12345'
  }
  try {
    const run = () =>
      spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/init-admin.ts'], {
        env,
        encoding: 'utf8',
        timeout: 30000
      })
    const first = run()
    assert.equal(first.status, 0, first.stderr)
    assert.equal(first.stdout.includes(env.ADMIN_PASSWORD), false)
    assert.equal(first.stdout.includes(token), false)
    const second = run()
    assert.notEqual(second.status, 0)
    assert.match(second.stderr, /already configured/)
    const db = new AppDatabase(loadConfig({ nodeEnv: 'test', databasePath, setupToken: token }))
    try {
      assert.equal(db.get('SELECT source FROM installation_state')?.source, 'cli')
      assert.equal(db.get('SELECT count(*) count FROM users')?.count, 1)
      assert.equal(getSchool(db).defaultLocale, 'en')
    } finally {
      db.close()
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
