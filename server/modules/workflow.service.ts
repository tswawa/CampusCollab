import { createHash } from 'node:crypto'
import type { CampusUser } from '../../shared/contracts.js'
import type { BatchReviewResult, ConfigureWorkflowInput, ProofRevision, ReviewRevisionInput, RosterImportInput, RosterImportPreview, SubmitRevisionInput, TaskWorkflow, WorkflowConfig, WorkflowParticipant, WorkflowParticipantStatus, WorkflowReview, WorkflowSnapshot } from '../../shared/workflow-contracts.js'
import { getEvidenceTemplate } from '../../shared/templates.js'
import type { AppDatabase, SqlRow } from '../db/database.js'
import { createId, nowIso } from '../db/database.js'
import { getUserById, isTaskVisibleTo, normalizeAccount } from '../db/models.js'
import { AppError, assertCondition } from '../errors.js'
import { createEventNotice } from '../i18n/notices.js'

const text = (v: unknown) => String(v ?? '')
const nullable = (v: unknown) => v === null || v === undefined ? null : text(v)
const minutes = (v: unknown) => v === null || v === undefined ? null : Number(v)
const list = (v: unknown): string[] => JSON.parse(text(v) || '[]') as string[]
const terminal = new Set(['completed', 'withdrawn', 'rejected', 'incomplete', 'cancelled'])
const active = new Set(['upcoming', 'in_progress', 'review', 'changes_requested', 'completed'])

