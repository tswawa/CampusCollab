import { Temporal } from '@js-temporal/polyfill'
import type {
  AppNotice, CampusTask, CampusUser, CatalogData, ContactItem, MemberStatus,
  SchoolProfile, TaskMember, TaskProof, TaskStatus, UserRole
} from '../../shared/contracts.js'
import type { AppDatabase, SqlRow } from './database.js'

const jsonArray = <T = string>(value: unknown): T[] => {
  try { return Array.isArray(JSON.parse(String(value ?? '[]'))) ? JSON.parse(String(value ?? '[]')) : [] } catch { return [] }
}
const bool = (value: unknown) => Number(value) === 1
const text = (value: unknown) => String(value ?? '')

export function normalizeAccount(account: string): string {
  return account.trim().toLowerCase()
}

export function getUserById(db: AppDatabase, id: string): CampusUser | undefined {
  const row = db.get(`SELECT u.*, d.name department_name, c.name class_name, g.name grade_name
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN classes c ON c.id = u.class_id LEFT JOIN grades g ON g.id = u.grade_id
    WHERE u.id = ?`, id)
  return row ? mapUser(row, getSchool(db).defaultLocale) : undefined
}

export function getUserByAccount(db: AppDatabase, account: string): (CampusUser & { passwordHash: string }) | undefined {
  const row = db.get(`SELECT u.*, d.name department_name, c.name class_name, g.name grade_name
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN classes c ON c.id = u.class_id LEFT JOIN grades g ON g.id = u.grade_id
    WHERE u.account_normalized = ?`, normalizeAccount(account))
  if (!row) return undefined
  return { ...mapUser(row, getSchool(db).defaultLocale), passwordHash: text(row.password_hash) }
}

export function mapUser(row: SqlRow, institutionLocale: SchoolProfile['defaultLocale']): CampusUser {
  return {
    id: text(row.id), role: text(row.role) as UserRole, account: text(row.account), name: text(row.name),
    departmentId: row.department_id ? text(row.department_id) : undefined, department: text(row.department_name),
    classId: row.class_id ? text(row.class_id) : undefined, className: row.class_name ? text(row.class_name) : undefined,
    gradeId: row.grade_id ? text(row.grade_id) : undefined, grade: row.grade_name ? text(row.grade_name) : undefined,
    approval: text(row.approval) as CampusUser['approval'], skills: jsonArray(row.skills_json), version: Number(row.version),
    locale: institutionLocale,
    email: row.email ? text(row.email) : undefined, externalId: row.external_id ? text(row.external_id) : undefined,
    isExternal: bool(row.is_external)
  }
}

export function getSchool(db: AppDatabase): SchoolProfile {
  const row = db.get('SELECT * FROM school_settings WHERE id = 1')!
  return {
    name: text(row.name), platformName: text(row.platform_name), logo: text(row.logo_url), badge: text(row.badge),
    announcement: text(row.announcement), primaryColor: text(row.primary_color), version: Number(row.version), timezone: text(row.timezone),
    defaultLocale: row.default_locale === 'en' ? 'en' : 'zh-CN', registrationEnabled: row.registration_enabled === undefined || bool(row.registration_enabled),
    requireDepartment: row.require_department === undefined || bool(row.require_department),
    requireGrade: row.require_grade === undefined || bool(row.require_grade), requireClass: row.require_class === undefined || bool(row.require_class),
    allowExternalParticipants: bool(row.allow_external_participants), retentionDays: Number(row.retention_days ?? 365)
  }
}

export function getCatalog(db: AppDatabase, includeDisabled = false): CatalogData {
  const suffix = includeDisabled ? '' : ' WHERE enabled = 1'
  const classSuffix = includeDisabled ? '' : ` WHERE c.enabled = 1
    AND EXISTS (SELECT 1 FROM departments d WHERE d.id = c.department_id AND d.enabled = 1)
    AND EXISTS (SELECT 1 FROM grades g WHERE g.id = c.grade_id AND g.enabled = 1)`
  return {
    departments: db.all(`SELECT id, name, code, enabled, version FROM departments${suffix} ORDER BY name`).map((row) => ({
      id: text(row.id), name: text(row.name), code: text(row.code), enabled: bool(row.enabled), version: Number(row.version)
    })),
    grades: db.all(`SELECT id, name, enabled, version FROM grades${suffix} ORDER BY name DESC`).map((row) => ({
      id: text(row.id), name: text(row.name), enabled: bool(row.enabled), version: Number(row.version)
    })),
    classes: db.all(`SELECT c.id, c.name, c.department_id, c.grade_id, c.enabled, c.version FROM classes c${classSuffix} ORDER BY c.name`).map((row) => ({
      id: text(row.id), name: text(row.name), departmentId: text(row.department_id), gradeId: text(row.grade_id), enabled: bool(row.enabled), version: Number(row.version)
    })),
    campuses: db.all(`SELECT id, name, enabled, version FROM campuses${suffix} ORDER BY name`).map((row) => ({
      id: text(row.id), name: text(row.name), enabled: bool(row.enabled), version: Number(row.version)
    })),
    taskCategories: db.all(`SELECT id, name, enabled, version FROM task_categories${suffix} ORDER BY name`).map((row) => ({
      id: text(row.id), name: text(row.name), enabled: bool(row.enabled), version: Number(row.version)
    }))
  }
}

