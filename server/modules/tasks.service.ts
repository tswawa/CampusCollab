import type {
  AudienceScope,
  CampusTask,
  CampusUser,
  ClaimMode,
  ContactItem,
  CreateTaskPayload,
  MemberStatus,
  PageData,
  ProofType,
  TaskStatus,
  UnifiedTaskStatus
} from '../../shared/contracts.js'
import type { AppDatabase, SqlRow, SqlValue } from '../db/database.js'
import { createId, nowIso } from '../db/database.js'
import {
  getSchool,
  getTaskRow,
  getUserById,
  isTaskVisibleTo,
  localDateTimeToInstant,
  mapTask,
  schoolLocalToInstant
} from '../db/models.js'
import { AppError, assertCondition } from '../errors.js'
import { createEventNotice } from '../i18n/notices.js'
import { assertWorkflowOpen, initializeWorkflow, reviewWorkflowRevision, setParticipantOutcome, submitWorkflowRevision } from './workflow.service.js'

const TASK_STATUSES = new Set<TaskStatus>([
  'recruiting', 'upcoming', 'in_progress', 'review', 'changes_requested', 'completed', 'cancelled', 'full'
])
const MEMBER_STATUSES = new Set<MemberStatus>([
  'applied', 'recruiting', 'upcoming', 'in_progress', 'review', 'changes_requested', 'completed', 'cancelled'
])
const PROOF_TYPES = new Set<ProofType>(['text', 'image', 'onsite'])
const CONTACT_TYPES = new Set<ContactItem['type']>(['wechat', 'phone', 'email', 'qq', 'office', 'chat', 'custom'])
const AUDIENCE_SCOPES = new Set<AudienceScope>(['school', 'department', 'class', 'grade'])
const CLAIM_MODES = new Set<ClaimMode>(['direct', 'application'])
const TASK_MUTABLE_FIELDS = new Set<keyof CreateTaskPayload>([
  'title', 'categoryId', 'campusId', 'description', 'checklist', 'date', 'startTime', 'endTime',
  'signupDeadline', 'place', 'duration', 'capacity', 'audienceScope', 'audienceId', 'requirements',
  'proofTypes', 'claimMode', 'contacts'
])