function validMinutes(value: number | null | undefined) {
  assertCondition(value === null || value === undefined || (Number.isInteger(value) && value >= 0 && value <= 525600), 400, 'WORKFLOW_MINUTES_INVALID', '分钟数须为 0 至 525600 的整数')
}
function requiredReason(value: string) {
  assertCondition(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 1000, 400, 'WORKFLOW_REASON_REQUIRED', '请填写 1 至 1000 字的原因')
}
function audit(db: AppDatabase, actor: CampusUser, taskId: string, action: string, details: unknown) {
  db.run('INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?)', actor.id, action, 'task', taskId, JSON.stringify(details), nowIso())
}
function taskRow(db: AppDatabase, taskId: string) {
  const row = db.get('SELECT * FROM tasks WHERE id=?', taskId)
  assertCondition(row, 404, 'TASK_NOT_FOUND', '任务不存在')
  return row
}
export function assertWorkflowManager(db: AppDatabase, actor: CampusUser, taskId: string): SqlRow {
  const row = taskRow(db, taskId)
  assertCondition(actor.role === 'admin' || (actor.role === 'teacher' && row.teacher_id === actor.id), 403, 'TASK_FORBIDDEN', '只能操作本人负责的任务')
  return row
}
function isManager(db: AppDatabase, actor: CampusUser, taskId: string) {
  return actor.role === 'admin' || (actor.role === 'teacher' && taskRow(db, taskId).teacher_id === actor.id)
}
export function assertWorkflowOpen(db: AppDatabase, taskId: string) {
  assertCondition(db.get('SELECT status FROM workflow_tasks WHERE task_id=?', taskId)?.status !== 'closed', 409, 'WORKFLOW_CLOSED', '任务已结项，请先建立更正记录')
}
function assertWritable(db: AppDatabase, taskId: string) {
  assertWorkflowOpen(db, taskId)
  assertCondition(taskRow(db, taskId).status !== 'cancelled', 409, 'TASK_CANCELLED', '任务已撤销，不能继续操作')
}
function configRow(db: AppDatabase, taskId: string) {
  const row = db.get('SELECT * FROM workflow_tasks WHERE task_id=?', taskId)
  assertCondition(row, 404, 'TASK_NOT_FOUND', '任务工作流不存在')
  return row
}
function mapConfig(row: SqlRow): WorkflowConfig {
  return { templateId: text(row.template_id), templateVersion: Number(row.template_version), mode: text(row.mode) as WorkflowConfig['mode'], plannedMinutes: minutes(row.planned_minutes), submissionDeadline: nullable(row.submission_deadline), personalSubmissionRequired: Number(row.personal_submission_required) === 1, status: text(row.status) as WorkflowConfig['status'], version: Number(row.version) }
}
function participantRow(db: AppDatabase, taskId: string, id: string) {
  const row = db.get('SELECT * FROM workflow_participants WHERE task_id=? AND id=?', taskId, id)
  assertCondition(row, 404, 'WORKFLOW_PARTICIPANT_NOT_FOUND', '参与记录不存在')
  return row
}
function assertVersion(row: SqlRow, version: number) {
  assertCondition(Number(row.version) === version, 409, 'STALE_VERSION', '记录已变化，请刷新后重试')
}
function mapReview(row: SqlRow): WorkflowReview {
  return { id: text(row.id), revisionId: nullable(row.revision_id), decision: text(row.decision) as WorkflowReview['decision'], feedback: text(row.feedback), missingItems: list(row.missing_items_json), confirmedMinutes: minutes(row.confirmed_minutes), actorId: text(row.actor_id), createdAt: text(row.created_at) }
}
function mapRevision(db: AppDatabase, row: SqlRow): ProofRevision {
  const fileIds = db.all('SELECT file_id FROM workflow_revision_files WHERE revision_id=? ORDER BY sort_order', text(row.id)).map(r => text(r.file_id))
  return { id: text(row.id), participantId: nullable(row.participant_id), revision: Number(row.revision), scope: text(row.scope) as ProofRevision['scope'], description: text(row.description), note: text(row.note), fileIds, images: fileIds.map(id => `/api/files/${id}`), reportedMinutes: minutes(row.reported_minutes), submittedBy: text(row.submitted_by), submittedAt: text(row.submitted_at), sourceRevisionId: nullable(row.source_revision_id), changedFields: list(row.changed_fields_json), reviews: db.all('SELECT * FROM workflow_reviews WHERE revision_id=? ORDER BY created_at,id', text(row.id)).map(mapReview) }
}
export function mapWorkflowParticipant(db: AppDatabase, row: SqlRow): WorkflowParticipant {
  return { id: text(row.id), taskId: text(row.task_id), userId: nullable(row.user_id), externalId: nullable(row.external_id), source: text(row.source), name: text(row.name), department: text(row.department), className: text(row.class_name), status: text(row.status) as WorkflowParticipantStatus, version: Number(row.version), latestRevisionId: nullable(row.latest_revision_id), confirmedRevisionId: nullable(row.confirmed_revision_id), commonRevisionId: nullable(row.common_revision_id), reportedMinutes: minutes(row.reported_minutes), confirmedMinutes: minutes(row.confirmed_minutes), feedback: text(row.feedback), missingItems: list(row.missing_items_json), joinedAt: text(row.joined_at), revisions: db.all('SELECT * FROM workflow_revisions WHERE participant_id=? ORDER BY revision', text(row.id)).map(r => mapRevision(db, r)), reviews: db.all('SELECT * FROM workflow_reviews WHERE participant_id=? ORDER BY created_at,id', text(row.id)).map(mapReview) }
}
export function getTaskWorkflow(db: AppDatabase, actor: CampusUser, taskId: string): TaskWorkflow {
  const task = taskRow(db, taskId)
  const manager = isManager(db, actor, taskId)
  const own = db.get('SELECT * FROM workflow_participants WHERE task_id=? AND user_id=?', taskId, actor.id)
  assertCondition(manager || (actor.role === 'student' && (own || isTaskVisibleTo(task, actor))), 403, 'TASK_FORBIDDEN', '没有权限查看该任务')
  const participants = manager ? db.all('SELECT * FROM workflow_participants WHERE task_id=? ORDER BY joined_at,id', taskId) : own ? [own] : []
  const common = manager || (own && active.has(text(own.status)))
    ? db.all("SELECT * FROM workflow_revisions WHERE task_id=? AND scope='common' ORDER BY revision", taskId).map(r => mapRevision(db, r)) : []
  // Common materials are visible, but other participants' review comments stay private.
  if (!manager) common.forEach(r => { r.reviews = r.reviews.filter(review => own && db.get('SELECT participant_id FROM workflow_reviews WHERE id=?', review.id)?.participant_id === own.id) })
  return { taskId, config: mapConfig(configRow(db, taskId)), participants: participants.map(r => mapWorkflowParticipant(db, r)), commonRevisions: common, snapshots: manager ? db.all('SELECT * FROM workflow_snapshots WHERE task_id=? ORDER BY version DESC', taskId).map(r => ({ id: text(r.id), version: Number(r.version), supersedesId: nullable(r.supersedes_id), reason: text(r.reason), createdAt: text(r.created_at), createdBy: text(r.created_by) })) : [], canManage: manager }
}
function bump(db: AppDatabase, taskId: string) {
  db.run('UPDATE workflow_tasks SET version=version+1,updated_at=? WHERE task_id=?', nowIso(), taskId)
  db.run('UPDATE tasks SET version=version+1,updated_at=? WHERE id=?', nowIso(), taskId)
}
function mirrorMember(db: AppDatabase, row: SqlRow) {
  if (!row.user_id) return
  const status = ['withdrawn','rejected','incomplete'].includes(text(row.status)) ? 'cancelled' : text(row.status)
  db.run('UPDATE task_members SET status=?,feedback=?,version=?,updated_at=? WHERE task_id=? AND user_id=?', status, text(row.feedback), Number(row.version), nowIso(), text(row.task_id), text(row.user_id))
}
export function initializeWorkflow(db: AppDatabase, taskId: string, input?: Omit<ConfigureWorkflowInput, 'version'>) {
  const config = input ?? { templateId: 'generic-practice', templateVersion: 1, mode: 'individual', plannedMinutes: null, submissionDeadline: null, personalSubmissionRequired: true }
  const template = getEvidenceTemplate(config.templateId, config.templateVersion)
  assertCondition(template, 400, 'WORKFLOW_TEMPLATE_INVALID', '模板或版本不存在')
  validMinutes(config.plannedMinutes)
  assertCondition(!config.submissionDeadline || Number.isFinite(Date.parse(config.submissionDeadline)), 400, 'WORKFLOW_DEADLINE_INVALID', '提交截止时间无效')
  assertCondition(['individual', 'group'].includes(config.mode) && typeof config.personalSubmissionRequired === 'boolean', 400, 'VALIDATION_ERROR', '任务材料模式无效')
  db.run('UPDATE workflow_tasks SET template_id=?,template_version=?,template_json=?,mode=?,planned_minutes=?,submission_deadline=?,personal_submission_required=? WHERE task_id=?', config.templateId, config.templateVersion, JSON.stringify(template), config.mode, config.plannedMinutes, config.submissionDeadline, Number(config.personalSubmissionRequired), taskId)
}
export function configureWorkflow(db: AppDatabase, actor: CampusUser, taskId: string, input: ConfigureWorkflowInput) {
  db.transaction(() => {
    assertWorkflowManager(db, actor, taskId); assertWritable(db, taskId)
    const current = configRow(db, taskId); assertVersion(current, input.version)
    const template = getEvidenceTemplate(input.templateId, input.templateVersion)
    assertCondition(template, 400, 'WORKFLOW_TEMPLATE_INVALID', '模板或版本不存在')
    const requirementsChanged = current.template_id !== input.templateId || Number(current.template_version) !== input.templateVersion || current.mode !== input.mode || Number(current.personal_submission_required) !== Number(input.personalSubmissionRequired)
    assertCondition(!requirementsChanged || !db.get('SELECT id FROM workflow_revisions WHERE task_id=? LIMIT 1', taskId), 409, 'WORKFLOW_REQUIREMENTS_FROZEN', '已有材料提交，模板与材料规则已固定')
    validMinutes(input.plannedMinutes)
    assertCondition(!input.submissionDeadline || Number.isFinite(Date.parse(input.submissionDeadline)), 400, 'WORKFLOW_DEADLINE_INVALID', '提交截止时间无效')
    db.run('UPDATE workflow_tasks SET template_id=?,template_version=?,template_json=?,mode=?,planned_minutes=?,submission_deadline=?,personal_submission_required=? WHERE task_id=?', input.templateId, input.templateVersion, JSON.stringify(template), input.mode, input.plannedMinutes, input.submissionDeadline, Number(input.personalSubmissionRequired), taskId)
    bump(db, taskId); audit(db, actor, taskId, 'workflow.configured', input)
  })
  return getTaskWorkflow(db, actor, taskId)
}

