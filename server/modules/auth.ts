import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { AppDatabase } from '../db/database.js'
import { getSchool, getUserByAccount } from '../db/models.js'
import { AppError } from '../errors.js'
import { DefaultResponseSchema, success } from '../http.js'
import type { SessionService } from '../security/session.js'
import { verifyPassword } from '../security/password.js'
import { createRegisteredUser } from './accounts.service.js'

const AccountSchema = Type.String({ minLength: 4, maxLength: 254 })
const PasswordSchema = Type.String({ minLength: 8, maxLength: 128 })
const LocaleSchema = Type.Union([Type.Literal('zh-CN'), Type.Literal('en')])

export function registerAuthRoutes(app: FastifyInstance, db: AppDatabase, sessions: SessionService) {
  app.get('/api/auth/session', { schema: { response: DefaultResponseSchema } }, async (request, reply) => {
    sessions.cleanupExpired()
    const session = sessions.ensure(request, reply)
    return success({ user: session.user, csrfToken: session.csrfToken, timezone: getSchool(db).timezone, locale: getSchool(db).defaultLocale }, '会话已恢复')
  })

  app.post('/api/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: Type.Object({ account: AccountSchema, password: PasswordSchema }, { additionalProperties: false }),
      response: DefaultResponseSchema
    }
  }, async (request, reply) => {
    const body = request.body as { account: string; password: string }
    const account = getUserByAccount(db, body.account)
    const verified = await verifyPassword(body.password, account?.passwordHash)
    if (!verified || !account) throw new AppError(401, 'LOGIN_FAILED', '账号或密码不正确')
    const fresh = getUserByAccount(db, body.account)
    if (!fresh || fresh.version !== account.version || fresh.passwordHash !== account.passwordHash) {
      throw new AppError(401, 'LOGIN_FAILED', '账号信息已变化，请重新登录')
    }
    if (account.approval === 'pending') throw new AppError(403, 'ACCOUNT_PENDING', '账号正在等待学校管理员审核')
    if (account.approval === 'disabled') throw new AppError(403, 'ACCOUNT_DISABLED', '账号已停用，请联系管理员')
    const session = sessions.login(request, reply, account.id)
    return success({ user: session.user, csrfToken: session.csrfToken, timezone: getSchool(db).timezone, locale: getSchool(db).defaultLocale }, '登录成功')
  })

  app.post('/api/auth/register', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    schema: {
      body: Type.Object({
        role: Type.Union([Type.Literal('student'), Type.Literal('teacher')]),
        account: AccountSchema,
        name: Type.String({ minLength: 1, maxLength: 100 }),
        departmentId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        classId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        gradeId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        password: PasswordSchema,
        locale: Type.Optional(LocaleSchema),
        email: Type.Optional(Type.String({ maxLength: 254 })),
        externalId: Type.Optional(Type.String({ maxLength: 100 })),
        isExternal: Type.Optional(Type.Boolean())
      }, { additionalProperties: false }),
      response: DefaultResponseSchema
    }
  }, async (request, reply) => {
    await createRegisteredUser(db, request.body as never)
    reply.code(201)
    const body = request.body as { role: string; isExternal?: boolean }
    return success(null, body.role === 'teacher' || body.isExternal ? '注册申请已提交' : '注册成功')
  })

  app.patch('/api/auth/preferences', {
    schema: {
      body: Type.Object({ locale: LocaleSchema }, { additionalProperties: false }),
      response: DefaultResponseSchema
    }
  }, async (request) => {
    sessions.requireUser(request)
    throw new AppError(403, 'INSTITUTION_LOCALE_MANAGED', '界面语言由机构管理员统一设置')
  })

  app.post('/api/auth/logout', {
    schema: { body: Type.Object({}, { additionalProperties: false }), response: DefaultResponseSchema }
  }, async (request, reply) => {
    sessions.logout(request, reply)
    return success(null, '已退出登录')
  })
}
