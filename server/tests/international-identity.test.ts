import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { CampusUser, NoticePage, RegistrationPayload } from '../../shared/contracts.js'
import { loadConfig } from '../config.js'
import { AppDatabase, nowIso } from '../db/database.js'
import { getSchool, getUserById, localDateTimeToInstant, schoolLocalToInstant } from '../db/models.js'
import { createEventNotice } from '../i18n/notices.js'
import { parseAcceptLanguage } from '../i18n/index.js'
import { createAdminManagedUser, createRegisteredUser } from '../modules/accounts.service.js'
import { createTask } from '../modules/tasks.service.js'
import { anonymousSession, closeTestApp, createAdmin, createTestApp, dataOf, login, testOrigin } from './helpers.js'

function seedLegacyDatabase(db: AppDatabase) {
  db.raw.exec(fs.readFileSync('server/db/migrations/001_initial.sql', 'utf8'))
  const timestamp = '2026-01-01T00:00:00.000Z'
  db.run("INSERT INTO schema_migrations VALUES (1, '001_initial.sql', ?)", timestamp)
  db.run('INSERT INTO departments VALUES (?, ?, ?, 1, 1, ?, ?)', 'd', 'Department', 'D', timestamp, timestamp)
  db.run('INSERT INTO grades VALUES (?, ?, 1, 1, ?, ?)', 'g', 'Year', timestamp, timestamp)
  db.run('INSERT INTO classes VALUES (?, ?, ?, ?, 1, 1, ?, ?)', 'c', 'Group', 'd', 'g', timestamp, timestamp)
  db.run('INSERT INTO campuses VALUES (?, ?, 1, 1, ?, ?)', 'campus', 'Campus', timestamp, timestamp)
  db.run('INSERT INTO task_categories VALUES (?, ?, 1, 1, ?, ?)', 'category', 'Category', timestamp, timestamp)
  db.run("INSERT INTO school_settings VALUES (1,'Institution','Platform',NULL,'/logo','I','','#123456','Asia/Shanghai',3,?)", timestamp)
  for (const [id, role] of [['teacher', 'teacher'], ['participant', 'student']]) {
    db.run(`INSERT INTO users VALUES (?, ?, ?, ?, ?, 'd', ?, ?, 'fixture-hash', 'approved', '[]', 7, ?, ?)`,
      id, role, id, id, id, role === 'student' ? 'c' : null, role === 'student' ? 'g' : null, timestamp, timestamp)
  }
  db.run(`INSERT INTO tasks(id,title,category_id,campus_id,location,description,start_at,end_at,signup_deadline_at,duration,
    capacity,audience_scope,claim_mode,teacher_id,status,created_at,updated_at)
    VALUES ('task','Legacy task','category','campus','Room','Description','2030-04-01T00:00:00Z','2030-04-01T02:00:00Z',
    '2030-03-31T00:00:00Z','2 hours',8,'school','direct','teacher','completed',?,?)`, timestamp, timestamp)
  db.run("INSERT INTO task_members(task_id,user_id,status,claimed_at,version,updated_at) VALUES ('task','participant','completed',?,4,?)", timestamp, timestamp)
  db.run("INSERT INTO proofs VALUES ('proof','task','participant','Evidence','Original note',?,3)", timestamp)
  db.run("INSERT INTO files VALUES ('file','participant','task','proof','file.png','original.png','image/png',10,1,1,'attached',NULL,?)", timestamp)
  db.run("INSERT INTO proof_files VALUES ('proof','file',0)")
  db.run("INSERT INTO sessions VALUES ('fixture-session','participant','fixture-csrf',9999999999999,?,?)", timestamp, timestamp)
  db.run("INSERT INTO notices VALUES ('old-notice','participant','历史通知','保留原文','system',0,?)", timestamp)
  db.run("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,created_at) VALUES ('teacher','fixture','task','task',?)", timestamp)
  db.raw.exec(fs.readFileSync('server/db/migrations/002_workflow.sql', 'utf8'))
  db.run("INSERT INTO schema_migrations VALUES (2, '002_workflow.sql', ?)", timestamp)
}

