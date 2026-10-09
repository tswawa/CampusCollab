import { randomUUID } from 'node:crypto'
import type { AdminAccountPayload, ApprovalStatus, CampusUser, RegistrationPayload, UserRole } from '../../shared/contracts.js'
import type { AppDatabase } from '../db/database.js'
import { nowIso } from '../db/database.js'
import { getSchool, getUserById, mapUser, normalizeAccount } from '../db/models.js'
import { assertCondition } from '../errors.js'
import { createEventNotice } from '../i18n/notices.js'
import { hashPassword, validatePassword } from '../security/password.js'
import { isInstallationConfigured } from '../installation/state.js'

function validateIdentity(account: string, name: string) {
  assertCondition(account.trim().length >= 4 && account.trim().length <= 254 && /^[\p{L}\p{M}\p{N}._@+\-]+$/u.test(account.trim()),
    400, 'ACCOUNT_INVALID', '账号须为 4—254 位用户名或邮箱', { min: 4, max: 254 })
  const length = [...name.trim()].length
  assertCondition(length >= 1 && length <= 100 && !/\p{Cc}/u.test(name), 400, 'NAME_INVALID', '姓名须为 1—100 个字符', { min: 1, max: 100 })
}

function validateOrganization(db: AppDatabase, role: UserRole, departmentId?: string, gradeId?: string, classId?: string, existing?: CampusUser, isExternal = false) {
  const school = getSchool(db)
  assertCondition(!isExternal || role === 'student', 400, 'EXTERNAL_ROLE_INVALID', '校外参与者只能申请参与者角色')
  assertCondition(!isExternal || school.allowExternalParticipants || existing?.isExternal, 403, 'EXTERNAL_PARTICIPANTS_DISABLED', '机构暂未开放校外参与者注册')
  assertCondition(isExternal || !school.requireDepartment || departmentId, 400, 'DEPARTMENT_REQUIRED', '请选择所属组织单位')
  const department = departmentId ? db.get('SELECT id, enabled FROM departments WHERE id = ?', departmentId) : undefined
  if (departmentId) assertCondition(department && (Number(department.enabled) === 1 || existing?.departmentId === departmentId), 400, 'DEPARTMENT_INVALID', '请选择有效的学院或部门')
  assertCondition(role !== 'student' || isExternal || !school.requireGrade || gradeId, 400, 'GRADE_REQUIRED', '请选择年级')
  assertCondition(role !== 'student' || isExternal || !school.requireClass || classId, 400, 'CLASS_REQUIRED', '请选择班级')
  const grade = gradeId ? db.get('SELECT id, enabled FROM grades WHERE id = ?', gradeId) : undefined
  if (gradeId) assertCondition(grade && (Number(grade.enabled) === 1 || existing?.gradeId === gradeId), 400, 'GRADE_INVALID', '请选择有效的年级')
  const classItem = classId ? db.get('SELECT id, department_id, grade_id, enabled FROM classes WHERE id = ?', classId) : undefined
  if (classId) assertCondition(classItem && String(classItem.department_id) === departmentId && String(classItem.grade_id) === gradeId &&
    (Number(classItem.enabled) === 1 || existing?.classId === classId), 400, 'CLASS_INVALID', '请选择所属学院和年级下的有效班级')
  return { departmentId: departmentId || null, classId: classId || null, gradeId: gradeId || null }
}

function validateProfile(db: AppDatabase, payload: AdminAccountPayload, ignoreId?: string) {
  assertCondition(!payload.locale || payload.locale === 'en' || payload.locale === 'zh-CN', 400, 'LOCALE_INVALID', '不支持此语言')
  const email = payload.email?.trim() || null
  assertCondition(!email || (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)), 400, 'EMAIL_INVALID', '邮箱格式无效')
  const externalId = payload.externalId?.trim() || null
  assertCondition(!externalId || (externalId.length <= 100 && !/[\p{Cc}\p{Cf}]/u.test(externalId)), 400, 'EXTERNAL_ID_INVALID', '外部编号须为不超过 100 字符的文本')
  const duplicate = externalId ? db.get('SELECT id FROM users WHERE external_id = ?', externalId) : undefined
  assertCondition(!duplicate || String(duplicate.id) === ignoreId, 409, 'EXTERNAL_ID_EXISTS', '此外部编号已绑定另一个账号，请联系管理员核对')
  return { email, externalId }
}

