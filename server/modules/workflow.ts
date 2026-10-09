import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { ConfigureWorkflowInput, ReviewRevisionInput, RosterImportInput, SubmitRevisionInput } from '../../shared/workflow-contracts.js'
import { evidenceTemplates } from '../../shared/templates.js'
import type { AppDatabase } from '../db/database.js'
import { DefaultResponseSchema, IdParamsSchema, success } from '../http.js'
import type { SessionService } from '../security/session.js'
import { assertCondition } from '../errors.js'
import { findBindingCandidate, listReusableEvidence } from './workflow.service.js'
import { batchReviewWorkflow, bindParticipant, closeoutWorkflow, configureWorkflow, confirmGroupParticipant, correctParticipantMinutes, getTaskWorkflow, getWorkflowSnapshot, handoverWorkflow, importRoster, previewRosterImport, reopenParticipant, reopenWorkflow, reviewWorkflowRevision, setParticipantOutcome, submitCommonRevision, submitWorkflowRevision } from './workflow.service.js'

const Id = Type.String({ minLength: 1, maxLength: 200 })
const Version = Type.Integer({ minimum: 1 })
const Minutes = Type.Integer({ minimum: 0, maximum: 525600 })
const NullableMinutes = Type.Union([Minutes, Type.Null()])
const Reason = Type.String({ minLength: 1, maxLength: 1000 })
const Description = Type.String({ minLength: 6, maxLength: 4000 })
const Note = Type.String({ maxLength: 1000 })
const FileIds = Type.Array(Id, { maxItems: 6, uniqueItems: true })
const ObjectSchema = <T extends Record<string, import('@sinclair/typebox').TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false })
const importFields = { source: Type.String({ minLength: 1, maxLength: 100 }), rows: Type.Array(ObjectSchema({ externalId: Type.String({ maxLength: 100 }), name: Type.String({ maxLength: 100 }), department: Type.Optional(Type.String({ maxLength: 200 })), className: Type.Optional(Type.String({ maxLength: 200 })) }), { minItems: 1, maxItems: 10000 }) }
const revisionFields = { description: Description, note: Note, fileIds: FileIds }
const reviewFields = { participantId: Id, version: Version, revisionId: Id, decision: Type.Union([Type.Literal('approved'), Type.Literal('changes_requested')]), feedback: Note, missingItems: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 30 })), confirmedMinutes: Type.Optional(NullableMinutes), commonRevisionId: Type.Optional(Id) }