export function schoolLocalToInstant(date: string, time: string, timezone: string): string {
  return Temporal.ZonedDateTime.from(`${date}T${time}:00[${timezone}]`, { disambiguation: 'reject', overflow: 'reject' }).toInstant().toString()
}

export function localDateTimeToInstant(value: string, timezone: string): string {
  const normalized = value.trim().replace(' ', 'T')
  return Temporal.ZonedDateTime.from(`${normalized.length === 16 ? normalized + ':00' : normalized}[${timezone}]`, { disambiguation: 'reject', overflow: 'reject' }).toInstant().toString()
}

function localParts(instant: string, timezone: string) {
  const local = Temporal.Instant.from(instant).toZonedDateTimeISO(timezone)
  const date = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`
  const time = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`
  return { date, time }
}

function getAudienceName(db: AppDatabase, scope: string, audienceId: string | null): string {
  if (scope === 'school') return '全校学生'
  const table = scope === 'department' ? 'departments' : scope === 'class' ? 'classes' : 'grades'
  return text(db.get(`SELECT name FROM ${table} WHERE id = ?`, audienceId ?? '')?.name)
}

export function isTaskVisibleTo(row: SqlRow, user: CampusUser): boolean {
  if (user.role === 'admin') return true
  if (user.role === 'teacher') return text(row.teacher_id) === user.id
  const scope = text(row.audience_scope)
  const value = row.audience_id ? text(row.audience_id) : undefined
  return scope === 'school' ||
    (scope === 'department' && value === user.departmentId) ||
    (scope === 'class' && value === user.classId) ||
    (scope === 'grade' && value === user.gradeId)
}

export function getTaskRow(db: AppDatabase, id: string): SqlRow | undefined {
  return db.get(`SELECT t.*, tc.name category_name, ca.name campus_name, u.name teacher_name, d.name department_name
    FROM tasks t JOIN task_categories tc ON tc.id = t.category_id JOIN campuses ca ON ca.id = t.campus_id
    JOIN users u ON u.id = t.teacher_id LEFT JOIN departments d ON d.id = u.department_id WHERE t.id = ?`, id)
}

