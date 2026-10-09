import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CampusUser } from '../../shared/contracts.js'
import { createEventNotice } from '../i18n/notices.js'
import { drainMailQueue, recoverInterruptedMail, type MailTransport, type OutgoingMail } from '../mail/index.js'
import { enqueueNoticeEmail } from '../mail/queue.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'
import { closeTestApp, createAdmin, createTestApp, dataOf, login, testOrigin } from './helpers.js'

function enableFakeEmail(context: Awaited<ReturnType<typeof createTestApp>>) {
  // The app was created with delivery disabled, so no background SMTP worker
  // exists. Every send in these tests receives an explicit local transport stub.
  context.config.mail = { enabled: true, host: 'smtp.example.invalid', port: 587, secure: false,
    user: '', password: '', from: 'campus@example.invalid', pollIntervalMs: 1000 }
}

test('unconfigured email keeps in-app notices working and never invokes a transport', async () => {
  const context = await createTestApp()
  try {
    const admin = await createAdmin(context)
    context.db.run("UPDATE users SET email='admin@example.invalid' WHERE id=?", admin.id)
    const id = createEventNotice(context.db, admin.id, 'account.registration_pending', { actorName: 'Fictional participant' }, { kind: 'accounts', id: 'fixture' }, 'system')
    assert.ok(context.db.get('SELECT id FROM notices WHERE id=?', id))
    assert.equal(context.db.get('SELECT COUNT(*) count FROM mail_deliveries')?.count, 0)
    const transport: MailTransport = { sendMail: async () => { assert.fail('Unconfigured email must not invoke any transport') } }
    assert.deepEqual(await drainMailQueue(context.db, transport), { enabled: false, processed: 0, accepted: 0, failed: 0 })
  } finally { await closeTestApp(context) }
})

test('SMTP failure is observable and retryable without claiming delivery or exposing raw errors', async () => {
  const context = await createTestApp()
  try {
    const admin = await createAdmin(context)
    context.db.run("UPDATE users SET email='admin@example.invalid',locale='zh-CN' WHERE id=?", admin.id)
    context.db.run("UPDATE school_settings SET default_locale='en'")
    enableFakeEmail(context)
    const noticeId = createEventNotice(context.db, admin.id, 'account.registration_pending', { actorName: '明 — Fictional' }, { kind: 'accounts', id: 'fixture' }, 'system')
    const deliveryId = enqueueNoticeEmail(context.db, noticeId, admin.id)!
    assert.equal(context.db.get('SELECT COUNT(*) count FROM mail_deliveries')?.count, 1, 'Enqueue is idempotent by notice')
    const failing: MailTransport = { sendMail: async () => { throw Object.assign(new Error('raw secret-like server diagnostic'), { code: 'EAUTH' }) } }
    assert.deepEqual(await drainMailQueue(context.db, failing), { enabled: true, processed: 1, accepted: 0, failed: 1 })
    assert.equal(context.db.get('SELECT last_error_code FROM mail_deliveries WHERE id=?', deliveryId)?.last_error_code, 'SMTP_EAUTH')
    assert.equal(context.db.get('SELECT read FROM notices WHERE id=?', noticeId)?.read, 0)
    const signed = await login(context, 'ADMIN001', 'Admin@123')
    const headers = { origin: testOrigin, cookie: signed.cookie, 'x-csrf-token': signed.csrf, 'accept-language': 'en' }
    const status = await context.app.inject({ method: 'GET', url: '/api/admin/mail-deliveries', headers })
    assert.equal(status.statusCode, 200)
    assert.equal(status.body.includes('raw secret-like'), false)
    assert.equal(status.body.includes('admin@example.invalid'), false)
    const summary = dataOf<{ counts: { failed: number }; items: Array<{ recipientName: string }> }>(status)
    assert.equal(summary.counts.failed, 1)
    assert.equal(summary.items[0].recipientName, admin.name)
    const retry = await context.app.inject({ method: 'POST', url: `/api/admin/mail-deliveries/${deliveryId}/retry`, headers, payload: {} })
    assert.equal(retry.statusCode, 200)
    assert.equal(retry.json().code, 'MAIL_RETRY_QUEUED')
    const sent: OutgoingMail[] = []
    const accepting: MailTransport = { sendMail: async message => { sent.push(message); return { accepted: [message.to], rejected: [] } } }
    assert.deepEqual(await drainMailQueue(context.db, accepting), { enabled: true, processed: 1, accepted: 1, failed: 0 })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].to, 'admin@example.invalid')
    assert.equal(sent[0].subject, 'Account registration pending')
    assert.match(sent[0].text, /明 — Fictional/)
    assert.match(sent[0].text, /http:\/\/test.local\/admin\/accounts/)
    assert.equal(sent[0].messageId, `<${deliveryId}@campus-notifications.invalid>`)
    assert.equal(context.db.get('SELECT status FROM mail_deliveries WHERE id=?', deliveryId)?.status, 'accepted')
    assert.equal(context.db.get('SELECT read FROM notices WHERE id=?', noticeId)?.read, 0, 'SMTP acceptance is not a notification read receipt')
    assert.equal(context.db.get('SELECT COUNT(*) count FROM mail_delivery_attempts WHERE delivery_id=?', deliveryId)?.count, 2)
    assert.equal(context.db.get("SELECT COUNT(*) count FROM audit_logs WHERE action='mail.retry'")?.count, 1)
    const duplicate = await context.app.inject({ method: 'POST', url: `/api/admin/mail-deliveries/${deliveryId}/retry`, headers, payload: {} })
    assert.equal(duplicate.statusCode, 409)
    assert.equal(duplicate.json().code, 'MAIL_RETRY_FORBIDDEN')
    assert.equal((await drainMailQueue(context.db, accepting)).processed, 0)
  } finally { await closeTestApp(context) }
})

