import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { AppDatabase } from '../db/database.js'
import { DefaultResponseSchema, IdParamsSchema, success } from '../http.js'
import type { SessionService } from '../security/session.js'
import { previewTaskRetention, purgeTaskRetention, retentionOverview, retryFileDeletions } from './service.js'

export function registerRetentionRoutes(app: FastifyInstance, db: AppDatabase, sessions: SessionService) {
  app.get(
    '/api/admin/retention',
    {
      schema: {
        querystring: Type.Object(
          { page: Type.Optional(Type.Integer({ minimum: 1, maximum: Math.floor(Number.MAX_SAFE_INTEGER / 100) })) },
          { additionalProperties: false }
        ),
        response: DefaultResponseSchema
      }
    },
    async request =>
      success(
        retentionOverview(db, sessions.requireUser(request, ['admin']), (request.query as { page?: number }).page)
      )
  )
  app.get(
    '/api/admin/retention/tasks/:id/preview',
    { schema: { params: IdParamsSchema, response: DefaultResponseSchema } },
    async request =>
      success(previewTaskRetention(db, sessions.requireUser(request, ['admin']), (request.params as { id: string }).id))
  )
  app.post(
    '/api/admin/retention/tasks/:id/purge',
    {
      schema: {
        params: IdParamsSchema,
        body: Type.Object(
          {
            version: Type.Integer({ minimum: 1 }),
            previewHash: Type.String({ pattern: '^[0-9a-f]{64}$' }),
            confirmation: Type.String({ minLength: 1, maxLength: 100 })
          },
          { additionalProperties: false }
        ),
        response: DefaultResponseSchema
      }
    },
    async request =>
      success(
        purgeTaskRetention(
          db,
          sessions.requireUser(request, ['admin']),
          (request.params as { id: string }).id,
          request.body as { version: number; previewHash: string; confirmation: string }
        ),
        '过期任务记录已清除'
      )
  )
  app.post(
    '/api/admin/retention/files/retry',
    { schema: { body: Type.Object({}, { additionalProperties: false }), response: DefaultResponseSchema } },
    async request => success(retryFileDeletions(db, sessions.requireUser(request, ['admin'])), '材料文件清理已重试')
  )
}
