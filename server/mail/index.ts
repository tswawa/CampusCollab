import type { AppConfig } from '../config.js'
import { nowIso, type AppDatabase, type SqlRow } from '../db/database.js'
import { getSchool, getUserById } from '../db/models.js'
import { mapLocalizedNotice } from '../i18n/notices.js'

export interface OutgoingMail {
  from: string
  to: string
  subject: string
  text: string
  messageId: string
}
export interface MailTransport {
  sendMail(message: OutgoingMail): Promise<{ accepted?: unknown[]; rejected?: unknown[] }>
  close?(): void
}
export interface MailRunResult {
  enabled: boolean
  processed: number
  accepted: number
  failed: number
}

async function smtpTransport(config: AppConfig['mail']): Promise<MailTransport> {
  const nodemailer = (await import('nodemailer')).default
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    disableFileAccess: true,
    disableUrlAccess: true
  })
}

function failDelivery(db: AppDatabase, delivery: SqlRow, code: string) {
  const timestamp = nowIso()
  db.transaction(() => {
    db.run(
      "UPDATE mail_deliveries SET status='failed',last_error_code=?,updated_at=? WHERE id=? AND status='sending'",
      code,
      timestamp,
      String(delivery.id)
    )
    db.run(
      "UPDATE mail_delivery_attempts SET status='failed',error_code=?,finished_at=? WHERE delivery_id=? AND attempt=? AND status='sending'",
      code,
      timestamp,
      String(delivery.id),
      Number(delivery.attempt_count)
    )
  })
}

function safeFailureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EENVELOPE', 'EMESSAGE', 'ETLS'].includes(String(code))
    ? `SMTP_${String(code)}`
    : 'MAIL_SEND_FAILED'
}

// An interrupted SMTP operation may have been accepted remotely. Make the
// uncertainty visible and require an administrator to choose whether to retry.
export function recoverInterruptedMail(db: AppDatabase) {
  const timestamp = nowIso()
  db.transaction(() => {
    db.run(
      "UPDATE mail_delivery_attempts SET status='failed',error_code='MAIL_OUTCOME_UNKNOWN',finished_at=? WHERE status='sending'",
      timestamp
    )
    db.run(
      "UPDATE mail_deliveries SET status='failed',last_error_code='MAIL_OUTCOME_UNKNOWN',updated_at=? WHERE status='sending'",
      timestamp
    )
  })
}

export async function drainMailQueue(
  db: AppDatabase,
  providedTransport?: MailTransport,
  limit = 20
): Promise<MailRunResult> {
  const result: MailRunResult = { enabled: db.config.mail.enabled, processed: 0, accepted: 0, failed: 0 }
  if (!db.config.mail.enabled) return result
  const pending = db.all(
    "SELECT id FROM mail_deliveries WHERE status='pending' ORDER BY created_at,id LIMIT ?",
    Math.max(1, Math.min(100, limit))
  )
  if (!pending.length) return result
  let transport: MailTransport | undefined = providedTransport
  try {
    for (const item of pending) {
      const delivery = db.transaction(() => {
        const timestamp = nowIso()
        const claimed = db.run(
          "UPDATE mail_deliveries SET status='sending',attempt_count=attempt_count+1,last_error_code=NULL,updated_at=? WHERE id=? AND status='pending'",
          timestamp,
          String(item.id)
        )
        if (Number(claimed.changes) !== 1) return undefined
        const row = db.get('SELECT * FROM mail_deliveries WHERE id=?', String(item.id))!
        db.run(
          "INSERT INTO mail_delivery_attempts(delivery_id,attempt,status,started_at) VALUES (?,?,'sending',?)",
          String(row.id),
          Number(row.attempt_count),
          timestamp
        )
        return row
      })
      if (!delivery) continue
      result.processed += 1
      const prepareMessage = () => {
        const user = getUserById(db, String(delivery.user_id))
        const noticeRow = db.get(
          'SELECT * FROM notices WHERE id=? AND user_id=?',
          String(delivery.notice_id),
          String(delivery.user_id)
        )
        const fail = (code: string) => {
          failDelivery(db, delivery, code)
          result.failed += 1
          return undefined
        }
        if (!user || user.approval !== 'approved' || !user.email || !noticeRow)
          return fail('MAIL_RECIPIENT_UNAVAILABLE')
        if (user.email !== String(delivery.recipient_email)) return fail('MAIL_RECIPIENT_CHANGED')
        const notice = mapLocalizedNotice(db, noticeRow, user, getSchool(db).defaultLocale)
        if (noticeRow.target_id && !notice.target) return fail('MAIL_TARGET_FORBIDDEN')
        const linkPath =
          notice.target?.kind === 'task'
            ? `/tasks/${encodeURIComponent(notice.target.id)}`
            : notice.target?.kind === 'accounts'
              ? '/admin/accounts'
              : '/notifications'
        const link = db.config.appOrigins[0] ? `${db.config.appOrigins[0].replace(/\/$/, '')}${linkPath}` : ''
        return {
          from: db.config.mail.from,
          to: user.email,
          subject: notice.title.replace(/[\r\n]/g, ' ').slice(0, 200),
          text: `${notice.content}${link ? `\n\n${link}` : ''}`,
          messageId: `<${String(delivery.id)}@campus-notifications.invalid>`
        }
      }
      if (!prepareMessage()) continue
      try {
        transport ??= await smtpTransport(db.config.mail)
        // Module loading yields. Re-read authority and content immediately before
        // the irreversible SMTP call; no await may separate these two operations.
        const message = prepareMessage()
        if (!message) continue
        const response = await transport.sendMail(message)
        const accepted = (response.accepted ?? []).some(address => {
          const value = typeof address === 'string' ? address : String((address as { address?: string })?.address ?? '')
          return value.toLowerCase() === message.to.toLowerCase()
        })
        if (!accepted) {
          failDelivery(db, delivery, 'MAIL_RECIPIENT_REJECTED')
          result.failed += 1
          continue
        }
        const timestamp = nowIso()
        db.transaction(() => {
          db.run(
            "UPDATE mail_deliveries SET status='accepted',accepted_at=?,updated_at=? WHERE id=? AND status='sending'",
            timestamp,
            timestamp,
            String(delivery.id)
          )
          db.run(
            "UPDATE mail_delivery_attempts SET status='accepted',finished_at=? WHERE delivery_id=? AND attempt=? AND status='sending'",
            timestamp,
            String(delivery.id),
            Number(delivery.attempt_count)
          )
        })
        result.accepted += 1
      } catch (error) {
        failDelivery(db, delivery, safeFailureCode(error))
        result.failed += 1
      }
    }
  } finally {
    if (!providedTransport) transport?.close?.()
  }
  return result
}

export function startMailDispatcher(db: AppDatabase): () => Promise<void> {
  // Owning the database lease proves the old worker is gone. Recover its state
  // even when this run disables delivery; recovery itself never sends mail.
  recoverInterruptedMail(db)
  if (!db.config.mail.enabled) return async () => {}
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let active: Promise<MailRunResult> | undefined
  const tick = () => {
    if (stopped) return
    active = drainMailQueue(db)
    void active
      .catch(() => {
        /* Errors remain in queue; do not log SMTP credentials or recipient data. */
      })
      .finally(() => {
        active = undefined
        if (!stopped) {
          timer = setTimeout(tick, Math.max(1000, db.config.mail.pollIntervalMs))
          timer.unref()
        }
      })
  }
  timer = setTimeout(tick, 0)
  timer.unref()
  return async () => {
    stopped = true
    if (timer) clearTimeout(timer)
    await active?.catch(() => undefined)
  }
}