test('mail revalidates recipients and permissions, and interrupted delivery requires an explicit retry', async () => {
  const context = await createTestApp()
  try {
    context.db.run('UPDATE school_settings SET require_department=0,require_grade=0,require_class=0')
    const participant = await createAdminManagedUser(context.db, { role: 'student', account: 'MAILPART1', name: 'Fictional participant', password: 'Example@123', approval: 'approved', email: 'participant@example.invalid' })
    enableFakeEmail(context)
    const blocked: MailTransport = { sendMail: async () => { assert.fail('Changed recipient or unauthorized target must never be sent') } }
    const changedId = createEventNotice(context.db, participant.id, 'task.updated', { taskTitle: 'Fictional task' })
    context.db.run("UPDATE users SET email='changed@example.invalid' WHERE id=?", participant.id)
    assert.equal((await drainMailQueue(context.db, blocked)).failed, 1)
    assert.equal(context.db.get('SELECT last_error_code FROM mail_deliveries WHERE notice_id=?', changedId)?.last_error_code, 'MAIL_RECIPIENT_CHANGED')
    const forbiddenId = createEventNotice(context.db, participant.id, 'account.registration_pending', { actorName: 'Fictional' }, { kind: 'accounts', id: 'fixture' })
    assert.equal((await drainMailQueue(context.db, blocked)).failed, 1)
    assert.equal(context.db.get('SELECT last_error_code FROM mail_deliveries WHERE notice_id=?', forbiddenId)?.last_error_code, 'MAIL_TARGET_FORBIDDEN')
    const interruptedId = createEventNotice(context.db, participant.id, 'task.updated', { taskTitle: 'Fictional task' })
    context.db.run("UPDATE mail_deliveries SET status='sending',attempt_count=1 WHERE notice_id=?", interruptedId)
    recoverInterruptedMail(context.db)
    assert.equal(context.db.get('SELECT last_error_code FROM mail_deliveries WHERE notice_id=?', interruptedId)?.last_error_code, 'MAIL_OUTCOME_UNKNOWN')
    assert.equal((await drainMailQueue(context.db, blocked)).processed, 0)
    const session = await login(context, participant.account, 'Example@123')
    assert.equal((await context.app.inject({ method: 'GET', url: '/api/admin/mail-deliveries', headers: { cookie: session.cookie } })).statusCode, 403)
    const forbiddenRetry = await context.app.inject({ method: 'POST', url: '/api/admin/mail-deliveries/irrelevant/retry', headers: { origin: testOrigin, cookie: session.cookie, 'x-csrf-token': session.csrf }, payload: {} })
    assert.equal(forbiddenRetry.statusCode, 403)
    const activeUser = dataOf<{ user: CampusUser }>(await context.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: session.cookie } })).user
    assert.equal(activeUser.role, 'student')
  } finally { await closeTestApp(context) }
})

test('SMTP rejection is a failure even when sendMail resolves successfully', async () => {
  const context = await createTestApp()
  try {
    const admin = await createAdmin(context)
    context.db.run("UPDATE users SET email='admin@example.invalid' WHERE id=?", admin.id)
    enableFakeEmail(context)
    const noticeId = createEventNotice(context.db, admin.id, 'account.registration_pending', { actorName: 'Fictional' })
    const rejected: MailTransport = { sendMail: async message => ({ accepted: [], rejected: [message.to] }) }
    assert.equal((await drainMailQueue(context.db, rejected)).failed, 1)
    assert.equal(context.db.get('SELECT last_error_code FROM mail_deliveries WHERE notice_id=?', noticeId)?.last_error_code, 'MAIL_RECIPIENT_REJECTED')
  } finally { await closeTestApp(context) }
})
