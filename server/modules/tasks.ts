import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type {
  AudienceScope,
  ClaimMode,
  ContactItem,
  CreateTaskPayload,
  MemberStatus,
  ProofType,
  TaskStatus
} from '../../shared/contracts.js'
import type { AppDatabase } from '../db/database.js'
import { DefaultResponseSchema, IdParamsSchema, pageNumber, success } from '../http.js'
import type { SessionService } from '../security/session.js'
import { registerWorkflowRoutes } from './workflow.js'
import {
  approveApplication,
  cancelTask,
  claimTask,
  createTask,
  copyTask,
  getTaskForViewer,
  inviteStudent,
  listTasks,
  restoreTask,
  reviewProof,
  startTask,
  submitProof,
  updateTask,
  withdrawTask,
  type TaskPatch
} from './tasks.service.js'

const AudienceScopeSchema = Type.Union([
  Type.Literal('school'), Type.Literal('department'), Type.Literal('class'), Type.Literal('grade')
])
const ClaimModeSchema = Type.Union([Type.Literal('direct'), Type.Literal('application')])
const ProofTypeSchema = Type.Union([Type.Literal('text'), Type.Literal('image'), Type.Literal('onsite')])
const ContactTypeSchema = Type.Union([
  Type.Literal('wechat'), Type.Literal('phone'), Type.Literal('email'), Type.Literal('qq'),
  Type.Literal('office'), Type.Literal('chat'), Type.Literal('custom')
])
const TaskFilterStatusSchema = Type.Union([
  Type.Literal('applied'), Type.Literal('recruiting'), Type.Literal('upcoming'), Type.Literal('in_progress'),
  Type.Literal('review'), Type.Literal('changes_requested'), Type.Literal('completed'),
  Type.Literal('cancelled'), Type.Literal('full')
])
const BooleanQuerySchema = Type.Union([Type.Literal('true'), Type.Literal('false')])
const DateSchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
const TimeSchema = Type.String({ pattern: '^\\d{2}:\\d{2}$' })
const DeadlineSchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}(?::\\d{2})?$' })
const StringListSchema = Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 30 })
const ContactSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  type: ContactTypeSchema,
  label: Type.String({ minLength: 1, maxLength: 40 }),
  value: Type.String({ minLength: 1, maxLength: 200 })
}, { additionalProperties: false })

const taskProperties = {
  workflow: Type.Optional(Type.Object({
    templateId: Type.String({ minLength: 1, maxLength: 100 }), templateVersion: Type.Integer({ minimum: 1 }),
    mode: Type.Union([Type.Literal('individual'), Type.Literal('group')]),
    plannedMinutes: Type.Union([Type.Integer({ minimum: 0, maximum: 525600 }), Type.Null()]),
    submissionDeadline: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    personalSubmissionRequired: Type.Boolean()
  }, { additionalProperties: false })),
  title: Type.String({ minLength: 2, maxLength: 80 }),
  categoryId: Type.String({ minLength: 1, maxLength: 100 }),
  campusId: Type.String({ minLength: 1, maxLength: 100 }),
  description: Type.String({ minLength: 6, maxLength: 2000 }),
  checklist: StringListSchema,
  date: DateSchema,
  startTime: TimeSchema,
  endTime: TimeSchema,
  signupDeadline: DeadlineSchema,
  place: Type.String({ minLength: 1, maxLength: 200 }),
  duration: Type.String({ minLength: 1, maxLength: 80 }),
  capacity: Type.Integer({ minimum: 1, maximum: 10000 }),
  audienceScope: AudienceScopeSchema,
  audienceId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  requirements: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 30 }),
  proofTypes: Type.Array(ProofTypeSchema, { minItems: 1, maxItems: 3, uniqueItems: true }),
  claimMode: ClaimModeSchema,
  contacts: Type.Array(ContactSchema, { maxItems: 20 })
}