function normalizedImport(input: RosterImportInput): RosterImportInput {
  assertCondition(typeof input.source === 'string' && input.source.trim().length > 0 && input.source.length <= 100, 400, 'WORKFLOW_IMPORT_SOURCE_INVALID', '请填写名单来源')
  assertCondition(Array.isArray(input.rows) && input.rows.length > 0 && input.rows.length <= 10000, 400, 'WORKFLOW_IMPORT_SIZE_INVALID', '名单须为 1 至 10000 行')
  return { source: input.source.trim(), rows: input.rows.map(r => ({ externalId: typeof r.externalId === 'string' ? r.externalId.trim() : '', name: text(r.name).trim(), department: text(r.department).trim(), className: text(r.className).trim() })) }
}
export function previewRosterImport(db: AppDatabase, actor: CampusUser, taskId: string, input: RosterImportInput): RosterImportPreview {
  assertWorkflowManager(db, actor, taskId)
  const normalized = normalizedImport(input)
  const counts = new Map<string, number>(); const names = new Map<string, number>()
  normalized.rows.forEach(r => { counts.set(r.externalId, (counts.get(r.externalId) ?? 0) + 1); names.set(r.name, (names.get(r.name) ?? 0) + 1) })
  const rows: RosterImportPreview['rows'] = normalized.rows.map((r, index) => {
    const errors: string[] = []; const warnings: string[] = []
    if (!r.externalId || r.externalId.length > 100) errors.push('EXTERNAL_ID_REQUIRED')
    if (!r.name || r.name.length > 100) errors.push('NAME_REQUIRED')
    if ((r.department?.length ?? 0) > 200 || (r.className?.length ?? 0) > 200) errors.push('FIELD_TOO_LONG')
    if ((counts.get(r.externalId) ?? 0) > 1) errors.push('DUPLICATE_EXTERNAL_ID')
    if ((names.get(r.name) ?? 0) > 1) warnings.push('SAME_NAME_DISTINCT_IDENTITIES')
    const existing = db.get('SELECT * FROM workflow_participants WHERE task_id=? AND source=? AND external_id=?', taskId, normalized.source, r.externalId)
    if (existing && (existing.name !== r.name || existing.department !== r.department || existing.class_name !== r.className)) errors.push('EXISTING_ID_CONFLICT')
    return { row: index + 1, externalId: r.externalId, name: r.name, action: errors.length ? 'error' : existing ? 'unchanged' : 'add', errors, warnings }
  })
  return { hash: createHash('sha256').update(JSON.stringify(normalized)).digest('hex'), source: normalized.source, valid: rows.every(r => r.action !== 'error'), added: rows.filter(r => r.action === 'add').length, unchanged: rows.filter(r => r.action === 'unchanged').length, rows }
}
export function importRoster(db: AppDatabase, actor: CampusUser, taskId: string, input: RosterImportInput & { hash: string; idempotencyKey: string }) {
  db.transaction(() => {
    assertWorkflowManager(db, actor, taskId)
    const preview = previewRosterImport(db, actor, taskId, input)
    assertCondition(preview.hash === input.hash, 409, 'WORKFLOW_IMPORT_CHANGED', '预览与提交内容不一致，请重新预览')
    assertCondition(input.idempotencyKey.length > 0 && input.idempotencyKey.length <= 100, 400, 'WORKFLOW_IDEMPOTENCY_REQUIRED', '请提供导入请求编号')
    const previous = db.get('SELECT payload_hash FROM workflow_imports WHERE task_id=? AND idempotency_key=?', taskId, input.idempotencyKey)
    if (previous) { assertCondition(previous.payload_hash === preview.hash, 409, 'WORKFLOW_IDEMPOTENCY_CONFLICT', '该请求编号已用于其他名单'); return }
    assertWritable(db, taskId)
    assertCondition(preview.valid, 409, 'WORKFLOW_IMPORT_CONFLICT', '名单存在错误或冲突，请修正后导入')
    const occupied = Number(db.get("SELECT COUNT(*) count FROM workflow_participants WHERE task_id=? AND status NOT IN ('applied','withdrawn','rejected','incomplete','cancelled')", taskId)?.count)
    assertCondition(occupied + preview.added <= Number(taskRow(db, taskId).capacity), 409, 'TASK_FULL', '导入人数超出任务名额')
    const normalized = normalizedImport(input)
    normalized.rows.forEach((r, index) => {
      if (preview.rows[index].action !== 'add') return
      const timestamp = nowIso()
      db.run("INSERT INTO workflow_participants(id,task_id,external_id,source,name,department,class_name,status,joined_at,updated_at) VALUES(?,?,?,?,?,?,?,'upcoming',?,?)", createId('participant'), taskId, r.externalId, normalized.source, r.name, r.department!, r.className!, timestamp, timestamp)
    })
    db.run('INSERT INTO workflow_imports(task_id,idempotency_key,payload_hash,actor_id,created_at) VALUES(?,?,?,?,?)', taskId, input.idempotencyKey, preview.hash, actor.id, nowIso())
    bump(db, taskId); audit(db, actor, taskId, 'workflow.roster_imported', { source: normalized.source, hash: preview.hash, added: preview.added, unchanged: preview.unchanged })
  })
  return getTaskWorkflow(db, actor, taskId)
}
export function findBindingCandidate(db: AppDatabase, actor: CampusUser, taskId: string, input: { participantId: string; account: string }) {
  assertWorkflowManager(db, actor, taskId); assertWritable(db, taskId)
  const participant = participantRow(db, taskId, input.participantId)
  assertCondition(!participant.user_id, 409, 'WORKFLOW_ALREADY_BOUND', '参与记录已绑定账号')
  const row = db.get("SELECT id,account,name,external_id FROM users WHERE account_normalized=? AND role='student' AND approval='approved'", normalizeAccount(input.account))
  if (!row) return null
  return { id: text(row.id), account: text(row.account), name: text(row.name), externalId: nullable(row.external_id) }
}

