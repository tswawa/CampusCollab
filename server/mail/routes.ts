import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { nowIso, type AppDatabase } from '../db/database.js'
import { assertCondition } from '../errors.js'
import { DefaultResponseSchema, IdParamsSchema, success } from '../http.js'
import { audit } from '../modules/accounts.service.js'
import type { SessionService } from '../security/session.js'

export function registerMailRoutes(app: FastifyInstance, db: AppDatabase, sessions: SessionService) {
  app.get('/api/admin/mail-deliveries', { schema: { response: DefaultResponseSchema } }, async request => {
    sessions.requireUser(request, ['admin'])
    const counts = { pending: 0, sending: 0, accepted: 0, failed: 0 }
    for (const row of db.all('SELECT status, COUNT(*) count FROM mail_deliveries GROUP BY status'))
      counts[String(row.status) as keyof typeof counts] = Number(row.count)
    const items = db
      .all(
        `SELECT m.id,m.notice_id,m.user_id,m.status,m.attempt_count,m.last_error_code,m.accepted_at,m.created_at,m.updated_at,u.name recipient_name
      FROM mail_deliveries m LEFT JOIN users u ON u.id=m.user_id ORDER BY m.updated_at DESC,m.id DESC LIMIT 100`
      )
      .map(row => ({
        id: String(row.id),
        noticeId: String(row.notice_id),
        userId: String(row.user_id),
        recipientName: row.recipient_name ? String(row.recipient_name) : null,
        status: String(row.status),
        attempts: Number(row.attempt_count),
        errorCode: row.last_error_code ? String(row.last_error_code) : null,
        acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
      }))
    return success({ enabled: db.config.mail.enabled, counts, items })
  })
  app.post(
    '/api/admin/mail-deliveries/:id/retry',
    {
      schema: {
        params: IdParamsSchema,
        body: Type.Object({}, { additionalProperties: false }),
        response: DefaultResponseSchema
      }
    },
    async request => {
      const actor = sessions.requireUser(request, ['admin'])
      assertCondition(db.config.mail.enabled, 409, 'MAIL_DISABLED', '邮件服务尚未启用')
      const id = (request.params as { id: string }).id
      db.transaction(() => {
        const current = db.get('SELECT * FROM mail_deliveries WHERE id=?', id)
        assertCondition(current, 404, 'MAIL_DELIVERY_NOT_FOUND', '邮件发送记录不存在')
        assertCondition(
          current.status === 'failed',
          409,
          'MAIL_RETRY_FORBIDDEN',
          '只能重试失败的邮件；SMTP 已接收的邮件不能重复发送'
        )
        db.run("UPDATE mail_deliveries SET status='pending',updated_at=? WHERE id=? AND status='failed'", nowIso(), id)
        audit(db, actor.id, 'mail.retry', 'mail_delivery', id, {
          attempts: current.attempt_count,
          previousErrorCode: current.last_error_code
        })
      })
      return success(null, '邮件已加入重试队列')
    }
  )
}