const CreateTaskSchema = Type.Object(taskProperties, { additionalProperties: false })
const PatchTaskSchema = Type.Object({
  title: Type.Optional(taskProperties.title),
  categoryId: Type.Optional(taskProperties.categoryId),
  campusId: Type.Optional(taskProperties.campusId),
  description: Type.Optional(taskProperties.description),
  checklist: Type.Optional(taskProperties.checklist),
  date: Type.Optional(taskProperties.date),
  startTime: Type.Optional(taskProperties.startTime),
  endTime: Type.Optional(taskProperties.endTime),
  signupDeadline: Type.Optional(taskProperties.signupDeadline),
  place: Type.Optional(taskProperties.place),
  duration: Type.Optional(taskProperties.duration),
  capacity: Type.Optional(taskProperties.capacity),
  audienceScope: Type.Optional(taskProperties.audienceScope),
  audienceId: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()])),
  requirements: Type.Optional(taskProperties.requirements),
  proofTypes: Type.Optional(taskProperties.proofTypes),
  claimMode: Type.Optional(taskProperties.claimMode),
  contacts: Type.Optional(taskProperties.contacts),
  version: Type.Integer({ minimum: 1 })
}, { additionalProperties: false, minProperties: 2 })
const EmptyBodySchema = Type.Object({}, { additionalProperties: false })
const VersionBodySchema = Type.Object({ version: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })
const UserVersionBodySchema = Type.Object({
  userId: Type.String({ minLength: 1, maxLength: 100 }),
  version: Type.Integer({ minimum: 1 })
}, { additionalProperties: false })
const ProofBodySchema = Type.Object({
  description: Type.String({ minLength: 6, maxLength: 400 }),
  note: Type.String({ maxLength: 200 }),
  fileIds: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 6, uniqueItems: true }),
  version: Type.Integer({ minimum: 1 })
}, { additionalProperties: false })
const ReviewBodySchema = Type.Object({
  userId: Type.String({ minLength: 1, maxLength: 100 }),
  approved: Type.Boolean(),
  feedback: Type.String({ maxLength: 400 }),
  version: Type.Integer({ minimum: 1 })
}, { additionalProperties: false })

function queryBoolean(value: unknown): boolean {
  return value === true || value === 'true'
}