test('003 upgrades populated 001+002 without deleting users, sessions, evidence or workflow references', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-international-migration-'))
  const db = new AppDatabase(loadConfig({ nodeEnv: 'test', databasePath: path.join(root, 'fixture.sqlite') }))
  try {
    seedLegacyDatabase(db)
    const tables = ['users', 'sessions', 'tasks', 'task_members', 'proofs', 'files', 'proof_files', 'notices', 'audit_logs', 'workflow_tasks', 'workflow_participants', 'workflow_revisions', 'workflow_revision_files']
    const before = Object.fromEntries(tables.map((table) => [table, db.all(`SELECT * FROM ${table}`)]))
    db.migrate()
    db.migrate()
    for (const table of tables) {
      const after = db.all(`SELECT * FROM ${table}`)
      assert.equal(after.length, before[table].length, table)
      before[table].forEach((row, index) => {
        for (const [key, value] of Object.entries(row)) assert.deepEqual(after[index][key], value, `${table}.${key}`)
      })
    }
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), [])
    assert.equal(db.get('PRAGMA foreign_keys')?.foreign_keys, 1)
    assert.equal(db.get('PRAGMA legacy_alter_table')?.legacy_alter_table, 0)
    assert.equal(getUserById(db, 'participant')?.version, 7)
    assert.equal(getSchool(db).requireClass, true)
    assert.equal(getSchool(db).defaultLocale, 'zh-CN')
    assert.equal(db.get("SELECT user_id FROM sessions WHERE token_hash='fixture-session'")?.user_id, 'participant')
    assert.throws(() => db.run("UPDATE users SET department_id='missing' WHERE id='participant'"), /FOREIGN KEY/)
    assert.equal(db.get("SELECT sql FROM sqlite_master WHERE name='workflow_member_insert'")?.sql?.toString().includes('users_international'), false)
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('a failed international migration rolls back the schema and restores FK enforcement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-international-rollback-'))
  const db = new AppDatabase(loadConfig({ nodeEnv: 'test', databasePath: path.join(root, 'fixture.sqlite') }))
  try {
    seedLegacyDatabase(db)
    db.raw.exec('PRAGMA foreign_keys=OFF')
    db.run("UPDATE users SET department_id='invalid-reference' WHERE id='teacher'")
    db.raw.exec('PRAGMA foreign_keys=ON')
    assert.throws(() => db.migrate(), /violates foreign keys/)
    assert.equal(db.get('SELECT 1 FROM schema_migrations WHERE version=3'), undefined)
    assert.equal(db.get('PRAGMA foreign_keys')?.foreign_keys, 1)
    assert.equal(db.get('PRAGMA legacy_alter_table')?.legacy_alter_table, 0)
    assert.equal(db.all('PRAGMA table_info(users)').some((row) => row.name === 'locale'), false)
    assert.equal(db.get('SELECT COUNT(*) count FROM sessions')?.count, 1)
    assert.equal(db.get('SELECT COUNT(*) count FROM proof_files')?.count, 1)
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('international registration accepts email accounts, Unicode single names and text IDs without fake organizations', async () => {
  const context = await createTestApp()
  try {
    context.db.run("UPDATE school_settings SET default_locale='en'")
    const anonymous = await anonymousSession(context)
    const headers = { origin: testOrigin, cookie: anonymous.cookie, 'x-csrf-token': anonymous.csrf, 'accept-language': 'en-GB' }
    const register = (payload: RegistrationPayload) => context.app.inject({ method: 'POST', url: '/api/auth/register', headers, payload })
    const payload: RegistrationPayload = { role: 'student', account: 'sam+garden@example.edu', name: '李', password: 'Example@123', departmentId: 'dept-cs' }
    const required = await register(payload)
    assert.equal(required.statusCode, 400)
    assert.equal(required.json().code, 'GRADE_REQUIRED')
    assert.match(required.json().message, /academic year/)
    context.db.run('UPDATE school_settings SET require_department=0,require_grade=0,require_class=0,default_locale=\'en\'')
    const success = await register({ ...payload, departmentId: undefined, externalId: '0000123', email: 'shared@example.edu', locale: 'en' })
    assert.equal(success.statusCode, 201)
    assert.equal(success.json().code, 'REGISTERED')
    const user = context.db.get('SELECT * FROM users WHERE account=?', payload.account)!
    assert.equal(user.department_id, null)
    assert.equal(user.grade_id, null)
    assert.equal(user.class_id, null)
    assert.equal(user.external_id, '0000123')
    const second = await register({ ...payload, account: 'maya@example.edu', name: 'Māia O’Connor-Smith', departmentId: undefined, email: 'shared@example.edu' })
    assert.equal(second.statusCode, 201, 'Shared email addresses are not treated as a unique identity')
    const duplicate = await register({ ...payload, account: 'different@example.edu', externalId: '0000123' })
    assert.equal(duplicate.statusCode, 409)
    assert.equal(duplicate.json().code, 'EXTERNAL_ID_EXISTS')
    const signed = await login(context, payload.account, payload.password)
    assert.equal(signed.user.departmentId, undefined)
    assert.equal(signed.user.name, '李')
    const denied = await context.app.inject({ method: 'GET', url: '/api/admin/accounts', headers: { cookie: signed.cookie } })
    assert.equal(denied.statusCode, 403)
    assert.match(denied.json().message, /permission/)
    const dashboard = await context.app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: signed.cookie } })
    assert.equal(dashboard.statusCode, 200)
    const preference = await context.app.inject({ method: 'PATCH', url: '/api/auth/preferences', headers: { origin: testOrigin, cookie: signed.cookie, 'x-csrf-token': signed.csrf }, payload: { locale: 'zh-CN' } })
    assert.equal(preference.statusCode, 403)
    assert.equal(preference.json().code, 'INSTITUTION_LOCALE_MANAGED')
    const localized = await context.app.inject({ method: 'GET', url: '/api/admin/accounts', headers: { cookie: signed.cookie } })
    assert.match(localized.json().message, /permission/)
    const override = await context.app.inject({ method: 'GET', url: '/api/admin/accounts', headers: { cookie: signed.cookie, 'accept-language': 'zh-CN' } })
    assert.match(override.json().message, /permission/)
  } finally { await closeTestApp(context) }
})

