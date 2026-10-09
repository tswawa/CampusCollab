import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { InstallationInput, InstallationResult } from '../../shared/contracts.js'
import type { AppDatabase } from '../db/database.js'
import { DefaultResponseSchema, success } from '../http.js'
import type { SessionService } from '../security/session.js'
import { installWithCredential, prepareSetupCredential } from './service.js'
import { installationStatus } from './state.js'

export function registerInstallationRoutes(app: FastifyInstance, db: AppDatabase, sessions: SessionService) {
  const credential = prepareSetupCredential(db)
  app.get('/api/installation', { schema: { response: DefaultResponseSchema } }, async () => success(installationStatus(db, Boolean(credential))))
  app.post('/api/installation', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    schema: { body: Type.Object({
      setupToken: Type.String({ minLength: 1, maxLength: 256 }),
      locale: Type.Union([Type.Literal('zh-CN'), Type.Literal('en')]),
      name: Type.String({ minLength: 1, maxLength: 64 }), platformName: Type.String({ minLength: 1, maxLength: 64 }),
      timezone: Type.String({ minLength: 1, maxLength: 100 }),
      admin: Type.Object({ account: Type.String({ minLength: 4, maxLength: 254 }), name: Type.String({ minLength: 1, maxLength: 100 }),
        password: Type.String({ minLength: 8, maxLength: 128 }) }, { additionalProperties: false })
    }, { additionalProperties: false }), response: DefaultResponseSchema }
  }, async (request, reply) => {
    const result = await installWithCredential(db, request.body as InstallationInput, credential)
    const session = sessions.login(request, reply, result.user.id)
    const data: InstallationResult = { installation: installationStatus(db), school: result.school,
      session: { user: session.user, csrfToken: session.csrfToken, timezone: result.school.timezone, locale: result.school.defaultLocale } }
    return reply.code(201).send(success(data))
  })
}