export function registerWorkflowRoutes(app: FastifyInstance, db: AppDatabase, sessions: SessionService) {
  // Reject numeric identity input before AJV can coerce it and lose leading-zero provenance.
  app.addHook('preValidation', async request => {
    if (!/\/workflow\/import(?:\/preview)?(?:\?|$)/.test(request.url)) return
    const input = request.body as Partial<RosterImportInput> | undefined
    if (Array.isArray(input?.rows)) assertCondition(input.rows.every(row => row && typeof row.externalId === 'string'), 400, 'VALIDATION_ERROR', '外部编号必须使用文本，不能传入数字')
  })
  app.get('/api/workflow/templates', { schema: { response: DefaultResponseSchema } }, async request => { sessions.requireUser(request); return success(evidenceTemplates) })
  app.post('/api/tasks/:id/workflow/binding-candidate', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { params: IdParamsSchema, body: ObjectSchema({ participantId: Id, account: Type.String({ minLength: 4, maxLength: 254 }) }), response: DefaultResponseSchema }
  }, async request => success(findBindingCandidate(db, sessions.requireUser(request, ['teacher', 'admin']), (request.params as { id: string }).id, request.body as { participantId: string; account: string })))
  app.get('/api/tasks/:id/workflow/reusable-evidence', {
    schema: { params: IdParamsSchema, querystring: ObjectSchema({ participantId: Id, page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })) }), response: DefaultResponseSchema }
  }, async request => {
    const query = request.query as { participantId: string; page?: number }
    return success(listReusableEvidence(db, sessions.requireUser(request), (request.params as { id: string }).id, query.participantId, query.page))
  })
  app.get('/api/tasks/:id/workflow', { schema: { params: IdParamsSchema, response: DefaultResponseSchema } }, async request => success(getTaskWorkflow(db, sessions.requireUser(request), (request.params as { id: string }).id)))
  app.put('/api/tasks/:id/workflow/config', { schema: { params: IdParamsSchema, body: ObjectSchema({ version: Version, templateId: Id, templateVersion: Version, mode: Type.Union([Type.Literal('individual'), Type.Literal('group')]), plannedMinutes: NullableMinutes, submissionDeadline: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]), personalSubmissionRequired: Type.Boolean() }), response: DefaultResponseSchema } }, async request => success(configureWorkflow(db, sessions.requireUser(request, ['teacher','admin']), (request.params as { id: string }).id, request.body as ConfigureWorkflowInput)))
  app.post('/api/tasks/:id/workflow/import/preview', { schema: { params: IdParamsSchema, body: ObjectSchema(importFields), response: DefaultResponseSchema } }, async request => success(previewRosterImport(db, sessions.requireUser(request, ['teacher','admin']), (request.params as { id: string }).id, request.body as RosterImportInput)))
  app.post('/api/tasks/:id/workflow/import', { schema: { params: IdParamsSchema, body: ObjectSchema({ ...importFields, hash: Type.String({ pattern: '^[0-9a-f]{64}$' }), idempotencyKey: Type.String({ minLength: 1, maxLength: 100 }) }), response: DefaultResponseSchema } }, async request => success(importRoster(db, sessions.requireUser(request, ['teacher','admin']), (request.params as { id: string }).id, request.body as RosterImportInput & { hash: string; idempotencyKey: string })))
  app.post('/api/tasks/:id/workflow/bind', { schema: { params: IdParamsSchema, body: ObjectSchema({ participantId: Id, userId: Id, version: Version }), response: DefaultResponseSchema } }, async request => success(bindParticipant(db, sessions.requireUser(request, ['teacher','admin']), (request.params as { id: string }).id, request.body as { participantId: string; userId: string; version: number })))
  app.post('/api/tasks/:id/workflow/submit', { schema: { params: IdParamsSchema, body: ObjectSchema({ ...revisionFields, participantId: Id, version: Version, reportedMinutes: Type.Optional(NullableMinutes), sourceRevisionId: Type.Optional(Id) }), response: DefaultResponseSchema } }, async request => success(submitWorkflowRevision(db, sessions.requireUser(request), (request.params as { id: string }).id, request.body as SubmitRevisionInput)))
  app.post('/api/tasks/:id/workflow/common', { schema: { params: IdParamsSchema, body: ObjectSchema({ ...revisionFields, version: Version }), response: DefaultResponseSchema } }, async request => success(submitCommonRevision(db, sessions.requireUser(request, ['teacher','admin']), (request.params as { id: string }).id, request.body as { version: number; description: string; note: string; fileIds: string[] })))
  app.post('/api/tasks/:id/workflow/review', { schema: { params: IdParamsSchema, body: ObjectSchema(reviewFields), response: DefaultResponseSchema } }, async request => success(reviewWorkflowRevision(db, sessions.requireUser(request, ['teacher','admin']), (request.params as { id: string }).id, request.body as ReviewRevisionInput)))
  app.post('/api/tasks/:id/workflow/batch-review', { schema: { params: IdParamsSchema, body: ObjectSchema({ items: Type.Array(ObjectSchema(reviewFields), { minItems: 1, maxItems: 100 }) }), response: DefaultResponseSchema } }, async request => success(batchReviewWorkflow(db, sessions.requireUser(request, ['teacher','admin']), (request.params as { id: string }).id, (request.body as { items: ReviewRevisionInput[] }).items)))
  app.post('/api/tasks/:id/workflow/outcome', { schema: { params: IdParamsSchema, body: ObjectSchema({ participantId: Id, version: Version, status: Type.Union([Type.Literal('withdrawn'), Type.Literal('rejected'), Type.Literal('incomplete'), Type.Literal('cancelled')]), reason: Reason }), response: DefaultResponseSchema } }, async request => success(setParticipantOutcome(db, sessions.requireUser(request), (request.params as { id: string }).id, request.body as { participantId: string; version: number; status: 'withdrawn' | 'rejected' | 'incomplete' | 'cancelled'; reason: string })))
  app.post('/api/tasks/:id/workflow/minutes', { schema: { params: IdParamsSchema, body: ObjectSchema({ participantId: Id, version: Version, confirmedMinutes: Minutes, reason: Reason }), response: DefaultResponseSchema } }, async request => success(correctParticipantMinutes(db, sessions.requireUser(request, ['teacher','admin']), (request.params as { id: string }).id, request.body as { participantId: string; version: number; confirmedMinutes: number; reason: string })))
  app.post('/api/tasks/:id/workflow/reopen-participant', { schema: { params: IdParamsSchema, body: ObjectSchema({ participantId: Id, version: Version, reason: Reason }), response: DefaultResponseSchema } }, async request => success(reopenParticipant(db, sessions.requireUser(request, ['teacher','admin']), (request.params as { id: string }).id, request.body as { participantId: string; version: number; reason: string })))
  app.post('/api/tasks/:id/workflow/group-confirm', { schema: { params: IdParamsSchema, body: ObjectSchema({ participantId: Id, version: Version, commonRevisionId: Id, confirmedMinutes: Minutes, feedback: Note }), response: DefaultResponseSchema } }, async request => success(confirmGroupParticipant(db, sessions.requireUser(request, ['teacher','admin']), (request.params as { id: string }).id, request.body as { participantId: string; version: number; commonRevisionId: string; confirmedMinutes: number; feedback: string })))
  for (const action of ['closeout','reopen'] as const) app.post(`/api/tasks/:id/workflow/${action}`, { schema: { params: IdParamsSchema, body: ObjectSchema({ version: Version, reason: Reason }), response: DefaultResponseSchema } }, async request => success((action === 'closeout' ? closeoutWorkflow : reopenWorkflow)(db, sessions.requireUser(request, ['teacher','admin']), (request.params as { id: string }).id, request.body as { version: number; reason: string })))
  app.get('/api/tasks/:id/workflow/snapshots/:snapshotId', { schema: { params: ObjectSchema({ id: Id, snapshotId: Id }), response: DefaultResponseSchema } }, async request => { const { id, snapshotId } = request.params as { id: string; snapshotId: string }; return success(getWorkflowSnapshot(db, sessions.requireUser(request, ['teacher','admin']), id, snapshotId)) })
  app.post('/api/tasks/:id/workflow/handover', { schema: { params: IdParamsSchema, body: ObjectSchema({ ownerId: Id, version: Version, reason: Reason }), response: DefaultResponseSchema } }, async request => success(handoverWorkflow(db, sessions.requireUser(request, ['admin']), (request.params as { id: string }).id, request.body as { ownerId: string; version: number; reason: string })))
}