function ensureAccountUnique(db: AppDatabase, account: string, ignoreId?: string) {
  const duplicate = db.get('SELECT id FROM users WHERE account_normalized = ?', normalizeAccount(account))
  assertCondition(!duplicate || String(duplicate.id) === ignoreId, 409, 'ACCOUNT_EXISTS', '账号已存在')
}

function assertCurrentAdmin(db: AppDatabase, actor: CampusUser) {
  const current = getUserById(db, actor.id)
  assertCondition(current?.role === 'admin' && current.approval === 'approved' && current.version === actor.version,
    403, 'FORBIDDEN', '管理员身份已变化，请重新登录')
}

function guardAdminAndTaskReferences(db: AppDatabase, actor: CampusUser, current: CampusUser, role: UserRole, approval: ApprovalStatus, deleting = false) {
  assertCurrentAdmin(db, actor)
  assertCondition(!(actor.id === current.id && (deleting || role !== current.role || approval !== 'approved')),
    400, 'SELF_PROTECTED', '不能删除、停用当前账号或修改当前角色')
  const referenced = Boolean(db.get(`SELECT 1 FROM tasks WHERE teacher_id = ? UNION ALL
    SELECT 1 FROM task_members WHERE user_id = ? LIMIT 1`, current.id, current.id))
  assertCondition(!(referenced && (deleting || role !== current.role)), 409, 'USER_HAS_TASKS', '账号已有任务记录，不能删除或变更角色，可改为停用')
  if (current.role === 'admin' && current.approval === 'approved' && (deleting || role !== 'admin' || approval !== 'approved')) {
    assertCondition(Number(db.get("SELECT COUNT(*) count FROM users WHERE role = 'admin' AND approval = 'approved'")?.count) > 1,
      409, 'LAST_ADMIN', '至少保留一个正常管理员账号')
  }
}

export async function createRegisteredUser(db: AppDatabase, payload: RegistrationPayload): Promise<CampusUser> {
  assertCondition(isInstallationConfigured(db), 409, 'INSTALLATION_REQUIRED', '请先由部署管理员完成机构初始化')
  const user = await createUser(db, { ...payload, approval: payload.role === 'teacher' || payload.isExternal ? 'pending' : 'approved' }, undefined, true)
  return user
}

async function createUser(db: AppDatabase, payload: AdminAccountPayload, actor?: CampusUser, selfRegistration = false): Promise<CampusUser> {
  validateIdentity(payload.account, payload.name)
  assertCondition(payload.password, 400, 'PASSWORD_REQUIRED', '请设置初始密码')
  const passwordError = validatePassword(payload.password)
  assertCondition(!passwordError, 400, 'PASSWORD_INVALID', passwordError)
  ensureAccountUnique(db, payload.account)
  validateProfile(db, payload)
  if (selfRegistration) assertCondition(getSchool(db).registrationEnabled, 403, 'REGISTRATION_CLOSED', '机构暂未开放自行注册')
  const hash = await hashPassword(payload.password)
  return db.transaction(() => {
    // 哈希是异步操作，真正写入时必须重新验证权限、唯一性和组织状态。
    if (actor) assertCurrentAdmin(db, actor)
    if (selfRegistration) {
      assertCondition(isInstallationConfigured(db), 409, 'INSTALLATION_REQUIRED', '请先由部署管理员完成机构初始化')
      assertCondition(getSchool(db).registrationEnabled, 403, 'REGISTRATION_CLOSED', '机构暂未开放自行注册')
    }
    const organization = validateOrganization(db, payload.role, payload.departmentId, payload.gradeId, payload.classId, undefined, payload.isExternal)
    const profile = validateProfile(db, payload)
    ensureAccountUnique(db, payload.account)
    const id = `${payload.role}_${randomUUID()}`
    const timestamp = nowIso()
    db.run(`INSERT INTO users
      (id, role, account, account_normalized, name, department_id, class_id, grade_id, password_hash,
       approval, skills_json, version, created_at, updated_at, locale, email, external_id, is_external)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?, ?, ?, ?, ?)`,
      id, payload.role, payload.account.trim(), normalizeAccount(payload.account), payload.name.trim(),
      organization.departmentId, organization.classId, organization.gradeId, hash, payload.approval, timestamp, timestamp,
      null, profile.email, profile.externalId, payload.isExternal ? 1 : 0)
    if (payload.approval === 'pending') {
      db.all("SELECT id FROM users WHERE role = 'admin' AND approval = 'approved'").forEach((admin) =>
        createEventNotice(db, String(admin.id), 'account.registration_pending', { actorName: payload.name.trim() },
          { kind: 'accounts', id }, 'system', timestamp))
    }
    return getUserById(db, id)!
  })
}