test('external self-registration is controlled and pending; optional organization values still require valid relationships', async () => {
  const context = await createTestApp()
  try {
    await createAdmin(context)
    const external: RegistrationPayload = { role: 'student', account: 'outside@example.org', name: 'Cher', password: 'Example@123', isExternal: true }
    await assert.rejects(createRegisteredUser(context.db, external), { code: 'EXTERNAL_PARTICIPANTS_DISABLED' })
    context.db.run('UPDATE school_settings SET allow_external_participants=1')
    const registered = await createRegisteredUser(context.db, external)
    assert.equal(registered.approval, 'pending')
    assert.equal(registered.role, 'student')
    assert.equal(registered.departmentId, undefined)
    await assert.rejects(createRegisteredUser(context.db, { ...external, role: 'teacher', account: 'owner@example.org' }), { code: 'EXTERNAL_ROLE_INVALID' })
    const anonymous = await anonymousSession(context)
    const denied = await context.app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: testOrigin, cookie: anonymous.cookie, 'x-csrf-token': anonymous.csrf, 'accept-language': 'en' }, payload: { account: external.account, password: external.password } })
    assert.equal(denied.json().code, 'ACCOUNT_PENDING')
    context.db.run('UPDATE school_settings SET require_department=0,require_grade=0,require_class=0')
    await assert.rejects(createRegisteredUser(context.db, { ...external, account: 'wrong-group@example.org', departmentId: 'dept-me', gradeId: 'grade-2024', classId: 'class-24se1' }), { code: 'CLASS_INVALID' })
    await assert.rejects(createRegisteredUser(context.db, { ...external, account: 'invalid-grade@example.org', gradeId: 'missing' }), { code: 'GRADE_INVALID' })
    context.db.run("UPDATE departments SET enabled=0 WHERE id='dept-cs'")
    await assert.rejects(createRegisteredUser(context.db, { ...external, account: 'disabled-org@example.org', departmentId: 'dept-cs' }), { code: 'DEPARTMENT_INVALID' })
    context.db.run('UPDATE school_settings SET registration_enabled=0')
    await assert.rejects(createRegisteredUser(context.db, { ...external, account: 'closed@example.org' }), { code: 'REGISTRATION_CLOSED' })
    const notice = context.db.get("SELECT * FROM notices WHERE event_type='account.registration_pending'")!
    assert.equal(JSON.parse(String(notice.event_params_json)).actorName, 'Cher')
  } finally { await closeTestApp(context) }
})