export function listReusableEvidence(db: AppDatabase, actor: CampusUser, taskId: string, participantId: string, page = 1): import('../../shared/workflow-contracts.js').ReusableEvidencePage {
  assertWritable(db, taskId)
  const target = participantRow(db, taskId, participantId)
  assertCondition(isManager(db, actor, taskId) || (actor.role === 'student' && target.user_id === actor.id), 403, 'TASK_FORBIDDEN', '只能查看本人或负责任务的材料')
  const candidates = db.all(`SELECT r.*, t.title AS task_title, COALESCE(p.name,'') AS participant_name
    FROM workflow_revisions r JOIN tasks t ON t.id=r.task_id LEFT JOIN workflow_participants p ON p.id=r.participant_id
    WHERE (?='admin' OR (?='teacher' AND t.teacher_id=?) OR (?='student' AND p.user_id=?))
    ORDER BY r.submitted_at DESC,r.id DESC LIMIT 21 OFFSET ?`, actor.role, actor.role, actor.id, actor.role, actor.id, (page - 1) * 20)
  const items = candidates.slice(0, 20).map(row => ({ taskId: text(row.task_id), taskTitle: text(row.task_title), participantName: text(row.participant_name), revision: mapRevision(db, row) }))
    .filter(item => item.revision.fileIds.every(id => canReadWorkflowFile(db, actor, id)))
  return { items, hasMore: candidates.length > 20 }
}

export function bindParticipant(db: AppDatabase, actor: CampusUser, taskId: string, input: { participantId: string; userId: string; version: number }) {
  db.transaction(() => {
    assertWorkflowManager(db, actor, taskId); assertWritable(db, taskId)
    const row = participantRow(db, taskId, input.participantId); assertVersion(row, input.version)
    assertCondition(!row.user_id, 409, 'WORKFLOW_ALREADY_BOUND', '参与记录已绑定账号')
    const user = getUserById(db, input.userId)
    assertCondition(user && user.role === 'student' && user.approval === 'approved', 400, 'STUDENT_INVALID', '只能绑定已启用的学生账号')
    assertCondition(!db.get('SELECT id FROM workflow_participants WHERE task_id=? AND user_id=?', taskId, input.userId), 409, 'WORKFLOW_BIND_CONFLICT', '该账号已有参与记录，请人工核对')
    db.run('UPDATE workflow_participants SET user_id=?,version=version+1,updated_at=? WHERE id=?', input.userId, nowIso(), input.participantId)
    const updated = participantRow(db, taskId, input.participantId)
    const status = ['withdrawn','rejected','incomplete'].includes(text(updated.status)) ? 'cancelled' : text(updated.status)
    db.run('INSERT INTO task_members(task_id,user_id,status,claimed_at,feedback,version,updated_at) VALUES(?,?,?,?,?,?,?)', taskId, input.userId, status, text(row.joined_at), text(row.feedback), Number(updated.version), nowIso())
    if (updated.latest_revision_id) projectLegacyProof(db, updated, text(updated.latest_revision_id))
    bump(db, taskId); audit(db, actor, taskId, 'workflow.identity_bound', { participantId: input.participantId, userId: input.userId, externalId: row.external_id, source: row.source })
  })
  return getTaskWorkflow(db, actor, taskId)
}

