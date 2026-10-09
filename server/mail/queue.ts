import { createId, nowIso, type AppDatabase } from '../db/database.js'

export function enqueueNoticeEmail(db: AppDatabase, noticeId: string, userId: string): string | undefined {
  if (!db.config.mail.enabled) return undefined
  const user = db.get('SELECT email, approval FROM users WHERE id = ?', userId)
  if (!user?.email || user.approval !== 'approved') return undefined
  const id = createId('delivery')
  const timestamp = nowIso()
  db.run(`INSERT OR IGNORE INTO mail_deliveries(id, notice_id, user_id, recipient_email, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)`, id, noticeId, userId, String(user.email), timestamp, timestamp)
  return String(db.get('SELECT id FROM mail_deliveries WHERE notice_id=?', noticeId)!.id)
}