const text = (value: unknown) => String(value ?? '')
const number = (value: unknown) => Number(value)
const jsonArray = <T = string>(value: unknown): T[] => {
  try {
    const parsed = JSON.parse(text(value) || '[]')
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

export interface TaskFilters {
  keyword?: string
  status?: TaskStatus | MemberStatus
  categoryId?: string
  campusId?: string
  audienceScope?: AudienceScope
  dateFrom?: string
  dateTo?: string
  mine: boolean
  available: boolean
  sort: 'time' | 'quota'
  page: number
  pageSize: number
}

export interface TaskPatch extends Partial<CreateTaskPayload> {
  version: number
}

interface NormalizedTaskPayload extends CreateTaskPayload {
  audienceId?: string
}

interface ValidatedTaskPayload {
  payload: NormalizedTaskPayload
  startAt: string
  endAt: string
  signupDeadlineAt: string
}

interface ValidationOptions {
  existing?: SqlRow
  requireFuture: boolean
}

function assertString(value: string, minimum: number, maximum: number, code: string, message: string) {
  const length = value.trim().length
  assertCondition(length >= minimum && length <= maximum, 400, code, message)
}

function normalizeStringList(values: string[], maximumItems: number, maximumLength: number, label: string): string[] {
  assertCondition(Array.isArray(values) && values.length <= maximumItems, 400, 'TASK_LIST_INVALID', `${label}数量过多`)
  const normalized = values.map((item) => text(item).trim()).filter(Boolean)
  assertCondition(normalized.every((item) => item.length <= maximumLength), 400, 'TASK_LIST_INVALID', `${label}单项内容过长`)
  return normalized
}

function parseTaskTimes(db: AppDatabase, payload: CreateTaskPayload) {
  assertCondition(/^\d{4}-\d{2}-\d{2}$/.test(payload.date), 400, 'TASK_DATE_INVALID', '任务日期格式不正确')
  assertCondition(/^\d{2}:\d{2}$/.test(payload.startTime), 400, 'TASK_TIME_INVALID', '开始时间格式不正确')
  assertCondition(/^\d{2}:\d{2}$/.test(payload.endTime), 400, 'TASK_TIME_INVALID', '结束时间格式不正确')
  assertCondition(
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(payload.signupDeadline),
    400, 'TASK_DEADLINE_INVALID', '报名截止时间格式不正确'
  )
  try {
    const timezone = getSchool(db).timezone
    return {
      startAt: schoolLocalToInstant(payload.date, payload.startTime, timezone),
      endAt: schoolLocalToInstant(payload.date, payload.endTime, timezone),
      signupDeadlineAt: localDateTimeToInstant(payload.signupDeadline, timezone)
    }
  } catch {
    throw new AppError(400, 'TASK_TIME_INVALID', '任务日期或时间无效')
  }
}

function sameExistingReference(existing: SqlRow | undefined, field: 'category_id' | 'campus_id', id: string): boolean {
  return Boolean(existing && text(existing[field]) === id)
}

function validateCatalogReferences(
  db: AppDatabase,
  payload: CreateTaskPayload,
  existing?: SqlRow
) {
  const category = db.get('SELECT id, enabled FROM task_categories WHERE id = ?', payload.categoryId)
  assertCondition(
    category && (number(category.enabled) === 1 || sameExistingReference(existing, 'category_id', payload.categoryId)),
    400, 'TASK_CATEGORY_INVALID', '请选择启用的任务分类'
  )
  const campus = db.get('SELECT id, enabled FROM campuses WHERE id = ?', payload.campusId)
  assertCondition(
    campus && (number(campus.enabled) === 1 || sameExistingReference(existing, 'campus_id', payload.campusId)),
    400, 'TASK_CAMPUS_INVALID', '请选择启用的校区'
  )

  assertCondition(AUDIENCE_SCOPES.has(payload.audienceScope), 400, 'TASK_AUDIENCE_INVALID', '任务受众范围无效')
  if (payload.audienceScope === 'school') {
    assertCondition(!payload.audienceId, 400, 'TASK_AUDIENCE_INVALID', '全校任务不能指定额外受众 ID')
    return
  }
  assertCondition(payload.audienceId, 400, 'TASK_AUDIENCE_INVALID', '请选择具体受众范围')
  const unchanged = Boolean(
    existing && text(existing.audience_scope) === payload.audienceScope && text(existing.audience_id) === payload.audienceId
  )
  if (payload.audienceScope === 'department') {
    const row = db.get('SELECT enabled FROM departments WHERE id = ?', payload.audienceId!)
    assertCondition(row && (number(row.enabled) === 1 || unchanged), 400, 'TASK_AUDIENCE_INVALID', '请选择启用的学院或部门')
  } else if (payload.audienceScope === 'grade') {
    const row = db.get('SELECT enabled FROM grades WHERE id = ?', payload.audienceId!)
    assertCondition(row && (number(row.enabled) === 1 || unchanged), 400, 'TASK_AUDIENCE_INVALID', '请选择启用的年级')
  } else {
    const row = db.get(`SELECT c.enabled, d.enabled department_enabled, g.enabled grade_enabled
      FROM classes c JOIN departments d ON d.id = c.department_id JOIN grades g ON g.id = c.grade_id
      WHERE c.id = ?`, payload.audienceId!)
    assertCondition(
      row && ((number(row.enabled) === 1 && number(row.department_enabled) === 1 && number(row.grade_enabled) === 1) || unchanged),
      400, 'TASK_AUDIENCE_INVALID', '请选择所属关系有效且已启用的班级'
    )
  }
}

function validateAndNormalizeTask(
  db: AppDatabase,
  source: CreateTaskPayload,
  options: ValidationOptions
): ValidatedTaskPayload {
  const payload: NormalizedTaskPayload = {
    title: text(source.title).trim(),
    categoryId: text(source.categoryId).trim(),
    campusId: text(source.campusId).trim(),
    description: text(source.description).trim(),
    checklist: normalizeStringList(source.checklist, 30, 200, '工作清单'),
    date: text(source.date).trim(),
    startTime: text(source.startTime).trim(),
    endTime: text(source.endTime).trim(),
    signupDeadline: text(source.signupDeadline).trim(),
    place: text(source.place).trim(),
    duration: text(source.duration).trim(),
    capacity: number(source.capacity),
    audienceScope: source.audienceScope,
    audienceId: source.audienceScope === 'school' ? undefined : text(source.audienceId).trim(),
    requirements: normalizeStringList(source.requirements, 30, 120, '参与要求'),
    proofTypes: Array.from(new Set(source.proofTypes)),
    claimMode: source.claimMode,
    contacts: source.contacts.map((contact) => ({
      type: contact.type,
      label: text(contact.label).trim(),
      value: text(contact.value).trim()
    }))
  }

  assertString(payload.title, 2, 80, 'TASK_TITLE_INVALID', '任务名称须为 2—80 个字符')
  assertString(payload.description, 6, 2000, 'TASK_DESCRIPTION_INVALID', '任务说明须为 6—2000 个字符')
  assertString(payload.place, 1, 200, 'TASK_PLACE_INVALID', '请填写具体任务地点')
  assertString(payload.duration, 1, 80, 'TASK_DURATION_INVALID', '请填写预计耗时')
  assertCondition(Number.isInteger(payload.capacity) && payload.capacity > 0, 400, 'TASK_CAPACITY_INVALID', '招募人数须为正整数')
  assertCondition(payload.capacity <= 10000, 400, 'TASK_CAPACITY_INVALID', '招募人数超出允许范围')
  assertCondition(CLAIM_MODES.has(payload.claimMode), 400, 'TASK_CLAIM_MODE_INVALID', '接单模式无效')
  assertCondition(payload.proofTypes.length > 0 && payload.proofTypes.every((item) => PROOF_TYPES.has(item)), 400, 'TASK_PROOF_TYPES_INVALID', '请至少选择一种有效凭证要求')
  assertCondition(payload.contacts.length <= 20, 400, 'TASK_CONTACTS_INVALID', '联系方式数量过多')
  payload.contacts.forEach((contact) => {
    assertCondition(CONTACT_TYPES.has(contact.type), 400, 'TASK_CONTACTS_INVALID', '联系方式类型无效')
    assertString(contact.label, 1, 40, 'TASK_CONTACTS_INVALID', '联系方式标签须为 1—40 个字符')
    assertString(contact.value, 1, 200, 'TASK_CONTACTS_INVALID', '联系方式内容须为 1—200 个字符')
  })
  validateCatalogReferences(db, payload, options.existing)

  const times = parseTaskTimes(db, payload)
  const start = Date.parse(times.startAt)
  const end = Date.parse(times.endAt)
  const deadline = Date.parse(times.signupDeadlineAt)
  assertCondition(end > start, 400, 'TASK_TIME_ORDER_INVALID', '任务结束时间必须晚于开始时间')
  assertCondition(deadline <= start, 400, 'TASK_DEADLINE_INVALID', '报名截止时间不能晚于任务开始时间')
  if (options.requireFuture) {
    assertCondition(start > Date.now(), 400, 'TASK_START_PAST', '任务开始时间必须晚于当前时间')
    assertCondition(deadline > Date.now(), 400, 'TASK_DEADLINE_PAST', '报名截止时间必须晚于当前时间')
  }
  return { payload, ...times }
}

function taskRowsSql(where: string) {
  return `SELECT t.*, tc.name category_name, ca.name campus_name, u.name teacher_name, d.name department_name
    FROM tasks t JOIN task_categories tc ON tc.id = t.category_id JOIN campuses ca ON ca.id = t.campus_id
    JOIN users u ON u.id = t.teacher_id LEFT JOIN departments d ON d.id = u.department_id
    ${where ? `WHERE ${where}` : ''}`
}

function activeAcceptedCount(db: AppDatabase, taskId: string): number {
  return number(db.get(`SELECT COUNT(*) count FROM workflow_participants
    WHERE task_id = ? AND status NOT IN ('applied', 'withdrawn', 'rejected', 'incomplete', 'cancelled')`, taskId)?.count ?? 0)
}

function cancelledAcceptedCount(db: AppDatabase, taskId: string): number {
  return number(db.get(`SELECT COUNT(*) count FROM workflow_participants
    WHERE task_id = ? AND status = 'cancelled'
    AND status_before_cancel IN ('upcoming','in_progress','review','changes_requested','completed')`, taskId)?.count ?? 0)
}

export function calculateTaskStatus(db: AppDatabase, taskId: string, keepCancelled = true): UnifiedTaskStatus {
  const task = db.get('SELECT status, capacity, signup_deadline_at FROM tasks WHERE id = ?', taskId)
  assertCondition(task, 404, 'TASK_NOT_FOUND', '任务不存在')
  if (keepCancelled && text(task.status) === 'cancelled') return 'cancelled'
  if (db.get('SELECT status FROM workflow_tasks WHERE task_id=?', taskId)?.status === 'closed') return 'completed'
  const rows = db.all("SELECT status FROM workflow_participants WHERE task_id = ? AND status NOT IN ('withdrawn','rejected','incomplete')", taskId)
  const statuses = rows.map((row) => text(row.status) as MemberStatus)
  if (statuses.includes('review')) return 'review'
  if (statuses.includes('in_progress') || statuses.includes('changes_requested')) return 'in_progress'
  const accepted = statuses.filter((status) => status !== 'applied' && status !== 'cancelled')
  const recruitmentClosed = accepted.length >= number(task.capacity) || Date.parse(text(task.signup_deadline_at)) <= Date.now()
  if (accepted.length > 0 && recruitmentClosed && accepted.every((status) => status === 'completed')) return 'completed'
  return 'recruiting'
}

function taskCatalogsEnabled(db: AppDatabase, row: SqlRow): boolean {
  const category = db.get('SELECT enabled FROM task_categories WHERE id = ?', text(row.category_id))
  const campus = db.get('SELECT enabled FROM campuses WHERE id = ?', text(row.campus_id))
  if (!category || number(category.enabled) !== 1 || !campus || number(campus.enabled) !== 1) return false
  const scope = text(row.audience_scope)
  if (scope === 'school') return true
  if (scope === 'department') return number(db.get('SELECT enabled FROM departments WHERE id = ?', text(row.audience_id))?.enabled) === 1
  if (scope === 'grade') return number(db.get('SELECT enabled FROM grades WHERE id = ?', text(row.audience_id))?.enabled) === 1
  if (scope === 'class') {
    const item = db.get(`SELECT c.enabled, d.enabled department_enabled, g.enabled grade_enabled
      FROM classes c JOIN departments d ON d.id = c.department_id JOIN grades g ON g.id = c.grade_id WHERE c.id = ?`, text(row.audience_id))
    return Boolean(item && number(item.enabled) === 1 && number(item.department_enabled) === 1 && number(item.grade_enabled) === 1)
  }
  return false
}

function taskAvailability(db: AppDatabase, row: SqlRow, viewer?: CampusUser): boolean {
  if (text(row.status) === 'cancelled') return false
  if (db.get('SELECT status FROM workflow_tasks WHERE task_id=?', text(row.id))?.status === 'closed') return false
  if (Date.parse(text(row.signup_deadline_at)) <= Date.now()) return false
  if (!taskCatalogsEnabled(db, row)) return false
  if (activeAcceptedCount(db, text(row.id)) >= number(row.capacity)) return false
  if (viewer?.role === 'student') {
    if (!isTaskVisibleTo(row, viewer)) return false
    if (db.get('SELECT 1 marker FROM task_members WHERE task_id = ? AND user_id = ?', text(row.id), viewer.id)) return false
  }
  return true
}

export function mapTaskForViewer(db: AppDatabase, row: SqlRow, viewer: CampusUser): CampusTask {
  const mapped = mapTask(db, row, viewer)
  mapped.occupiedCount = activeAcceptedCount(db, mapped.id)
  mapped.remainingSeats = Math.max(0, mapped.capacity - mapped.occupiedCount)
  const aggregate = calculateTaskStatus(db, text(row.id))
  if (aggregate === 'cancelled') {
    const occupiedCount = cancelledAcceptedCount(db, mapped.id)
    mapped.occupiedCount = occupiedCount
    mapped.remainingSeats = Math.max(0, mapped.capacity - occupiedCount)
    mapped.status = 'cancelled'
  } else {
    mapped.status = aggregate === 'recruiting' && mapped.remainingSeats === 0 ? 'full' : aggregate
  }
  mapped.canClaim = viewer.role === 'student' && taskAvailability(db, row, viewer)
  return mapped
}

function parseDateBoundary(db: AppDatabase, date: string, endOfDay: boolean): string {
  assertCondition(/^\d{4}-\d{2}-\d{2}$/.test(date), 400, 'TASK_DATE_FILTER_INVALID', '日期筛选格式不正确')
  try {
    return localDateTimeToInstant(`${date} ${endOfDay ? '23:59:59' : '00:00:00'}`, getSchool(db).timezone)
  } catch {
    throw new AppError(400, 'TASK_DATE_FILTER_INVALID', '日期筛选值无效')
  }
}

function displayStatus(db: AppDatabase, row: SqlRow): TaskStatus {
  const aggregate = calculateTaskStatus(db, text(row.id))
  return aggregate === 'recruiting' && activeAcceptedCount(db, text(row.id)) >= number(row.capacity) ? 'full' : aggregate
}

export function listTasks(db: AppDatabase, viewer: CampusUser, filters: TaskFilters): PageData<CampusTask> {
  const conditions: string[] = []
  const params: SqlValue[] = []
  if (viewer.role === 'teacher') {
    conditions.push('t.teacher_id = ?')
    params.push(viewer.id)
  } else if (viewer.role === 'student') {
    conditions.push(`(EXISTS (SELECT 1 FROM task_members visible_member WHERE visible_member.task_id = t.id AND visible_member.user_id = ?)
      OR t.audience_scope = 'school'
      OR (t.audience_scope = 'department' AND t.audience_id = ?)
      OR (t.audience_scope = 'class' AND t.audience_id = ?)
      OR (t.audience_scope = 'grade' AND t.audience_id = ?))`)
    params.push(viewer.id, viewer.departmentId ?? '', viewer.classId ?? '', viewer.gradeId ?? '')
    if (filters.mine) {
      conditions.push('EXISTS (SELECT 1 FROM task_members mine_member WHERE mine_member.task_id = t.id AND mine_member.user_id = ?)')
      params.push(viewer.id)
    }
  }
  if (filters.keyword) {
    const escaped = filters.keyword.trim().replace(/[\\%_]/g, (value) => `\\${value}`)
    const value = `%${escaped}%`
    conditions.push(`(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\' OR t.location LIKE ? ESCAPE '\\'
      OR u.name LIKE ? ESCAPE '\\' OR d.name LIKE ? ESCAPE '\\' OR tc.name LIKE ? ESCAPE '\\' OR ca.name LIKE ? ESCAPE '\\')`)
    params.push(value, value, value, value, value, value, value)
  }
  if (filters.categoryId) { conditions.push('t.category_id = ?'); params.push(filters.categoryId) }
  if (filters.campusId) { conditions.push('t.campus_id = ?'); params.push(filters.campusId) }
  if (filters.audienceScope) { conditions.push('t.audience_scope = ?'); params.push(filters.audienceScope) }
  if (filters.dateFrom) { conditions.push('t.start_at >= ?'); params.push(parseDateBoundary(db, filters.dateFrom, false)) }
  if (filters.dateTo) { conditions.push('t.start_at <= ?'); params.push(parseDateBoundary(db, filters.dateTo, true)) }

  let rows = db.all(taskRowsSql(conditions.join(' AND ')), ...params)
  rows = rows.filter((row) => {
    if (filters.status) {
      if (!TASK_STATUSES.has(filters.status as TaskStatus) && !MEMBER_STATUSES.has(filters.status as MemberStatus)) return false
      if (viewer.role === 'student' && filters.mine) {
        const member = db.get('SELECT status FROM task_members WHERE task_id = ? AND user_id = ?', text(row.id), viewer.id)
        if (!member || text(member.status) !== filters.status) return false
      } else if (displayStatus(db, row) !== filters.status) return false
    }
    if (filters.available && !taskAvailability(db, row, viewer)) return false
    return true
  })

  rows.sort((left, right) => {
    if (filters.sort === 'quota') {
      const leftRemaining = number(left.capacity) - activeAcceptedCount(db, text(left.id))
      const rightRemaining = number(right.capacity) - activeAcceptedCount(db, text(right.id))
      if (leftRemaining !== rightRemaining) return rightRemaining - leftRemaining
    }
    const byTime = Date.parse(text(left.start_at)) - Date.parse(text(right.start_at))
    return byTime || text(left.id).localeCompare(text(right.id))
  })
  const total = rows.length
  const offset = (filters.page - 1) * filters.pageSize
  const items = rows.slice(offset, offset + filters.pageSize).map((row) => mapTaskForViewer(db, row, viewer))
  return { items, total, page: filters.page, pageSize: filters.pageSize }
}

function canReadTask(db: AppDatabase, row: SqlRow, viewer: CampusUser): boolean {
  if (viewer.role === 'admin') return true
  if (viewer.role === 'teacher') return text(row.teacher_id) === viewer.id
  return isTaskVisibleTo(row, viewer) || Boolean(db.get(
    'SELECT 1 marker FROM task_members WHERE task_id = ? AND user_id = ?', text(row.id), viewer.id
  ))
}

export function getTaskForViewer(db: AppDatabase, id: string, viewer: CampusUser): CampusTask {
  const row = getTaskRow(db, id)
  assertCondition(row, 404, 'TASK_NOT_FOUND', '任务不存在')
  assertCondition(canReadTask(db, row, viewer), 403, 'TASK_FORBIDDEN', '没有权限查看该任务')
  return mapTaskForViewer(db, row, viewer)
}

function insertContacts(db: AppDatabase, taskId: string, contacts: ContactItem[]) {
  contacts.forEach((contact, index) => db.run(`INSERT INTO task_contacts(id, task_id, type, label, value, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)`, createId('contact'), taskId, contact.type, contact.label, contact.value, index))
}

function createNotice(
  db: AppDatabase,
  userId: string,
  eventType: string,
  params: Record<string, string>,
  taskId: string,
  type: 'task' | 'review' | 'system' = 'task',
  timestamp = nowIso()
) {
  createEventNotice(db, userId, eventType, params, { kind: 'task', id: taskId }, type, timestamp)
}

function assertOwnerOrAdmin(row: SqlRow, actor: CampusUser) {
  assertCondition(actor.role === 'admin' || (actor.role === 'teacher' && text(row.teacher_id) === actor.id), 403, 'TASK_FORBIDDEN', '只能操作本人发布的任务')
}

function assertTeacherOwner(row: SqlRow, actor: CampusUser) {
  assertCondition(actor.role === 'teacher' && text(row.teacher_id) === actor.id, 403, 'TASK_FORBIDDEN', '只能由发布教师操作该任务')
}

function refreshTaskRow(db: AppDatabase, id: string): SqlRow {
  const row = getTaskRow(db, id)
  assertCondition(row, 404, 'TASK_NOT_FOUND', '任务不存在')
  return row
}

function bumpTaskAfterMemberChange(db: AppDatabase, taskId: string, expectedVersion?: number) {
  const task = db.get('SELECT id, status, version FROM tasks WHERE id = ?', taskId)
  assertCondition(task, 404, 'TASK_NOT_FOUND', '任务不存在')
  assertCondition(text(task.status) !== 'cancelled', 409, 'TASK_CANCELLED', '任务已撤销，不能继续操作')
  if (expectedVersion !== undefined) {
    assertCondition(number(task.version) === expectedVersion, 409, 'STALE_VERSION', '任务已变化，请刷新后重试')
  }
  const aggregate = calculateTaskStatus(db, taskId, false)
  const result = db.run(`UPDATE tasks SET status = ?, version = version + 1, updated_at = ?
    WHERE id = ? AND version = ?`, aggregate, nowIso(), taskId, number(task.version))
  assertCondition(number(result.changes) === 1, 409, 'STALE_VERSION', '任务已变化，请刷新后重试')
}

function basePayloadForTask(db: AppDatabase, row: SqlRow, actor: CampusUser): CreateTaskPayload {
  const mapped = mapTask(db, row, actor)
  return {
    title: mapped.title,
    categoryId: mapped.categoryId,
    campusId: mapped.campusId,
    description: mapped.description,
    checklist: mapped.checklist,
    date: mapped.date,
    startTime: mapped.startTime,
    endTime: mapped.endTime,
    signupDeadline: mapped.signupDeadline,
    place: text(row.location),
    duration: mapped.duration,
    capacity: mapped.capacity,
    audienceScope: mapped.audienceScope,
    audienceId: mapped.audienceId,
    requirements: mapped.requirements,
    proofTypes: mapped.proofTypes,
    claimMode: mapped.claimMode,
    contacts: db.all('SELECT id, type, label, value FROM task_contacts WHERE task_id = ? ORDER BY sort_order', text(row.id)).map((contact) => ({
      id: text(contact.id), type: text(contact.type) as ContactItem['type'], label: text(contact.label), value: text(contact.value)
    }))
  }
}

export function createTask(db: AppDatabase, teacher: CampusUser, source: CreateTaskPayload): CampusTask {
  assertCondition(teacher.role === 'teacher', 403, 'TASK_FORBIDDEN', '只有教师可以发布任务')
  const validated = validateAndNormalizeTask(db, source, { requireFuture: true })
  const id = createId('task')
  const timestamp = nowIso()
  db.transaction(() => {
    const payload = validated.payload
    db.run(`INSERT INTO tasks(
      id, title, category_id, campus_id, location, description, checklist_json, start_at, end_at,
      signup_deadline_at, duration, capacity, audience_scope, audience_id, requirements_json,
      proof_types_json, claim_mode, teacher_id, status, status_before_cancel, featured, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recruiting', NULL, 0, 1, ?, ?)`,
    id, payload.title, payload.categoryId, payload.campusId, payload.place, payload.description,
    JSON.stringify(payload.checklist), validated.startAt, validated.endAt, validated.signupDeadlineAt,
    payload.duration, payload.capacity, payload.audienceScope, payload.audienceId ?? null,
    JSON.stringify(payload.requirements), JSON.stringify(payload.proofTypes), payload.claimMode, teacher.id,
    timestamp, timestamp)
    insertContacts(db, id, payload.contacts)
    initializeWorkflow(db, id, source.workflow)
  })
  return mapTaskForViewer(db, refreshTaskRow(db, id), teacher)
}

export function copyTask(db: AppDatabase, actor: CampusUser, sourceId: string, payload: CreateTaskPayload): CampusTask {
  const source = refreshTaskRow(db, sourceId)
  assertOwnerOrAdmin(source, actor)
  const original = db.get('SELECT * FROM workflow_tasks WHERE task_id=?', sourceId)!
  const copied = createTask(db, actor, { ...payload, workflow: payload.workflow ?? {
    templateId: text(original.template_id), templateVersion: number(original.template_version), mode: text(original.mode) as 'individual' | 'group',
    plannedMinutes: original.planned_minutes as number | null, submissionDeadline: null, personalSubmissionRequired: number(original.personal_submission_required) === 1
  } })
  db.run('INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?)', actor.id, 'workflow.copied', 'task', copied.id, JSON.stringify({ sourceId }), nowIso())
  return copied
}

export function updateTask(db: AppDatabase, actor: CampusUser, id: string, patch: TaskPatch): CampusTask {
  assertWorkflowOpen(db, id)
  const row = getTaskRow(db, id)
  assertCondition(row, 404, 'TASK_NOT_FOUND', '任务不存在')
  assertOwnerOrAdmin(row, actor)
  assertCondition(number(row.version) === patch.version, 409, 'STALE_VERSION', '任务已被修改，请刷新后重试')
  const keys = Object.keys(patch).filter((key) => key !== 'version') as Array<keyof CreateTaskPayload>
  assertCondition(keys.length > 0, 400, 'TASK_UPDATE_EMPTY', '请至少修改一个任务字段')
  assertCondition(keys.every((key) => TASK_MUTABLE_FIELDS.has(key)), 400, 'TASK_FIELD_FORBIDDEN', '包含不可修改的任务字段')
  if (patch.proofTypes !== undefined) assertCondition(!db.get('SELECT id FROM workflow_revisions WHERE task_id=? LIMIT 1', id), 409, 'WORKFLOW_REQUIREMENTS_FROZEN', '已有材料提交，材料规则已固定')

  const base = basePayloadForTask(db, row, actor)
  const merged = { ...base, ...patch } as CreateTaskPayload
  if (patch.audienceScope === 'school' && !Object.prototype.hasOwnProperty.call(patch, 'audienceId')) merged.audienceId = undefined
  const timeFields = ['date', 'startTime', 'endTime', 'signupDeadline'] as const
  const timeChanged = timeFields.some((key) => patch[key] !== undefined && patch[key]!.replace('T', ' ') !== base[key].replace('T', ' '))
  const validated = validateAndNormalizeTask(db, merged, { existing: row, requireFuture: timeChanged })
  const occupied = text(row.status) === 'cancelled' ? cancelledAcceptedCount(db, id) : activeAcceptedCount(db, id)
  assertCondition(validated.payload.capacity >= occupied, 409, 'TASK_CAPACITY_OCCUPIED', `当前已有 ${occupied} 名录取成员，不能将名额调低至该人数以下`)

  db.transaction(() => {
    const payload = validated.payload
    const result = db.run(`UPDATE tasks SET title = ?, category_id = ?, campus_id = ?, location = ?, description = ?,
      checklist_json = ?, start_at = ?, end_at = ?, signup_deadline_at = ?, duration = ?, capacity = ?,
      audience_scope = ?, audience_id = ?, requirements_json = ?, proof_types_json = ?, claim_mode = ?,
      version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
    payload.title, payload.categoryId, payload.campusId, payload.place, payload.description,
    JSON.stringify(payload.checklist), validated.startAt, validated.endAt, validated.signupDeadlineAt,
    payload.duration, payload.capacity, payload.audienceScope, payload.audienceId ?? null,
    JSON.stringify(payload.requirements), JSON.stringify(payload.proofTypes), payload.claimMode,
    nowIso(), id, patch.version)
    assertCondition(number(result.changes) === 1, 409, 'STALE_VERSION', '任务已被修改，请刷新后重试')
    if (Object.prototype.hasOwnProperty.call(patch, 'contacts')) {
      db.run('DELETE FROM task_contacts WHERE task_id = ?', id)
      insertContacts(db, id, payload.contacts)
    }
    if (keys.some(key => ['date','startTime','endTime','signupDeadline','place','title'].includes(key))) {
      for (const member of db.all('SELECT user_id FROM workflow_participants WHERE task_id=? AND user_id IS NOT NULL', id)) {
        createEventNotice(db, text(member.user_id), 'task.updated', { taskTitle: payload.title }, { kind: 'task', id }, 'task')
      }
    }
  })
  return mapTaskForViewer(db, refreshTaskRow(db, id), actor)
}

function assertNativeIdentityAvailable(db: AppDatabase, taskId: string, userId: string) {
  const externalId = db.get('SELECT external_id FROM users WHERE id=?', userId)?.external_id
  assertCondition(!externalId || !db.get("SELECT id FROM workflow_participants WHERE task_id=? AND source='account' AND external_id=?", taskId, text(externalId)),
    409, 'WORKFLOW_BIND_CONFLICT', '该账号已有参与记录，请人工核对')
}

export function claimTask(db: AppDatabase, student: CampusUser, id: string): CampusTask {
  assertWorkflowOpen(db, id)
  assertCondition(student.role === 'student', 403, 'TASK_FORBIDDEN', '只有学生可以接取任务')
  return db.transaction(() => {
    const row = refreshTaskRow(db, id)
    assertCondition(text(row.status) !== 'cancelled', 409, 'TASK_CANCELLED', '任务已撤销，不能接取')
    assertCondition(isTaskVisibleTo(row, student), 403, 'TASK_AUDIENCE_MISMATCH', '该任务不面向你当前所属范围')
    assertCondition(taskCatalogsEnabled(db, row), 409, 'TASK_CATALOG_DISABLED', '任务关联的分类、校区或受众已停用')
    assertCondition(Date.parse(text(row.signup_deadline_at)) > Date.now(), 409, 'TASK_DEADLINE_PASSED', '报名已截止')
    assertCondition(!db.get('SELECT 1 marker FROM task_members WHERE task_id = ? AND user_id = ?', id, student.id), 409, 'TASK_ALREADY_JOINED', '你已参与该任务')
    assertNativeIdentityAvailable(db, id, student.id)
    assertCondition(activeAcceptedCount(db, id) < number(row.capacity), 409, 'TASK_FULL', '任务名额已满')
    const status: MemberStatus = text(row.claim_mode) === 'application' ? 'applied' : 'upcoming'
    const timestamp = nowIso()
    db.run(`INSERT INTO task_members(task_id, user_id, status, status_before_cancel, claimed_at, started_at, feedback, version, updated_at)
      VALUES (?, ?, ?, NULL, ?, NULL, NULL, 1, ?)`, id, student.id, status, timestamp, timestamp)
    bumpTaskAfterMemberChange(db, id)
    createNotice(
      db,
      text(row.teacher_id),
      status === 'applied' ? 'task.applied' : 'task.joined',
      { actorName: student.name, taskTitle: text(row.title) }, id, 'task', timestamp
    )
    return mapTaskForViewer(db, refreshTaskRow(db, id), student)
  })
}

export function withdrawTask(db: AppDatabase, student: CampusUser, id: string): CampusTask {
  const participant = db.get('SELECT * FROM workflow_participants WHERE task_id = ? AND user_id = ?', id, student.id)
  assertCondition(student.role === 'student' && participant, 409, 'TASK_NOT_JOINED', '你尚未参与该任务')
  assertCondition(['applied', 'upcoming'].includes(text(participant.status)), 409, 'TASK_WITHDRAW_FORBIDDEN', '当前进度不能撤回')
  setParticipantOutcome(db, student, id, { participantId: text(participant.id), version: number(participant.version), status: 'withdrawn', reason: 'Participant withdrew / 参与者退出' })
  return mapTaskForViewer(db, refreshTaskRow(db, id), student)
}

export function startTask(db: AppDatabase, student: CampusUser, id: string): CampusTask {
  assertWorkflowOpen(db, id)
  assertCondition(student.role === 'student', 403, 'TASK_FORBIDDEN', '只有学生可以开始任务')
  return db.transaction(() => {
    const row = refreshTaskRow(db, id)
    assertCondition(text(row.status) !== 'cancelled', 409, 'TASK_CANCELLED', '任务已撤销，不能开始')
    const member = db.get('SELECT status, version FROM task_members WHERE task_id = ? AND user_id = ?', id, student.id)
    assertCondition(member, 409, 'TASK_NOT_JOINED', '你尚未参与该任务')
    assertCondition(text(member.status) === 'upcoming', 409, 'TASK_START_FORBIDDEN', '当前进度不能开始任务')
    const timestamp = nowIso()
    const result = db.run(`UPDATE task_members SET status = 'in_progress', started_at = ?, feedback = NULL,
      version = version + 1, updated_at = ? WHERE task_id = ? AND user_id = ? AND version = ? AND status = 'upcoming'`,
    timestamp, timestamp, id, student.id, number(member.version))
    assertCondition(number(result.changes) === 1, 409, 'STALE_VERSION', '参与状态已变化，请刷新后重试')
    bumpTaskAfterMemberChange(db, id)
    createNotice(db, text(row.teacher_id), 'task.started', { actorName: student.name, taskTitle: text(row.title) }, id)
    return mapTaskForViewer(db, refreshTaskRow(db, id), student)
  })
}

export function approveApplication(
  db: AppDatabase,
  teacher: CampusUser,
  id: string,
  userId: string,
  version: number
): CampusTask {
  assertWorkflowOpen(db, id)
  return db.transaction(() => {
    const row = refreshTaskRow(db, id)
    assertTeacherOwner(row, teacher)
    assertCondition(text(row.status) !== 'cancelled', 409, 'TASK_CANCELLED', '任务已撤销，不能审批申请')
    // An open workflow permits explicit admission corrections after signup closes.
    // Aggregate completion describes participants; it is not a closeout gate.
    const member = db.get('SELECT status, version FROM task_members WHERE task_id = ? AND user_id = ?', id, userId)
    assertCondition(member, 404, 'TASK_MEMBER_NOT_FOUND', '接单申请不存在')
    assertCondition(number(member.version) === version, 409, 'STALE_VERSION', '申请状态已变化，请刷新后重试')
    assertCondition(text(member.status) === 'applied', 409, 'TASK_APPLICATION_PROCESSED', '该申请已处理，不能重复审批')
    assertCondition(activeAcceptedCount(db, id) < number(row.capacity), 409, 'TASK_FULL', '任务名额已满')
    const timestamp = nowIso()
    const result = db.run(`UPDATE task_members SET status = 'upcoming', feedback = NULL, version = version + 1, updated_at = ?
      WHERE task_id = ? AND user_id = ? AND version = ? AND status = 'applied'`, timestamp, id, userId, version)
    assertCondition(number(result.changes) === 1, 409, 'STALE_VERSION', '申请状态已变化，请刷新后重试')
    bumpTaskAfterMemberChange(db, id)
    createNotice(db, userId, 'task.application_approved', { taskTitle: text(row.title) }, id)
    return mapTaskForViewer(db, refreshTaskRow(db, id), teacher)
  })
}

export function inviteStudent(
  db: AppDatabase,
  teacher: CampusUser,
  id: string,
  userId: string,
  version: number
): CampusTask {
  assertWorkflowOpen(db, id)
  return db.transaction(() => {
    const row = refreshTaskRow(db, id)
    assertTeacherOwner(row, teacher)
    assertCondition(number(row.version) === version, 409, 'STALE_VERSION', '任务已变化，请刷新后重试')
    assertCondition(text(row.status) !== 'cancelled', 409, 'TASK_CANCELLED', '任务已撤销，不能邀请学生')
    // Invitations are coordinator-managed roster changes, like explicit approval.
    const student = getUserById(db, userId)
    assertCondition(student && student.role === 'student' && student.approval === 'approved', 400, 'STUDENT_INVALID', '只能邀请已启用的学生账号')
    assertCondition(isTaskVisibleTo(row, student), 400, 'TASK_AUDIENCE_MISMATCH', '该学生不在任务受众范围内')
    assertCondition(!db.get('SELECT 1 marker FROM task_members WHERE task_id = ? AND user_id = ?', id, userId), 409, 'TASK_ALREADY_JOINED', '该学生已参与任务')
    assertNativeIdentityAvailable(db, id, userId)
    assertCondition(activeAcceptedCount(db, id) < number(row.capacity), 409, 'TASK_FULL', '任务名额已满')
    const timestamp = nowIso()
    db.run(`INSERT INTO task_members(task_id, user_id, status, status_before_cancel, claimed_at, started_at, feedback, version, updated_at)
      VALUES (?, ?, 'upcoming', NULL, ?, NULL, NULL, 1, ?)`, id, userId, timestamp, timestamp)
    bumpTaskAfterMemberChange(db, id, version)
    createNotice(db, userId, 'task.invited', { actorName: teacher.name, taskTitle: text(row.title) }, id)
    return mapTaskForViewer(db, refreshTaskRow(db, id), teacher)
  })
}

export function submitProof(
  db: AppDatabase, student: CampusUser, id: string,
  input: { description: string; note: string; fileIds: string[]; version: number }
): CampusTask {
  const participant = db.get('SELECT * FROM workflow_participants WHERE task_id = ? AND user_id = ?', id, student.id)
  assertCondition(student.role === 'student' && participant, 409, 'TASK_NOT_JOINED', '你尚未参与该任务')
  assertCondition(['in_progress', 'changes_requested'].includes(text(participant.status)), 409, 'PROOF_SUBMIT_FORBIDDEN', '当前进度不能提交凭证')
  submitWorkflowRevision(db, student, id, { ...input, participantId: text(participant.id) })
  return mapTaskForViewer(db, refreshTaskRow(db, id), student)
}

export function reviewProof(
  db: AppDatabase, teacher: CampusUser, id: string,
  input: { userId: string; approved: boolean; feedback: string; version: number }
): CampusTask {
  assertOwnerOrAdmin(refreshTaskRow(db, id), teacher)
  const participant = db.get('SELECT * FROM workflow_participants WHERE task_id = ? AND user_id = ?', id, input.userId)
  assertCondition(participant, 404, 'TASK_MEMBER_NOT_FOUND', '参与记录不存在')
  reviewWorkflowRevision(db, teacher, id, {
    participantId: text(participant.id), version: input.version, revisionId: text(participant.latest_revision_id),
    decision: input.approved ? 'approved' : 'changes_requested', feedback: input.feedback
  })
  return mapTaskForViewer(db, refreshTaskRow(db, id), teacher)
}

export function cancelTask(db: AppDatabase, actor: CampusUser, id: string, version: number): CampusTask {
  assertWorkflowOpen(db, id)
  return db.transaction(() => {
    const row = refreshTaskRow(db, id)
    assertOwnerOrAdmin(row, actor)
    assertCondition(number(row.version) === version, 409, 'STALE_VERSION', '任务已变化，请刷新后重试')
    assertCondition(text(row.status) !== 'cancelled', 409, 'TASK_ALREADY_CANCELLED', '任务已撤销，不能重复操作')
    const snapshotStatus = calculateTaskStatus(db, id, false)
    const timestamp = nowIso()
    const taskResult = db.run(`UPDATE tasks SET status = 'cancelled', status_before_cancel = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ? AND status <> 'cancelled'`, snapshotStatus, timestamp, id, version)
    assertCondition(number(taskResult.changes) === 1, 409, 'STALE_VERSION', '任务已变化，请刷新后重试')
    const members = db.all('SELECT user_id, status, version FROM task_members WHERE task_id = ?', id)
    members.forEach((member) => {
      if (text(member.status) === 'cancelled') return
      const result = db.run(`UPDATE task_members SET status_before_cancel = status, status = 'cancelled', version = version + 1, updated_at = ?
        WHERE task_id = ? AND user_id = ? AND version = ? AND status <> 'cancelled'`, timestamp, id, text(member.user_id), number(member.version))
      assertCondition(number(result.changes) === 1, 409, 'STALE_VERSION', '成员状态已变化，请刷新后重试')
      createNotice(db, text(member.user_id), 'task.cancelled', { taskTitle: text(row.title) }, id, 'task', timestamp)
    })
    db.run("UPDATE workflow_participants SET status_before_cancel=status,status='cancelled',version=version+1,updated_at=? WHERE task_id=? AND user_id IS NULL AND status NOT IN ('withdrawn','rejected','incomplete','cancelled')", timestamp, id)
    return mapTaskForViewer(db, refreshTaskRow(db, id), actor)
  })
}

export function restoreTask(db: AppDatabase, admin: CampusUser, id: string, version: number): CampusTask {
  assertWorkflowOpen(db, id)
  assertCondition(admin.role === 'admin', 403, 'TASK_FORBIDDEN', '只有管理员可以恢复任务')
  return db.transaction(() => {
    const row = refreshTaskRow(db, id)
    assertCondition(number(row.version) === version, 409, 'STALE_VERSION', '任务已变化，请刷新后重试')
    assertCondition(text(row.status) === 'cancelled', 409, 'TASK_NOT_CANCELLED', '任务未撤销，不能重复恢复')
    const timestamp = nowIso()
    const members = db.all('SELECT user_id, status, status_before_cancel, version FROM task_members WHERE task_id = ? AND status_before_cancel IS NOT NULL', id)
    members.forEach((member) => {
      assertCondition(text(member.status) === 'cancelled' && MEMBER_STATUSES.has(text(member.status_before_cancel) as MemberStatus), 409, 'TASK_SNAPSHOT_INVALID', '成员撤销快照不完整，无法恢复')
      const result = db.run(`UPDATE task_members SET status = status_before_cancel, status_before_cancel = NULL,
        version = version + 1, updated_at = ? WHERE task_id = ? AND user_id = ? AND version = ? AND status = 'cancelled'`,
      timestamp, id, text(member.user_id), number(member.version))
      assertCondition(number(result.changes) === 1, 409, 'STALE_VERSION', '成员状态已变化，请刷新后重试')
    })
    db.run("UPDATE workflow_participants SET status=status_before_cancel,status_before_cancel=NULL,version=version+1,updated_at=? WHERE task_id=? AND user_id IS NULL AND status='cancelled' AND status_before_cancel IS NOT NULL", timestamp, id)
    assertCondition(activeAcceptedCount(db, id) <= number(row.capacity), 409, 'TASK_CAPACITY_OCCUPIED', '恢复后的参与人数超过任务名额，请先调整名额')
    const restoredStatus = calculateTaskStatus(db, id, false)
    const taskResult = db.run(`UPDATE tasks SET status = ?, status_before_cancel = NULL, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ? AND status = 'cancelled'`, restoredStatus, timestamp, id, version)
    assertCondition(number(taskResult.changes) === 1, 409, 'STALE_VERSION', '任务已变化，请刷新后重试')
    members.forEach((member) => createNotice(db, text(member.user_id), 'task.restored', { taskTitle: text(row.title) }, id, 'task', timestamp))
    return mapTaskForViewer(db, refreshTaskRow(db, id), admin)
  })
}