export function fileIsReferenced(db: AppDatabase, fileId: string): boolean {
  return Boolean(db.get('SELECT 1 found FROM workflow_revision_files WHERE file_id=? LIMIT 1', fileId) || db.get('SELECT 1 found FROM proof_files WHERE file_id=? LIMIT 1', fileId))
}
export function canReadWorkflowFile(db: AppDatabase, user: CampusUser, fileId: string): boolean {
  if (user.role === 'admin') return true
  const file = db.get('SELECT * FROM files WHERE id=?', fileId)
  if (!file || file.purpose !== 'proof') return false
  const currentOwner = user.role === 'teacher' && file.task_id && taskRow(db, text(file.task_id)).teacher_id === user.id
  if (file.owner_user_id === user.id && file.status === 'temporary' && Number(file.expires_at) > Date.now() && (user.role === 'student' || currentOwner)) return true
  if (file.status === 'attached' && db.get('SELECT 1 found FROM proof_files WHERE file_id=?', fileId) && (currentOwner || (user.role === 'student' && file.owner_user_id === user.id))) return true
  return Boolean(db.get(`SELECT 1 found FROM workflow_revision_files rf JOIN workflow_revisions r ON r.id=rf.revision_id JOIN tasks t ON t.id=r.task_id
    LEFT JOIN workflow_participants p ON p.id=r.participant_id
    WHERE rf.file_id=? AND ((?='teacher' AND t.teacher_id=?) OR (?='student' AND p.user_id=?) OR
    (?='student' AND r.scope='common' AND EXISTS(SELECT 1 FROM workflow_participants own WHERE own.task_id=r.task_id AND own.user_id=? AND own.status IN ('upcoming','in_progress','review','changes_requested','completed')))) LIMIT 1`, fileId, user.role, user.id, user.role, user.id, user.role, user.id))
}
export function assertWorkflowUploadAllowed(db: AppDatabase, user: CampusUser, taskId: string) {
  assertWritable(db, taskId)
  if (isManager(db, user, taskId)) return
  const own = db.get('SELECT status FROM workflow_participants WHERE task_id=? AND user_id=?', taskId, user.id)
  assertCondition(user.role === 'student' && own && ['upcoming','in_progress','changes_requested'].includes(text(own.status)), 409, 'PROOF_UPLOAD_NOT_ALLOWED', '当前参与状态不能上传材料')
}
function checkFiles(db: AppDatabase, actor: CampusUser, taskId: string, fileIds: string[], previous?: SqlRow, source?: SqlRow) {
  assertCondition(fileIds.length <= 6 && new Set(fileIds).size === fileIds.length, 400, 'PROOF_FILES_INVALID', '文件最多 6 个且不能重复')
  const retained = new Set<string>()
  for (const revision of [previous, source]) if (revision) db.all('SELECT file_id FROM workflow_revision_files WHERE revision_id=?', text(revision.id)).forEach(r => retained.add(text(r.file_id)))
  for (const fileId of fileIds) {
    const file = db.get('SELECT * FROM files WHERE id=?', fileId)
    assertCondition(file && file.purpose === 'proof' && ((file.owner_user_id === actor.id && file.task_id === taskId && file.status === 'temporary' && Number(file.expires_at) > Date.now()) || (retained.has(fileId) && canReadWorkflowFile(db, actor, fileId))), 400, 'PROOF_FILE_FORBIDDEN', '材料文件须为授权的当前上传或明确引用的版本')
  }
}
function templateFor(db: AppDatabase, taskId: string) {
  const row = configRow(db, taskId)
  const saved = JSON.parse(text(row.template_json)) as ReturnType<typeof getEvidenceTemplate>
  const template = saved?.id ? saved : getEvidenceTemplate(text(row.template_id), Number(row.template_version))
  // Legacy image requirements remain part of the frozen effective evidence contract.
  if (template && list(taskRow(db, taskId).proof_types_json).includes('image')) template.items = template.items.map(item => item.kind === 'image' ? { ...item, required: true, minFiles: Math.max(1, item.minFiles ?? 0) } : item)
  return template
}
function insertRevision(db: AppDatabase, actor: CampusUser, taskId: string, participant: SqlRow | null, input: { description: string; note: string; fileIds: string[]; reportedMinutes?: number | null; sourceRevisionId?: string }) {
  assertCondition(typeof input.description === 'string' && input.description.trim().length >= 6 && input.description.length <= 4000 && typeof input.note === 'string' && input.note.length <= 1000, 400, 'PROOF_DESCRIPTION_INVALID', '材料说明须为 6 至 4000 字，备注最多 1000 字')
  validMinutes(input.reportedMinutes)
  const previous = participant ? db.get('SELECT * FROM workflow_revisions WHERE id=?', text(participant.latest_revision_id)) : db.get("SELECT * FROM workflow_revisions WHERE task_id=? AND scope='common' ORDER BY revision DESC LIMIT 1", taskId)
  let source: SqlRow | undefined
  if (input.sourceRevisionId) {
    source = db.get('SELECT * FROM workflow_revisions WHERE id=?', input.sourceRevisionId)
    assertCondition(source, 404, 'WORKFLOW_SOURCE_NOT_FOUND', '引用的材料版本不存在')
    const owner = source.participant_id ? db.get('SELECT user_id FROM workflow_participants WHERE id=?', text(source.participant_id)) : undefined
    assertCondition(isManager(db, actor, text(source.task_id)) || (actor.role === 'student' && owner?.user_id === actor.id), 403, 'WORKFLOW_SOURCE_FORBIDDEN', '没有权限引用该材料版本')
  }
  checkFiles(db, actor, taskId, input.fileIds, previous, source)
  const template = templateFor(db, taskId)
  const task = taskRow(db, taskId)
  const imageRequired = template?.items.some(i => i.kind === 'image' && i.required) || list(task.proof_types_json).includes('image')
  assertCondition(!imageRequired || input.fileIds.length > 0, 400, 'PROOF_IMAGE_REQUIRED', '该任务要求至少提交一张图片')
  const changedFields = ['description','note','reportedMinutes','fileIds'].filter(field => {
    if (!previous) return true
    if (field === 'fileIds') return JSON.stringify(db.all('SELECT file_id FROM workflow_revision_files WHERE revision_id=? ORDER BY sort_order', text(previous.id)).map(r => text(r.file_id))) !== JSON.stringify(input.fileIds)
    if (field === 'reportedMinutes') return minutes(previous.reported_minutes) !== (input.reportedMinutes ?? null)
    return text(previous[field]) !== text(input[field as 'description' | 'note']).trim()
  })
  const id = createId('revision')
  db.run('INSERT INTO workflow_revisions(id,task_id,participant_id,scope,revision,description,note,reported_minutes,submitted_by,submitted_at,source_revision_id,changed_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, taskId, participant ? text(participant.id) : null, participant ? 'personal' : 'common', Number(previous?.revision ?? 0) + 1, input.description.trim(), input.note.trim(), input.reportedMinutes ?? null, actor.id, nowIso(), input.sourceRevisionId ?? null, JSON.stringify(changedFields))
  input.fileIds.forEach((fileId, index) => { db.run('INSERT INTO workflow_revision_files(revision_id,file_id,sort_order) VALUES(?,?,?)', id, fileId, index); db.run("UPDATE files SET status='attached',expires_at=NULL WHERE id=?", fileId) })
  return id
}
function projectLegacyProof(db: AppDatabase, participant: SqlRow, revisionId: string) {
  if (!participant.user_id) return
  const rev = db.get('SELECT * FROM workflow_revisions WHERE id=?', revisionId)!
  const old = db.get('SELECT id FROM proofs WHERE task_id=? AND user_id=?', text(participant.task_id), text(participant.user_id))
  const id = old ? text(old.id) : createId('proof')
  if (old) {
    db.run('DELETE FROM proof_files WHERE proof_id=?', id)
    db.run('UPDATE proofs SET description=?,note=?,submitted_at=?,version=? WHERE id=?', text(rev.description), text(rev.note), text(rev.submitted_at), Number(rev.revision), id)
  } else db.run('INSERT INTO proofs(id,task_id,user_id,description,note,submitted_at,version) VALUES(?,?,?,?,?,?,?)', id, text(participant.task_id), text(participant.user_id), text(rev.description), text(rev.note), text(rev.submitted_at), Number(rev.revision))
  // Legacy proof_files has a UNIQUE(file_id) constraint. Cross-task references remain in revision_files.
  db.all('SELECT file_id,sort_order FROM workflow_revision_files WHERE revision_id=?', revisionId).forEach(file => {
    if (!db.get('SELECT 1 found FROM proof_files WHERE file_id=?', text(file.file_id))) db.run('INSERT INTO proof_files(proof_id,file_id,sort_order) VALUES(?,?,?)', id, text(file.file_id), Number(file.sort_order))
  })
}
export function submitWorkflowRevision(db: AppDatabase, actor: CampusUser, taskId: string, input: SubmitRevisionInput) {
  db.transaction(() => {
    assertWritable(db, taskId)
    const row = participantRow(db, taskId, input.participantId); assertVersion(row, input.version)
    assertCondition(isManager(db, actor, taskId) || (actor.role === 'student' && row.user_id === actor.id), 403, 'TASK_FORBIDDEN', '只能提交本人或负责任务的材料')
    assertCondition(['upcoming','in_progress','changes_requested'].includes(text(row.status)), 409, 'PROOF_SUBMIT_FORBIDDEN', '当前参与状态不能提交材料')
    const config = configRow(db, taskId)
    assertCondition(!config.submission_deadline || Date.parse(text(config.submission_deadline)) >= Date.now(), 409, 'WORKFLOW_SUBMISSION_CLOSED', '材料提交已截止')
    const revisionId = insertRevision(db, actor, taskId, row, input)
    db.run("UPDATE workflow_participants SET latest_revision_id=?,reported_minutes=?,status='review',feedback='',missing_items_json='[]',confirmed_revision_id=NULL,confirmed_minutes=NULL,version=version+1,updated_at=? WHERE id=?", revisionId, input.reportedMinutes ?? null, nowIso(), input.participantId)
    mirrorMember(db, participantRow(db, taskId, input.participantId)); projectLegacyProof(db, row, revisionId)
    bump(db, taskId); audit(db, actor, taskId, 'workflow.submitted', { participantId: input.participantId, revisionId, sourceRevisionId: input.sourceRevisionId ?? null })
    createEventNotice(db, text(taskRow(db, taskId).teacher_id), 'task.proof_submitted', { taskTitle: text(taskRow(db, taskId).title), actorName: text(row.name) }, { kind: 'task', id: taskId }, 'review')
  })
  return getTaskWorkflow(db, actor, taskId)
}
export function submitCommonRevision(db: AppDatabase, actor: CampusUser, taskId: string, input: { version: number; description: string; note: string; fileIds: string[] }) {
  db.transaction(() => {
    assertWorkflowManager(db, actor, taskId); assertWritable(db, taskId)
    const config = configRow(db, taskId); assertVersion(config, input.version)
    assertCondition(config.mode === 'group', 409, 'WORKFLOW_GROUP_REQUIRED', '仅集体活动可提交公共材料')
    const revisionId = insertRevision(db, actor, taskId, null, input)
    bump(db, taskId); audit(db, actor, taskId, 'workflow.common_submitted', { revisionId })
  })
  return getTaskWorkflow(db, actor, taskId)
}
function addReview(db: AppDatabase, actor: CampusUser, row: SqlRow, decision: WorkflowReview['decision'], feedback: string, missingItems: string[], confirmedMinutes: number | null, revisionId: string | null) {
  db.run('INSERT INTO workflow_reviews(id,participant_id,revision_id,decision,feedback,missing_items_json,confirmed_minutes,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)', createId('review'), text(row.id), revisionId, decision, feedback, JSON.stringify(missingItems), confirmedMinutes, actor.id, nowIso())
}
function checkCommonRevision(db: AppDatabase, taskId: string, revisionId: string) {
  assertCondition(db.get("SELECT id FROM workflow_revisions WHERE id=? AND task_id=? AND scope='common'", revisionId, taskId), 409, 'WORKFLOW_COMMON_REVISION_INVALID', '公共材料版本不属于该任务')
}
function reviewInside(db: AppDatabase, actor: CampusUser, taskId: string, input: ReviewRevisionInput) {
  assertWorkflowManager(db, actor, taskId); assertWritable(db, taskId)
  const row = participantRow(db, taskId, input.participantId); assertVersion(row, input.version)
  assertCondition(row.status === 'review', 409, 'REVIEW_ALREADY_PROCESSED', '该参与记录当前未待审')
  assertCondition(row.latest_revision_id === input.revisionId, 409, 'WORKFLOW_REVISION_STALE', '待审材料已变化，请核对最新版本')
  const approved = input.decision === 'approved'; const missing = input.missingItems ?? []
  assertCondition(input.feedback.length <= 1000 && missing.length <= 30 && missing.every(i => typeof i === 'string' && i.trim().length > 0 && i.length <= 200), 400, 'REVIEW_FEEDBACK_INVALID', '补正反馈内容无效')
  if (!approved) requiredReason(input.feedback)
  validMinutes(input.confirmedMinutes)
  if (input.commonRevisionId) checkCommonRevision(db, taskId, input.commonRevisionId)
  addReview(db, actor, row, input.decision, input.feedback.trim(), missing, approved ? input.confirmedMinutes ?? null : null, input.revisionId)
  db.run('UPDATE workflow_participants SET status=?,feedback=?,missing_items_json=?,confirmed_revision_id=?,common_revision_id=?,confirmed_minutes=?,version=version+1,updated_at=? WHERE id=?', approved ? 'completed' : 'changes_requested', input.feedback.trim(), JSON.stringify(missing), approved ? input.revisionId : null, approved ? input.commonRevisionId ?? null : null, approved ? input.confirmedMinutes ?? null : null, nowIso(), input.participantId)
  mirrorMember(db, participantRow(db, taskId, input.participantId)); bump(db, taskId)
  audit(db, actor, taskId, 'workflow.reviewed', { ...input })
  if (row.user_id) createEventNotice(db, text(row.user_id), approved ? 'task.proof_approved' : 'task.changes_requested', { taskTitle: text(taskRow(db, taskId).title), feedback: input.feedback.trim() }, { kind: 'task', id: taskId }, 'review')
  return mapWorkflowParticipant(db, participantRow(db, taskId, input.participantId))
}
export function reviewWorkflowRevision(db: AppDatabase, actor: CampusUser, taskId: string, input: ReviewRevisionInput) {
  db.transaction(() => reviewInside(db, actor, taskId, input))
  return getTaskWorkflow(db, actor, taskId)
}
export function batchReviewWorkflow(db: AppDatabase, actor: CampusUser, taskId: string, items: ReviewRevisionInput[]): BatchReviewResult {
  assertWorkflowManager(db, actor, taskId)
  assertCondition(items.length > 0 && items.length <= 100, 400, 'WORKFLOW_BATCH_SIZE_INVALID', '每批可审核 1 至 100 人')
  return { results: items.map(input => {
    try { return { participantId: input.participantId, ok: true, participant: db.transaction(() => reviewInside(db, actor, taskId, input)) } }
    catch (error) { if (!(error instanceof AppError)) throw error; return { participantId: input.participantId, ok: false, code: error.code, message: error.message } }
  }) }
}
export function setParticipantOutcome(db: AppDatabase, actor: CampusUser, taskId: string, input: { participantId: string; version: number; status: 'withdrawn' | 'rejected' | 'incomplete' | 'cancelled'; reason: string }) {
  db.transaction(() => {
    assertWritable(db, taskId); requiredReason(input.reason)
    const row = participantRow(db, taskId, input.participantId); assertVersion(row, input.version)
    const ownWithdrawal = actor.role === 'student' && row.user_id === actor.id && input.status === 'withdrawn' && ['applied','upcoming','in_progress','changes_requested'].includes(text(row.status))
    assertCondition(isManager(db, actor, taskId) || ownWithdrawal, 403, 'TASK_FORBIDDEN', '没有权限设置此参与结果')
    assertCondition(!terminal.has(text(row.status)), 409, 'WORKFLOW_OUTCOME_FINAL', '参与记录已有终态，请先按更正流程处理')
    if (input.status === 'rejected') assertCondition(row.status === 'applied', 409, 'WORKFLOW_REJECTION_INVALID', '只能拒绝待审批申请')
    addReview(db, actor, row, input.status, input.reason.trim(), [], null, nullable(row.latest_revision_id))
    db.run('UPDATE workflow_participants SET status=?,feedback=?,confirmed_revision_id=NULL,common_revision_id=NULL,confirmed_minutes=NULL,version=version+1,updated_at=? WHERE id=?', input.status, input.reason.trim(), nowIso(), input.participantId)
    mirrorMember(db, participantRow(db, taskId, input.participantId)); bump(db, taskId); audit(db, actor, taskId, 'workflow.outcome', input)
    if (input.status === 'withdrawn') createEventNotice(db, text(taskRow(db, taskId).teacher_id), 'task.withdrawn', { taskTitle: text(taskRow(db, taskId).title), actorName: text(row.name) }, { kind: 'task', id: taskId })
    if (input.status === 'rejected' && row.user_id) createEventNotice(db, text(row.user_id), 'task.application_rejected', { taskTitle: text(taskRow(db, taskId).title), feedback: input.reason.trim() }, { kind: 'task', id: taskId })
  })
  return getTaskWorkflow(db, actor, taskId)
}
export function confirmGroupParticipant(db: AppDatabase, actor: CampusUser, taskId: string, input: { participantId: string; version: number; commonRevisionId: string; confirmedMinutes: number; feedback: string }) {
  db.transaction(() => {
    assertWorkflowManager(db, actor, taskId); assertWritable(db, taskId); validMinutes(input.confirmedMinutes)
    const config = configRow(db, taskId)
    assertCondition(config.mode === 'group', 409, 'WORKFLOW_GROUP_REQUIRED', '仅集体活动可确认公共材料参与结果')
    const row = participantRow(db, taskId, input.participantId); assertVersion(row, input.version)
    assertCondition(['upcoming','in_progress','review','changes_requested'].includes(text(row.status)), 409, 'WORKFLOW_OUTCOME_FINAL', '该记录当前不能确认')
    checkCommonRevision(db, taskId, input.commonRevisionId)
    if (Number(config.personal_submission_required) === 1) assertCondition(row.status === 'review' && row.latest_revision_id, 409, 'WORKFLOW_PERSONAL_REQUIRED', '该活动要求先提交个人材料')
    addReview(db, actor, row, 'approved', input.feedback.trim(), [], input.confirmedMinutes, nullable(row.latest_revision_id) ?? input.commonRevisionId)
    db.run("UPDATE workflow_participants SET status='completed',confirmed_revision_id=?,common_revision_id=?,confirmed_minutes=?,feedback=?,missing_items_json='[]',version=version+1,updated_at=? WHERE id=?", nullable(row.latest_revision_id), input.commonRevisionId, input.confirmedMinutes, input.feedback.trim(), nowIso(), input.participantId)
    mirrorMember(db, participantRow(db, taskId, input.participantId)); bump(db, taskId); audit(db, actor, taskId, 'workflow.group_confirmed', input)
  })
  return getTaskWorkflow(db, actor, taskId)
}
export function correctParticipantMinutes(db: AppDatabase, actor: CampusUser, taskId: string, input: { participantId: string; version: number; confirmedMinutes: number; reason: string }) {
  db.transaction(() => {
    assertWorkflowManager(db, actor, taskId); assertWritable(db, taskId); requiredReason(input.reason); validMinutes(input.confirmedMinutes)
    const row = participantRow(db, taskId, input.participantId); assertVersion(row, input.version)
    assertCondition(row.status === 'completed', 409, 'WORKFLOW_MINUTES_UNCONFIRMED', '只有已通过记录可以更正确认时长')
    addReview(db, actor, row, 'minutes_corrected', input.reason.trim(), [], input.confirmedMinutes, nullable(row.confirmed_revision_id) ?? nullable(row.common_revision_id))
    db.run('UPDATE workflow_participants SET confirmed_minutes=?,version=version+1,updated_at=? WHERE id=?', input.confirmedMinutes, nowIso(), input.participantId)
    mirrorMember(db, participantRow(db, taskId, input.participantId)); bump(db, taskId); audit(db, actor, taskId, 'workflow.minutes_corrected', { ...input, previousMinutes: row.confirmed_minutes })
  })
  return getTaskWorkflow(db, actor, taskId)
}

export function reopenParticipant(db: AppDatabase, actor: CampusUser, taskId: string, input: { participantId: string; version: number; reason: string }) {
  db.transaction(() => {
    assertWorkflowManager(db, actor, taskId); assertWritable(db, taskId); requiredReason(input.reason)
    const row = participantRow(db, taskId, input.participantId); assertVersion(row, input.version)
    assertCondition(terminal.has(text(row.status)), 409, 'WORKFLOW_OUTCOME_FINAL', '只能对已终结的参与记录发起更正')
    const status = Number(row.admitted) === 1 ? 'changes_requested' : 'applied'
    if (status !== 'applied' && row.status !== 'completed') {
      const occupied = Number(db.get("SELECT COUNT(*) n FROM workflow_participants WHERE task_id=? AND status IN ('upcoming','in_progress','review','changes_requested','completed')", taskId)?.n)
      assertCondition(occupied < Number(taskRow(db, taskId).capacity), 409, 'TASK_FULL', '当前没有可恢复的参与名额')
    }
    addReview(db, actor, row, 'reopened', input.reason.trim(), [], minutes(row.confirmed_minutes), nullable(row.confirmed_revision_id) ?? nullable(row.latest_revision_id))
    db.run("UPDATE workflow_participants SET status=?,feedback=?,confirmed_revision_id=NULL,common_revision_id=NULL,confirmed_minutes=NULL,version=version+1,updated_at=? WHERE id=?", status, input.reason.trim(), nowIso(), input.participantId)
    mirrorMember(db, participantRow(db, taskId, input.participantId)); bump(db, taskId); audit(db, actor, taskId, 'workflow.participant_reopened', { ...input, previousStatus: row.status })
    if (row.user_id) createEventNotice(db, text(row.user_id), status === 'applied' ? 'task.updated' : 'task.changes_requested', { taskTitle: text(taskRow(db, taskId).title), feedback: input.reason.trim() }, { kind: 'task', id: taskId }, status === 'applied' ? 'task' : 'review')
  })
  return getTaskWorkflow(db, actor, taskId)
}

export function closeoutWorkflow(db: AppDatabase, actor: CampusUser, taskId: string, input: { version: number; reason: string }): WorkflowSnapshot {
  return db.transaction(() => {
    const task = assertWorkflowManager(db, actor, taskId); assertWorkflowOpen(db, taskId); requiredReason(input.reason)
    const config = configRow(db, taskId); assertVersion(config, input.version)
    const workflow = getTaskWorkflow(db, actor, taskId)
    assertCondition(workflow.participants.length > 0, 409, 'WORKFLOW_ROSTER_EMPTY', '请先添加参与名单')
    assertCondition(workflow.participants.every(p => terminal.has(p.status)), 409, 'WORKFLOW_UNRESOLVED_PARTICIPANTS', '请逐人处理待审、未完成和退出结果后结项')
    assertCondition(workflow.participants.every(p => p.status !== 'completed' || ((p.confirmedRevisionId || p.commonRevisionId) && p.confirmedMinutes !== null)), 409, 'WORKFLOW_CONFIRMATION_INCOMPLETE', '通过成员须确认材料版本与实际分钟数')
    const previous = db.get('SELECT id,version FROM workflow_snapshots WHERE task_id=? ORDER BY version DESC LIMIT 1', taskId)
    const counts: Record<string, number> = {}; workflow.participants.forEach(p => { counts[p.status] = (counts[p.status] ?? 0) + 1 })
    const timestamp = nowIso()
    const snapshot: WorkflowSnapshot = { id: createId('snapshot'), taskId, version: Number(previous?.version ?? 0) + 1, supersedesId: nullable(previous?.id), reason: input.reason.trim(), createdAt: timestamp, createdBy: actor.id, task: { title: text(task.title), ownerId: text(task.teacher_id), originalOwnerId: text(config.original_owner_id), startAt: text(task.start_at), endAt: text(task.end_at) }, config: { ...workflow.config, status: 'closed' }, template: templateFor(db, taskId) as unknown as Record<string, unknown>, participants: workflow.participants, commonRevisions: workflow.commonRevisions, totals: { participants: workflow.participants.length, completed: counts.completed ?? 0, confirmedMinutes: workflow.participants.reduce((sum, p) => sum + (p.status === 'completed' ? p.confirmedMinutes ?? 0 : 0), 0), byStatus: counts } }
    db.run('INSERT INTO workflow_snapshots(id,task_id,version,supersedes_id,reason,snapshot_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)', snapshot.id, taskId, snapshot.version, snapshot.supersedesId, snapshot.reason, JSON.stringify(snapshot), actor.id, timestamp)
    db.run("UPDATE workflow_tasks SET status='closed' WHERE task_id=?", taskId)
    db.run("UPDATE tasks SET status=CASE WHEN status='cancelled' THEN 'cancelled' ELSE 'completed' END WHERE id=?", taskId)
    bump(db, taskId)
    audit(db, actor, taskId, 'workflow.closed', { snapshotId: snapshot.id, version: snapshot.version, totals: snapshot.totals })
    return snapshot
  })
}
export function reopenWorkflow(db: AppDatabase, actor: CampusUser, taskId: string, input: { version: number; reason: string }) {
  db.transaction(() => {
    assertWorkflowManager(db, actor, taskId); requiredReason(input.reason)
    const config = configRow(db, taskId); assertVersion(config, input.version)
    assertCondition(config.status === 'closed', 409, 'WORKFLOW_NOT_CLOSED', '该任务尚未结项')
    db.run("UPDATE workflow_tasks SET status='open' WHERE task_id=?", taskId); bump(db, taskId)
    audit(db, actor, taskId, 'workflow.reopened', { reason: input.reason.trim() })
  })
  return getTaskWorkflow(db, actor, taskId)
}
export function getWorkflowSnapshot(db: AppDatabase, actor: CampusUser, taskId: string, snapshotId: string): WorkflowSnapshot {
  assertWorkflowManager(db, actor, taskId)
  const row = db.get('SELECT snapshot_json FROM workflow_snapshots WHERE task_id=? AND id=?', taskId, snapshotId)
  assertCondition(row, 404, 'WORKFLOW_SNAPSHOT_NOT_FOUND', '结项快照不存在')
  return JSON.parse(text(row.snapshot_json)) as WorkflowSnapshot
}
export function handoverWorkflow(db: AppDatabase, actor: CampusUser, taskId: string, input: { ownerId: string; version: number; reason: string }) {
  db.transaction(() => {
    assertCondition(actor.role === 'admin', 403, 'TASK_FORBIDDEN', '只有管理员可以转交负责人'); requiredReason(input.reason)
    const task = taskRow(db, taskId); assertVersion(task, input.version)
    const owner = getUserById(db, input.ownerId)
    assertCondition(owner && owner.role === 'teacher' && owner.approval === 'approved', 400, 'WORKFLOW_OWNER_INVALID', '新负责人须为已启用教师')
    assertCondition(task.teacher_id !== input.ownerId, 409, 'WORKFLOW_OWNER_UNCHANGED', '该教师已是当前负责人')
    db.run('UPDATE tasks SET teacher_id=? WHERE id=?', input.ownerId, taskId); bump(db, taskId)
    audit(db, actor, taskId, 'workflow.handover', { previousOwnerId: task.teacher_id, ownerId: input.ownerId, reason: input.reason.trim() })
    createEventNotice(db, input.ownerId, 'task.handover', { taskTitle: text(task.title) }, { kind: 'task', id: taskId })
  })
  return getTaskWorkflow(db, actor, taskId)
}