export function registerTaskRoutes(app: FastifyInstance, db: AppDatabase, sessions: SessionService) {
  registerWorkflowRoutes(app, db, sessions)
  app.post('/api/tasks/:id/copy', {
    schema: { params: IdParamsSchema, body: Type.Object({ task: CreateTaskSchema }, { additionalProperties: false }), response: DefaultResponseSchema }
  }, async request => success(copyTask(db, sessions.requireUser(request, ['teacher']), (request.params as { id: string }).id, (request.body as { task: CreateTaskPayload }).task)))
  app.get('/api/tasks', {
    schema: {
      querystring: Type.Object({
        keyword: Type.Optional(Type.String({ maxLength: 80 })),
        status: Type.Optional(TaskFilterStatusSchema),
        categoryId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        campusId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        audienceScope: Type.Optional(AudienceScopeSchema),
        dateFrom: Type.Optional(DateSchema),
        dateTo: Type.Optional(DateSchema),
        mine: Type.Optional(BooleanQuerySchema),
        available: Type.Optional(BooleanQuerySchema),
        sort: Type.Optional(Type.Union([Type.Literal('time'), Type.Literal('quota')])),
        page: Type.Optional(Type.String()),
        pageSize: Type.Optional(Type.String())
      }, { additionalProperties: false }),
      response: DefaultResponseSchema
    }
  }, async (request) => {
    const viewer = sessions.requireUser(request)
    const query = request.query as Record<string, unknown>
    return success(listTasks(db, viewer, {
      keyword: typeof query.keyword === 'string' ? query.keyword.trim() : undefined,
      status: query.status as TaskStatus | MemberStatus | undefined,
      categoryId: query.categoryId as string | undefined,
      campusId: query.campusId as string | undefined,
      audienceScope: query.audienceScope as AudienceScope | undefined,
      dateFrom: query.dateFrom as string | undefined,
      dateTo: query.dateTo as string | undefined,
      mine: queryBoolean(query.mine),
      available: queryBoolean(query.available),
      sort: query.sort === 'quota' ? 'quota' : 'time',
      page: pageNumber(query.page, 1),
      pageSize: pageNumber(query.pageSize, 20, 100)
    }))
  })

  app.get('/api/tasks/:id', {
    schema: { params: IdParamsSchema, response: DefaultResponseSchema }
  }, async (request) => {
    const viewer = sessions.requireUser(request)
    return success(getTaskForViewer(db, (request.params as { id: string }).id, viewer))
  })

  app.post('/api/tasks', {
    schema: { body: CreateTaskSchema, response: DefaultResponseSchema }
  }, async (request, reply) => {
    const teacher = sessions.requireUser(request, ['teacher'])
    const task = createTask(db, teacher, request.body as CreateTaskPayload)
    reply.code(201)
    return success(task, '任务已发布')
  })

  app.patch('/api/tasks/:id', {
    schema: { params: IdParamsSchema, body: PatchTaskSchema, response: DefaultResponseSchema }
  }, async (request) => {
    const actor = sessions.requireUser(request, ['teacher', 'admin'])
    const body = request.body as TaskPatch & { audienceId?: string | null }
    const patch = { ...body } as TaskPatch
    if (body.audienceId === null) patch.audienceId = undefined
    return success(updateTask(db, actor, (request.params as { id: string }).id, patch), '任务已更新')
  })

  app.post('/api/tasks/:id/cancel', {
    schema: { params: IdParamsSchema, body: VersionBodySchema, response: DefaultResponseSchema }
  }, async (request) => {
    const actor = sessions.requireUser(request, ['teacher', 'admin'])
    const task = cancelTask(db, actor, (request.params as { id: string }).id, (request.body as { version: number }).version)
    return success(task, '任务已撤销')
  })

  app.post('/api/tasks/:id/restore', {
    schema: { params: IdParamsSchema, body: VersionBodySchema, response: DefaultResponseSchema }
  }, async (request) => {
    const admin = sessions.requireUser(request, ['admin'])
    const task = restoreTask(db, admin, (request.params as { id: string }).id, (request.body as { version: number }).version)
    return success(task, '任务已恢复')
  })

  app.post('/api/tasks/:id/claim', {
    schema: { params: IdParamsSchema, body: EmptyBodySchema, response: DefaultResponseSchema }
  }, async (request) => {
    const student = sessions.requireUser(request, ['student'])
    return success(claimTask(db, student, (request.params as { id: string }).id), '接取操作成功')
  })

  app.post('/api/tasks/:id/withdraw', {
    schema: { params: IdParamsSchema, body: EmptyBodySchema, response: DefaultResponseSchema }
  }, async (request) => {
    const student = sessions.requireUser(request, ['student'])
    return success(withdrawTask(db, student, (request.params as { id: string }).id), '已撤回参与')
  })

  app.post('/api/tasks/:id/start', {
    schema: { params: IdParamsSchema, body: EmptyBodySchema, response: DefaultResponseSchema }
  }, async (request) => {
    const student = sessions.requireUser(request, ['student'])
    return success(startTask(db, student, (request.params as { id: string }).id), '任务已开始')
  })

  app.post('/api/tasks/:id/approve', {
    schema: { params: IdParamsSchema, body: UserVersionBodySchema, response: DefaultResponseSchema }
  }, async (request) => {
    const teacher = sessions.requireUser(request, ['teacher'])
    const body = request.body as { userId: string; version: number }
    return success(approveApplication(db, teacher, (request.params as { id: string }).id, body.userId, body.version), '接单申请已通过')
  })

  app.post('/api/tasks/:id/invite', {
    schema: { params: IdParamsSchema, body: UserVersionBodySchema, response: DefaultResponseSchema }
  }, async (request) => {
    const teacher = sessions.requireUser(request, ['teacher'])
    const body = request.body as { userId: string; version: number }
    return success(inviteStudent(db, teacher, (request.params as { id: string }).id, body.userId, body.version), '已邀请学生参与')
  })

  app.post('/api/tasks/:id/proof', {
    schema: { params: IdParamsSchema, body: ProofBodySchema, response: DefaultResponseSchema }
  }, async (request) => {
    const student = sessions.requireUser(request, ['student'])
    const body = request.body as { description: string; note: string; fileIds: string[]; version: number }
    return success(submitProof(db, student, (request.params as { id: string }).id, body), '完成凭证已提交')
  })

  app.post('/api/tasks/:id/review', {
    schema: { params: IdParamsSchema, body: ReviewBodySchema, response: DefaultResponseSchema }
  }, async (request) => {
    const teacher = sessions.requireUser(request, ['teacher'])
    const body = request.body as { userId: string; approved: boolean; feedback: string; version: number }
    return success(reviewProof(db, teacher, (request.params as { id: string }).id, body), body.approved ? '凭证已通过' : '凭证已退回修改')
  })
}

// 兼容可能使用复数命名的应用装配。
export const registerTasksRoutes = registerTaskRoutes

export type { AudienceScope, ClaimMode, ContactItem, ProofType }
