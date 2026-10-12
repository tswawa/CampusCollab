import fs from 'node:fs'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Temporal } from '@js-temporal/polyfill'
import type { InstallationInput } from '../../shared/contracts.js'
import type { AppDatabase } from '../db/database.js'
import { nowIso } from '../db/database.js'
import { getSchool, getUserById, normalizeAccount } from '../db/models.js'
import { assertCondition } from '../errors.js'
import { hashPassword, isCommonPassword, validatePassword } from '../security/password.js'
import { hasInstallationBusinessData, isInstallationConfigured } from './state.js'

export const setupTokenPath = (db: AppDatabase) => `${db.config.databasePath}.setup-token`
const digest = (value: string) => createHash('sha256').update(value).digest()

// The plaintext credential is only available to the deployment owner on the host.
// Neither status responses nor application logs include the credential or its hash.
export function prepareSetupCredential(db: AppDatabase): Buffer | undefined {
  if (isInstallationConfigured(db) || hasInstallationBusinessData(db)) return undefined
  if (db.config.setupToken) return digest(db.config.setupToken)
  if (db.config.databasePath === ':memory:') return undefined
  const filename = setupTokenPath(db)
  try {
    try {
      fs.writeFileSync(filename, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const stat = fs.lstatSync(filename)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 32 || stat.size > 256) return undefined
    const token = fs.readFileSync(filename, 'utf8')
    if (/\s/.test(token)) return undefined
    return digest(token)
  } catch {
    return undefined
  }
}

function assertEmptyInstallation(db: AppDatabase) {
  assertCondition(
    !isInstallationConfigured(db),
    409,
    'INSTALLATION_CONFIGURED',
    '机构已完成初始化，请使用已有管理员账号登录'
  )
  assertCondition(
    Boolean(db.get('SELECT id FROM installation_state WHERE id=1')) && !hasInstallationBusinessData(db),
    409,
    'INSTALLATION_BLOCKED',
    '检测到现有业务数据，安装已关闭，请联系部署管理员'
  )
}

function validateInput(input: Omit<InstallationInput, 'setupToken'>) {
  assertCondition(input.locale === 'en' || input.locale === 'zh-CN', 400, 'LOCALE_INVALID', '不支持此语言')
  assertCondition(
    [input.name, input.platformName].every(
      value => value.trim().length > 0 && value.length <= 64 && !/\p{Cc}/u.test(value)
    ),
    400,
    'SCHOOL_NAME_REQUIRED',
    '学校名称、平台名称和简称不能为空'
  )
  assertCondition(
    input.admin.account.trim().length >= 4 &&
      input.admin.account.trim().length <= 254 &&
      /^[\p{L}\p{M}\p{N}._@+\-]+$/u.test(input.admin.account.trim()),
    400,
    'ACCOUNT_INVALID',
    '账号须为 4—254 位用户名或邮箱'
  )
  assertCondition(
    [...input.admin.name.trim()].length >= 1 &&
      [...input.admin.name.trim()].length <= 100 &&
      !/\p{Cc}/u.test(input.admin.name),
    400,
    'NAME_INVALID',
    '姓名须为 1—100 个字符'
  )
  assertCondition(
    !validatePassword(input.admin.password),
    400,
    'PASSWORD_INVALID',
    '密码须为 8—128 位，包含字母、数字或符号中的至少两类'
  )
  assertCondition(
    !isCommonPassword(input.admin.password, input.admin.account),
    400,
    'PASSWORD_TOO_COMMON',
    '密码过于常见或包含账号，请换一个更难猜的密码'
  )
  let validTimezone = false
  try {
    if (!/^[+-]/.test(input.timezone)) {
      Temporal.Now.instant().toZonedDateTimeISO(input.timezone)
      validTimezone = true
    }
  } catch {
    /* Invalid IANA zone. */
  }
  assertCondition(validTimezone, 400, 'TIMEZONE_INVALID', '请使用有效的 IANA 时区')
}

function applyEnglishSeeds(db: AppDatabase) {
  const rows: Array<[string, string, string, string]> = [
    ['departments', 'dept-cs', '计算机科学与技术学院', 'Computing'],
    ['departments', 'dept-ie', '信息与电子工程学院', 'Information and Electronics'],
    ['departments', 'dept-me', '机械工程学院', 'Mechanical Engineering'],
    ['departments', 'dept-ce', '建筑工程学院', 'Built Environment'],
    ['departments', 'dept-fl', '外国语学院', 'Languages'],
    ['departments', 'dept-admin', '信息化与教务管理中心', 'Administration'],
    ['campuses', 'campus-main', '主校区', 'Main campus'],
    ['campuses', 'campus-east', '东校区', 'East campus'],
    ['campuses', 'campus-west', '西校区', 'West campus'],
    ['campuses', 'campus-online', '线上协助', 'Online'],
    ['task_categories', 'category-event', '活动协助', 'Events'],
    ['task_categories', 'category-place', '场地协助', 'Facilities'],
    ['task_categories', 'category-document', '资料整理', 'Documentation'],
    ['task_categories', 'category-design', '设计制作', 'Design'],
    ['task_categories', 'category-device', '设备协助', 'Equipment'],
    ...[2023, 2024, 2025, 2026].map(
      year => ['grades', `grade-${year}`, `${year}级`, `${year} cohort`] as [string, string, string, string]
    ),
    ['classes', 'class-24cs1', '24计科1班', 'Computing 2024 A'],
    ['classes', 'class-24cs2', '24计科2班', 'Computing 2024 B'],
    ['classes', 'class-24se1', '24软件1班', 'Software 2024 A'],
    ['classes', 'class-25cs1', '25计科1班', 'Computing 2025 A'],
    ['classes', 'class-24com1', '24通信1班', 'Communications 2024 A'],
    ['classes', 'class-24ee1', '24电子1班', 'Electronics 2024 A'],
    ['classes', 'class-23me2', '23机械2班', 'Engineering 2023 B'],
    ['classes', 'class-24civil1', '24土木1班', 'Civil Engineering 2024 A'],
    ['classes', 'class-24en1', '24英语1班', 'Languages 2024 A']
  ]
  for (const [table, id, original, replacement] of rows) {
    // Table names and original values are fixed system seeds, never request input.
    db.run(`UPDATE ${table} SET name=? WHERE id=? AND name=? AND version=1`, replacement, id, original)
  }
}

async function install(
  db: AppDatabase,
  input: Omit<InstallationInput, 'setupToken'>,
  source: 'web' | 'cli',
  authorize: () => void
) {
  assertEmptyInstallation(db)
  authorize()
  validateInput(input)
  const registrationPolicy = input.registrationPolicy ?? 'open'
  const passwordHash = await hashPassword(input.admin.password)
  return db.transaction(() => {
    // Hashing yields to other requests: every authority/state check must be repeated.
    assertEmptyInstallation(db)
    authorize()
    const timestamp = nowIso()
    const id = `admin_${randomUUID()}`
    if (input.locale === 'en') applyEnglishSeeds(db)
    db.run(
      `UPDATE school_settings SET name=?,platform_name=?,badge=?,announcement='',logo_file_id=NULL,logo_url='',
      timezone=?,default_locale=?,registration_enabled=?,student_approval_required=?,
      require_department=?,require_grade=?,require_class=?,version=version+1,updated_at=? WHERE id=1`,
      input.name.trim(),
      input.platformName.trim(),
      input.locale === 'en' ? 'Campus' : '校内',
      input.timezone,
      input.locale,
      registrationPolicy === 'closed' ? 0 : 1,
      registrationPolicy === 'approval' ? 1 : 0,
      input.locale === 'zh-CN' ? 1 : 0,
      input.locale === 'zh-CN' ? 1 : 0,
      input.locale === 'zh-CN' ? 1 : 0,
      timestamp
    )
    db.run(
      `INSERT INTO users(id,role,account,account_normalized,name,department_id,class_id,grade_id,password_hash,
      approval,skills_json,version,created_at,updated_at,locale) VALUES (?,'admin',?,?,?,NULL,NULL,NULL,?,'approved','[]',1,?,?,NULL)`,
      id,
      input.admin.account.trim(),
      normalizeAccount(input.admin.account),
      input.admin.name.trim(),
      passwordHash,
      timestamp,
      timestamp
    )
    const result = db.run(
      'UPDATE installation_state SET configured_at=?,source=? WHERE id=1 AND configured_at IS NULL',
      timestamp,
      source
    )
    assertCondition(
      Number(result.changes) === 1,
      409,
      'INSTALLATION_CONFIGURED',
      '机构已完成初始化，请使用已有管理员账号登录'
    )
    db.run(
      `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,'installation.configure','school','1',?,?)`,
      id,
      JSON.stringify({ source, locale: input.locale }),
      timestamp
    )
    return { user: getUserById(db, id)!, school: getSchool(db) }
  })
}

export function installWithCredential(db: AppDatabase, input: InstallationInput, credential: Buffer | undefined) {
  return install(db, input, 'web', () =>
    assertCondition(
      Boolean(credential) && timingSafeEqual(digest(input.setupToken), credential!),
      403,
      'INSTALLATION_TOKEN_INVALID',
      '安装码无效，请向部署管理员获取'
    )
  )
}

// Only the trusted local CLI uses this entry point; it is never an HTTP bypass.
export function installFromTrustedHost(db: AppDatabase, input: Omit<InstallationInput, 'setupToken'>) {
  return install(db, input, 'cli', () => {})
}