test('event notifications preserve authored text, localize on read, and omit unauthorized targets; historical text remains readable', async () => {
  const context = await createTestApp()
  try {
    context.db.run('UPDATE school_settings SET require_department=0,require_grade=0,require_class=0')
    const teacher = await createAdminManagedUser(context.db, { role: 'teacher', account: 'OWNER001', name: '任务负责人', password: 'Example@123', approval: 'approved' })
    const participant = await createAdminManagedUser(context.db, { role: 'student', account: 'PART0001', name: 'Alex', password: 'Example@123', approval: 'approved' })
    const task = createTask(context.db, teacher, {
      title: 'Garden “中文” session', categoryId: 'category-event', campusId: 'campus-main', description: 'A fictional garden session for testing.', checklist: [],
      date: '2099-04-03', startTime: '10:00', endTime: '12:00', signupDeadline: '2099-04-02 12:00', place: 'Garden', duration: '2 hours', capacity: 8,
      audienceScope: 'department', audienceId: 'dept-cs', requirements: [], proofTypes: ['text'], claimMode: 'direct', contacts: []
    })
    createEventNotice(context.db, participant.id, 'task.changes_requested', { taskTitle: task.title, feedback: '请保留原文 — keep original' }, { kind: 'task', id: task.id }, 'review')
    context.db.run("INSERT INTO notices(id,user_id,title,content,type,read,created_at) VALUES ('legacy',?,'旧标题','旧内容','system',0,?)", participant.id, nowIso())
    const session = await login(context, participant.account, 'Example@123')
    const list = async (locale: string) => {
      context.db.run('UPDATE school_settings SET default_locale=?', locale)
      return dataOf<NoticePage>(await context.app.inject({ method: 'GET', url: '/api/notices', headers: { cookie: session.cookie, 'accept-language': locale === 'en' ? 'zh-CN' : 'en' } }))
    }
    const english = await list('en')
    const event = english.items.find((notice) => notice.eventType)!
    assert.equal(event.title, 'Changes requested')
    assert.match(event.content, /Garden “中文” session/)
    assert.match(event.content, /请保留原文 — keep original/)
    assert.equal(event.target, undefined)
    assert.equal(english.items.find((notice) => notice.id === 'legacy')?.content, '旧内容')
    const denied = await context.app.inject({ method: 'GET', url: `/api/tasks/${task.id}`, headers: { cookie: session.cookie } })
    assert.equal(denied.statusCode, 403)
    context.db.run("UPDATE tasks SET audience_scope='school',audience_id=NULL WHERE id=?", task.id)
    assert.deepEqual((await list('en')).items.find((notice) => notice.eventType)?.target, { kind: 'task', id: task.id })
    assert.equal((await list('zh-CN')).items.find((notice) => notice.eventType)?.title, '完成材料需修改（补正）')
  } finally { await closeTestApp(context) }
})

test('DST gaps and overlaps are rejected and locale selection does not change the represented instant', () => {
  for (const [date, time] of [['2026-03-08', '02:30'], ['2026-11-01', '01:30']]) {
    assert.throws(() => schoolLocalToInstant(date, time, 'America/New_York'), RangeError)
    assert.throws(() => localDateTimeToInstant(`${date} ${time}`, 'America/New_York'), RangeError)
  }
  assert.throws(() => schoolLocalToInstant('2026-02-30', '12:00', 'Europe/London'), RangeError)
  assert.throws(() => schoolLocalToInstant('2026-04-01', '10:00', 'Imaginary/Zone'), RangeError)
  const instant = schoolLocalToInstant('2026-04-03', '00:30', 'Asia/Taipei')
  assert.equal(instant, '2026-04-02T16:30:00Z')
  for (const locale of ['zh-CN', 'en-US', 'en-GB']) {
    const parts = new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant))
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    assert.deepEqual([fields.year, fields.month, fields.day, fields.hour, fields.minute], ['2026', '04', '03', '00', '30'])
  }
  assert.equal(parseAcceptLanguage('fr;q=1,en-GB;q=0.8,zh-CN;q=0.3'), 'en')
  assert.equal(parseAcceptLanguage('en;q=0,zh-CN;q=0.9'), 'zh-CN')
  assert.equal(parseAcceptLanguage('en;q=invalid'), undefined)
})