// 初始化命令使用未传 actor 的受信本机调用；HTTP 路由必须传会话管理员。
export async function createAdminManagedUser(db: AppDatabase, payload: AdminAccountPayload, actor?: CampusUser): Promise<CampusUser> {
  return createUser(db, payload, actor)
}

export async function updateAdminManagedUser(db: AppDatabase, actor: CampusUser, userId: string, payload: AdminAccountPayload): Promise<{ user: CampusUser; invalidateSession: boolean }> {
  validateIdentity(payload.account, payload.name)
  let passwordHash: string | undefined
  if (payload.password) {
    const error = validatePassword(payload.password)
    assertCondition(!error, 400, 'PASSWORD_INVALID', error)
    passwordHash = await hashPassword(payload.password)
  }
  return db.transaction(() => {
    const current = getUserById(db, userId)
    assertCondition(current, 404, 'USER_NOT_FOUND', '账号不存在')
    assertCondition(payload.version === current.version, 409, 'STALE_VERSION', '账号已被其他管理员修改，请刷新后重试')
    guardAdminAndTaskReferences(db, actor, current, payload.role, payload.approval)
    ensureAccountUnique(db, payload.account, userId)
    const organization = validateOrganization(db, payload.role, payload.departmentId, payload.gradeId, payload.classId, current, payload.isExternal ?? current.isExternal)
    const profile = validateProfile(db, payload, userId)
    const result = db.run(`UPDATE users SET role = ?, account = ?, account_normalized = ?, name = ?, department_id = ?,
      class_id = ?, grade_id = ?, approval = ?, password_hash = COALESCE(?, password_hash), version = version + 1,
      updated_at = ?, locale = ?, email = ?, external_id = ?, is_external = ? WHERE id = ? AND version = ?`,
      payload.role, payload.account.trim(), normalizeAccount(payload.account), payload.name.trim(), organization.departmentId,
      organization.classId, organization.gradeId, payload.approval, passwordHash ?? null, nowIso(),
      null, payload.email === undefined ? current.email ?? null : profile.email,
      payload.externalId === undefined ? current.externalId ?? null : profile.externalId,
      (payload.isExternal ?? current.isExternal) ? 1 : 0, userId, current.version)
    assertCondition(Number(result.changes) === 1, 409, 'STALE_VERSION', '账号已变化，请刷新后重试')
    const invalidateSession = Boolean(passwordHash) || payload.role !== current.role || payload.approval !== 'approved'
    if (invalidateSession) db.run('DELETE FROM sessions WHERE user_id = ?', userId)
    return { user: getUserById(db, userId)!, invalidateSession }
  })
}

export function setUserStatus(db: AppDatabase, actor: CampusUser, userId: string, approval: ApprovalStatus, version: number): CampusUser {
  return db.transaction(() => {
    const current = getUserById(db, userId)
    assertCondition(current, 404, 'USER_NOT_FOUND', '账号不存在')
    assertCondition(current.version === version, 409, 'STALE_VERSION', '账号状态已变化，请刷新后重试')
    guardAdminAndTaskReferences(db, actor, current, current.role, approval)
    const result = db.run('UPDATE users SET approval = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', approval, nowIso(), userId, version)
    assertCondition(Number(result.changes) === 1, 409, 'STALE_VERSION', '账号状态已变化，请刷新后重试')
    if (approval !== 'approved') db.run('DELETE FROM sessions WHERE user_id = ?', userId)
    return getUserById(db, userId)!
  })
}

