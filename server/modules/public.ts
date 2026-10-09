import type { FastifyInstance } from 'fastify'
import type { AppDatabase } from '../db/database.js'
import { getCatalog, getSchool } from '../db/models.js'
import { DefaultResponseSchema, success } from '../http.js'
import type { SessionService } from '../security/session.js'

export function registerPublicRoutes(app: FastifyInstance, db: AppDatabase, sessions: SessionService) {
  app.get('/api/school', { schema: { response: DefaultResponseSchema } }, async () => success(getSchool(db)))
  app.get('/api/catalog', { schema: { response: DefaultResponseSchema } }, async (request) => {
    const viewer = sessions.resolve(request)?.user
    return success(getCatalog(db, viewer?.role === 'admin'))
  })
  app.get('/api/health', { schema: { response: DefaultResponseSchema } }, async () => success({ status: 'ok', time: new Date().toISOString() }))
}