export function getTaskRows(db: AppDatabase, where = '', params: Array<string | number> = [], order = 't.start_at ASC', limit = 100, offset = 0): SqlRow[] {
  return db.all(`SELECT t.*, tc.name category_name, ca.name campus_name, u.name teacher_name, d.name department_name
    FROM tasks t JOIN task_categories tc ON tc.id = t.category_id JOIN campuses ca ON ca.id = t.campus_id
    JOIN users u ON u.id = t.teacher_id LEFT JOIN departments d ON d.id = u.department_id
    ${where ? `WHERE ${where}` : ''} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, offset)
}

export function mapTask(db: AppDatabase, row: SqlRow, viewer: CampusUser): CampusTask {
  const timezone = getSchool(db).timezone
  const start = localParts(text(row.start_at), timezone)
  const end = localParts(text(row.end_at), timezone)
  const deadline = localParts(text(row.signup_deadline_at), timezone)
  const occupiedCount = Number(db.get(`SELECT COUNT(*) count FROM workflow_participants
    WHERE task_id = ? AND status NOT IN ('applied', 'withdrawn', 'rejected', 'incomplete', 'cancelled')`, text(row.id))?.count ?? 0)
  const viewerMember = db.get('SELECT status FROM task_members WHERE task_id = ? AND user_id = ?', text(row.id), viewer.id)
  const canSeeMembers = viewer.role === 'admin' || (viewer.role === 'teacher' && viewer.id === text(row.teacher_id))
  const memberRows = canSeeMembers
    ? db.all(`SELECT tm.*, u.account, u.name, d.name department_name, c.name class_name
      FROM task_members tm JOIN users u ON u.id = tm.user_id LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN classes c ON c.id = u.class_id WHERE tm.task_id = ? ORDER BY tm.claimed_at`, text(row.id))
    : db.all(`SELECT tm.*, u.account, u.name, d.name department_name, c.name class_name
      FROM task_members tm JOIN users u ON u.id = tm.user_id LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN classes c ON c.id = u.class_id WHERE tm.task_id = ? AND tm.user_id = ?`, text(row.id), viewer.id)
  const members = memberRows.map((member) => mapMember(db, member))
  const acceptedViewer = Number(db.get('SELECT admitted FROM workflow_participants WHERE task_id=? AND user_id=?', text(row.id), viewer.id)?.admitted) === 1
  const canSeeContacts = canSeeMembers || Boolean(acceptedViewer)
  const contacts: ContactItem[] = canSeeContacts
    ? db.all('SELECT id, type, label, value FROM task_contacts WHERE task_id = ? ORDER BY sort_order', text(row.id)).map((contact) => ({
      id: text(contact.id), type: text(contact.type) as ContactItem['type'], label: text(contact.label), value: text(contact.value)
    }))
    : []
  const remainingSeats = Math.max(0, Number(row.capacity) - occupiedCount)
  const workflowStatus = db.get('SELECT status FROM workflow_tasks WHERE task_id = ?', text(row.id))?.status === 'closed' ? 'closed' : 'open'
  const canClaim = viewer.role === 'student' && !viewerMember && isTaskVisibleTo(row, viewer) &&
    workflowStatus === 'open' && text(row.status) === 'recruiting' && remainingSeats > 0 && Date.parse(text(row.signup_deadline_at)) > Date.now()
  return {
    id: text(row.id), title: text(row.title), categoryId: text(row.category_id), category: text(row.category_name),
    campusId: text(row.campus_id), campus: text(row.campus_name), location: text(row.location),
    place: `${text(row.campus_name)} · ${text(row.location)}`, description: text(row.description),
    checklist: jsonArray(row.checklist_json), date: start.date, startTime: start.time, endTime: end.time,
    signupDeadline: `${deadline.date} ${deadline.time}`, duration: text(row.duration), capacity: Number(row.capacity),
    audienceScope: text(row.audience_scope) as CampusTask['audienceScope'], audienceId: row.audience_id ? text(row.audience_id) : undefined,
    audienceValue: getAudienceName(db, text(row.audience_scope), row.audience_id ? text(row.audience_id) : null),
    requirements: jsonArray(row.requirements_json), proofTypes: jsonArray(row.proof_types_json), claimMode: text(row.claim_mode) as CampusTask['claimMode'],
    contacts, teacherId: text(row.teacher_id), teacherName: text(row.teacher_name), department: text(row.department_name),
    status: text(row.status) as TaskStatus, statusBeforeCancel: row.status_before_cancel ? text(row.status_before_cancel) as TaskStatus : undefined,
    members, createdAt: text(row.created_at), distance: text(row.campus_name) === '线上协助' ? '可线上完成' : '校内任务',
    featured: bool(row.featured), occupiedCount, remainingSeats, canClaim, version: Number(row.version), workflowStatus
  }
}

export function mapMember(db: AppDatabase, row: SqlRow): TaskMember {
  // All public member DTOs use the same latest immutable revision as the workflow.
  // proof_files is a legacy one-owner projection and cannot represent shared files.
  const revision = db.get(`SELECT r.* FROM workflow_participants p JOIN workflow_revisions r
    ON r.id=p.latest_revision_id AND r.participant_id=p.id AND r.task_id=p.task_id
    WHERE p.task_id=? AND p.user_id=?`, text(row.task_id), text(row.user_id))
  const proofRow = revision ?? db.get('SELECT * FROM proofs WHERE task_id = ? AND user_id = ?', text(row.task_id), text(row.user_id))
  let proof: TaskProof | undefined
  if (proofRow) {
    const files = revision
      ? db.all('SELECT file_id id FROM workflow_revision_files WHERE revision_id=? ORDER BY sort_order', text(revision.id))
      : db.all(`SELECT f.id FROM proof_files pf JOIN files f ON f.id = pf.file_id
        WHERE pf.proof_id = ? ORDER BY pf.sort_order`, text(proofRow.id))
    proof = {
      description: text(proofRow.description), note: text(proofRow.note), submittedAt: text(proofRow.submitted_at),
      fileIds: files.map((file) => text(file.id)), images: files.map((file) => `/api/files/${text(file.id)}`)
    }
  }
  return {
    userId: text(row.user_id), name: text(row.name), account: text(row.account), department: text(row.department_name),
    className: row.class_name ? text(row.class_name) : undefined, status: text(row.status) as MemberStatus,
    statusBeforeCancel: row.status_before_cancel ? text(row.status_before_cancel) as MemberStatus : undefined,
    claimedAt: text(row.claimed_at), startedAt: row.started_at ? text(row.started_at) : undefined,
    proof, feedback: row.feedback ? text(row.feedback) : undefined, version: Number(row.version)
  }
}

export function mapNotice(row: SqlRow): AppNotice {
  return { id: text(row.id), userId: text(row.user_id), title: text(row.title), content: text(row.content),
    createdAt: text(row.created_at), read: bool(row.read), type: text(row.type) as AppNotice['type'] }
}
