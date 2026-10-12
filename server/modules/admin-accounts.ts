import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { AdminAccountPayload, ApprovalStatus, UserRole } from '../../shared/contracts.js'
import type { AppDatabase } from '../db/database.js'
import { DefaultResponseSchema, IdParamsSchema, pageNumber, success } from '../http.js'
import type { SessionService } from '../security/session.js'
import {
  audit,
  createAdminManagedUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  setUserStatus,
  updateAdminManagedUser
} from './accounts.service.js'

const RoleSchema = Type.Union([Type.Literal('student'), Type.Literal('teacher'), Type.Literal('admin')])
const ApprovalSchema = Type.Union([Type.Literal('approved'), Type.Literal('pending'), Type.Literal('disabled')])
const AccountFields = {
  role: RoleSchema,
  account: Type.String({ minLength: 4, maxLength: 254 }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  departmentId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  classId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  gradeId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  password: Type.Optional(Type.String({ minLength: 8, maxLength: 128 })),
  approval: ApprovalSchema,
  locale: Type.Optional(Type.Union([Type.Literal('zh-CN'), Type.Literal('en')])),
  email: Type.Optional(Type.String({ maxLength: 254 })),
  externalId: Type.Optional(Type.String({ maxLength: 100 })),
  isExternal: Type.Optional(Type.Boolean())
}
const AccountBodySchema = Type.Object(AccountFields, { additionalProperties: false })
const AccountUpdateBodySchema = Type.Object(
  { ...AccountFields, version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false }
)

export function registerAdminAccountRoutes(app: FastifyInstance, db: AppDatabase, sessions: SessionService) {
  app.get(
    '/api/admin/accounts',
    {
      schema: {
        querystring: Type.Object(
          {
            keyword: Type.Optional(Type.String({ maxLength: 80 })),
            role: Type.Optional(RoleSchema),
            approval: Type.Optional(ApprovalSchema),
            page: Type.Optional(Type.String()),
            pageSize: Type.Optional(Type.String())
          },
          { additionalProperties: false }
        ),
        response: DefaultResponseSchema
      }
    },
    async request => {
      sessions.requireUser(request, ['admin'])
      const query = request.query as Record<string, string | undefined>
      return success(
        listUsers(db, {
          keyword: query.keyword?.trim(),
          role: query.role as UserRole | undefined,
          approval: query.approval as ApprovalStatus | undefined,
          page: pageNumber(query.page, 1),
          pageSize: pageNumber(query.pageSize, 20, 100)
        })
      )
    }
  )

  app.post(
    '/api/admin/accounts',
    {
      schema: { body: AccountBodySchema, response: DefaultResponseSchema }
    },
    async (request, reply) => {
      const actor = sessions.requireUser(request, ['admin'])
      const user = await createAdminManagedUser(db, request.body as AdminAccountPayload, actor)
      audit(db, actor.id, 'account.create', 'user', user.id, { role: user.role, approval: user.approval })
      reply.code(201)
      return success(user, '账号已创建')
    }
  )

  app.patch(
    '/api/admin/accounts/:id',
    {
      schema: { params: IdParamsSchema, body: AccountUpdateBodySchema, response: DefaultResponseSchema }
    },
    async request => {
      const actor = sessions.requireUser(request, ['admin'])
      const id = (request.params as { id: string }).id
      const result = await updateAdminManagedUser(db, actor, id, request.body as AdminAccountPayload)
      if (result.invalidateSession) sessions.invalidateUser(id)
      audit(db, actor.id, 'account.update', 'user', id, { role: result.user.role, approval: result.user.approval })
      return success(result.user, '账号已更新')
    }
  )

  app.post(
    '/api/admin/accounts/:id/status',
    {
      schema: {
        params: IdParamsSchema,
        body: Type.Object(
          { approval: ApprovalSchema, version: Type.Integer({ minimum: 1 }) },
          { additionalProperties: false }
        ),
        response: DefaultResponseSchema
      }
    },
    async request => {
      const actor = sessions.requireUser(request, ['admin'])
      const id = (request.params as { id: string }).id
      const body = request.body as { approval: ApprovalStatus; version: number }
      const user = setUserStatus(db, actor, id, body.approval, body.version)
      if (body.approval !== 'approved') sessions.invalidateUser(id)
      audit(db, actor.id, 'account.status', 'user', id, { approval: body.approval })
      return success(
        user,
        body.approval === 'approved' ? '已启用' : body.approval === 'disabled' ? '已停用' : '已设为待审核'
      )
    }
  )

  app.post(
    '/api/admin/accounts/:id/password',
    {
      schema: {
        params: IdParamsSchema,
        body: Type.Object(
          { password: Type.String({ minLength: 8, maxLength: 128 }), version: Type.Integer({ minimum: 1 }) },
          { additionalProperties: false }
        ),
        response: DefaultResponseSchema
      }
    },
    async request => {
      const actor = sessions.requireUser(request, ['admin'])
      const id = (request.params as { id: string }).id
      const body = request.body as { password: string; version: number }
      const user = await resetUserPassword(db, id, body.password, body.version, actor)
      sessions.invalidateUser(id)
      audit(db, actor.id, 'account.password.reset', 'user', id)
      return success(user, '密码已重置，该账号需要重新登录')
    }
  )

  app.delete(
    '/api/admin/accounts/:id',
    {
      schema: {
        params: IdParamsSchema,
        body: Type.Object({ version: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
        response: DefaultResponseSchema
      }
    },
    async request => {
      const actor = sessions.requireUser(request, ['admin'])
      const id = (request.params as { id: string }).id
      deleteUser(db, actor, id, (request.body as { version: number }).version)
      sessions.invalidateUser(id)
      audit(db, actor.id, 'account.delete', 'user', id)
      return success(null, '账号已删除')
    }
  )
}