export async function resetUserPassword(db: AppDatabase, userId: string, password: string, version: number, actor?: CampusUser): Promise<CampusUser> {
  const error = validatePassword(password)
  assertCondition(!error, 400, 'PASSWORD_INVALID', error)
  const hash = await hashPassword(password)
  return db.transaction(() => {
    if (actor) assertCurrentAdmin(db, actor)
    assertCondition(getUserById(db, userId), 404, 'USER_NOT_FOUND', '账号不存在')
    const result = db.run('UPDATE users SET password_hash = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', hash, nowIso(), userId, version)
    assertCondition(Number(result.changes) === 1, 409, 'STALE_VERSION', '账号已变化，请刷新后重试')
    db.run('DELETE FROM sessions WHERE user_id = ?', userId)
    return getUserById(db, userId)!
  })
}

export function deleteUser(db: AppDatabase, actor: CampusUser, userId: string, version: number) {
  db.transaction(() => {
    const current = getUserById(db, userId)
    assertCondition(current, 404, 'USER_NOT_FOUND', '账号不存在')
    assertCondition(current.version === version, 409, 'STALE_VERSION', '账号已变化，请刷新后重试')
    guardAdminAndTaskReferences(db, actor, current, current.role, current.approval, true)
    // Historical attribution prevents deletion, but does not freeze the current role.
    const history = db.get(`SELECT 1 FROM workflow_tasks WHERE original_owner_id = ? UNION ALL
      SELECT 1 FROM workflow_participants WHERE user_id = ? UNION ALL
      SELECT 1 FROM workflow_revisions WHERE submitted_by = ? UNION ALL
      SELECT 1 FROM workflow_reviews WHERE actor_id = ? UNION ALL
      SELECT 1 FROM workflow_imports WHERE actor_id = ? UNION ALL
      SELECT 1 FROM workflow_snapshots WHERE created_by = ? LIMIT 1`, userId, userId, userId, userId, userId, userId)
    assertCondition(!history, 409, 'USER_HAS_WORKFLOW_HISTORY', '账号被历史任务记录引用，不能删除，可改为停用')
    const currentLogo = db.get(`SELECT 1 FROM school_settings s JOIN files f ON f.id = s.logo_file_id
      WHERE f.owner_user_id = ? AND f.purpose = 'logo' AND f.status = 'published' LIMIT 1`, userId)
    assertCondition(!currentLogo, 409, 'USER_OWNS_CURRENT_LOGO', '账号上传的 Logo 仍被机构使用，请先更换 Logo 或改为停用账号')
    db.run('DELETE FROM users WHERE id = ? AND version = ?', userId, version)
  })
}

export function listUsers(db: AppDatabase, filters: { keyword?: string; role?: UserRole; approval?: ApprovalStatus; page: number; pageSize: number }) {
  const conditions: string[] = []
  const params: Array<string | number> = []
  if (filters.keyword) {
    conditions.push("(u.name LIKE ? ESCAPE '\\' OR u.account LIKE ? ESCAPE '\\' OR d.name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')")
    const escaped = filters.keyword.replace(/[\\%_]/g, (value) => `\\${value}`)
    params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`)
  }
  if (filters.role) { conditions.push('u.role = ?'); params.push(filters.role) }
  if (filters.approval) { conditions.push('u.approval = ?'); params.push(filters.approval) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const total = Number(db.get(`SELECT COUNT(*) count FROM users u LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN classes c ON c.id = u.class_id ${where}`, ...params)?.count ?? 0)
  const rows = db.all(`SELECT u.*, d.name department_name, c.name class_name, g.name grade_name
    FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN classes c ON c.id = u.class_id
    LEFT JOIN grades g ON g.id = u.grade_id ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    ...params, filters.pageSize, (filters.page - 1) * filters.pageSize)
  return { items: rows.map(row => mapUser(row, getSchool(db).defaultLocale)), total, page: filters.page, pageSize: filters.pageSize }
}

export function audit(db: AppDatabase, actorId: string | null, action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}) {
  db.run('INSERT INTO audit_logs(actor_user_id, action, entity_type, entity_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    actorId, action, entityType, entityId, JSON.stringify(details), nowIso())
}
