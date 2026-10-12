import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import sharp from 'sharp'
import { Temporal } from '@js-temporal/polyfill'
import type { SchoolProfile } from '../../shared/contracts.js'
import type { AppDatabase } from '../db/database.js'
import { createId, nowIso } from '../db/database.js'
import { getCatalog, getSchool, getUserById } from '../db/models.js'
import { AppError, assertCondition } from '../errors.js'
import { DefaultResponseSchema, IdParamsSchema, success } from '../http.js'
import type { SessionService } from '../security/session.js'
import { audit } from './accounts.service.js'
import { assertWorkflowUploadAllowed, canReadWorkflowFile, fileIsReferenced } from './workflow.service.js'

const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp'])
type ImageMetadata = Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>
const outputForFormat = (format?: string) =>
  format === 'jpeg'
    ? { extension: 'jpg', mime: 'image/jpeg' }
    : format === 'png'
      ? { extension: 'png', mime: 'image/png' }
      : format === 'webp'
        ? { extension: 'webp', mime: 'image/webp' }
        : undefined

let activeImageNormalizations = 0
const imageNormalizationWaiters: Array<() => void> = []

async function acquireImageNormalizationSlot() {
  if (activeImageNormalizations >= 2) {
    await new Promise<void>(resolve => imageNormalizationWaiters.push(resolve))
  } else {
    activeImageNormalizations += 1
  }
  return () => {
    const next = imageNormalizationWaiters.shift()
    if (next) next()
    else activeImageNormalizations -= 1
  }
}

async function persistImage(
  request: FastifyRequest,
  db: AppDatabase,
  ownerId: string,
  purpose: 'proof' | 'logo',
  taskId: string | undefined,
  validateWrite: () => void
) {
  const maxBytes = purpose === 'logo' ? 2 * 1024 * 1024 : 10 * 1024 * 1024
  const part = await request.file({ limits: { files: 1, fileSize: maxBytes } })
  assertCondition(part, 400, 'FILE_REQUIRED', '请选择图片文件')
  assertCondition(allowedMime.has(part.mimetype), 415, 'FILE_TYPE_INVALID', '仅支持 JPEG、PNG 或 WebP 图片')
  assertCondition(part.filename.length <= 255, 400, 'FILE_NAME_INVALID', '文件名过长')
  let source: Buffer
  try {
    source = await part.toBuffer()
  } catch (error) {
    if (String(error).includes('file too large') || String(error).includes('RequestFileTooLargeError')) {
      throw new AppError(413, 'FILE_TOO_LARGE', purpose === 'logo' ? 'Logo 不能超过 2MB' : '单张凭证图片不能超过 10MB')
    }
    throw error
  }
  assertCondition(
    source.length > 0 && source.length <= maxBytes,
    413,
    'FILE_TOO_LARGE',
    purpose === 'logo' ? 'Logo 不能超过 2MB' : '单张凭证图片不能超过 10MB'
  )
  const releaseNormalization = await acquireImageNormalizationSlot()
  let metadata: ImageMetadata
  let output: ReturnType<typeof outputForFormat>
  let normalized: Buffer
  try {
    const image = sharp(source, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate()
    try {
      metadata = await image.metadata()
    } catch {
      throw new AppError(415, 'FILE_DECODE_INVALID', '图片内容无效或已损坏')
    }
    output = outputForFormat(metadata.format)
    assertCondition(
      output && metadata.width && metadata.height,
      415,
      'FILE_TYPE_INVALID',
      '仅支持 JPEG、PNG 或 WebP 图片'
    )
    assertCondition(
      metadata.width <= 12_000 && metadata.height <= 12_000 && metadata.width * metadata.height <= 40_000_000,
      413,
      'IMAGE_DIMENSIONS_TOO_LARGE',
      '图片像素尺寸过大'
    )
    if (metadata.format === 'jpeg') normalized = await image.jpeg({ quality: 88, mozjpeg: true }).toBuffer()
    else if (metadata.format === 'png') normalized = await image.png({ compressionLevel: 9 }).toBuffer()
    else normalized = await image.webp({ quality: 88 }).toBuffer()
  } finally {
    releaseNormalization()
  }
  assertCondition(
    normalized.length <= maxBytes,
    413,
    'FILE_TOO_LARGE',
    purpose === 'logo' ? '处理后的 Logo 超过 2MB' : '处理后的凭证图片超过 10MB'
  )
  const directory = path.join(db.config.uploadDir, purpose)
  fs.mkdirSync(directory, { recursive: true })
  const storedName = `${purpose}/${randomUUID()}.${output!.extension}`
  const absolutePath = path.join(db.config.uploadDir, storedName)
  fs.writeFileSync(absolutePath, normalized, { flag: 'wx' })
  const id = createId('file')
  try {
    db.transaction(() => {
      validateWrite()
      const temporaryCount = Number(
        db.get(
          `SELECT COUNT(*) count FROM files WHERE owner_user_id = ? AND task_id IS ?
        AND purpose = ? AND status = 'temporary' AND expires_at > ?`,
          ownerId,
          taskId ?? null,
          purpose,
          Date.now()
        )?.count ?? 0
      )
      assertCondition(
        temporaryCount < (purpose === 'proof' ? 6 : 10),
        409,
        'UPLOAD_LIMIT',
        '待提交图片数量已达上限，请移除旧草稿后重试'
      )
      db.run(
        `INSERT INTO files(id, owner_user_id, task_id, purpose, stored_name, original_name, mime_type,
        size_bytes, width, height, status, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'temporary', ?, ?)`,
        id,
        ownerId,
        taskId ?? null,
        purpose,
        storedName,
        part.filename,
        output!.mime,
        normalized.length,
        metadata.width!,
        metadata.height!,
        Date.now() + 24 * 60 * 60 * 1000,
        nowIso()
      )
    })
  } catch (error) {
    fs.rmSync(absolutePath, { force: true })
    throw error
  }
  return { id, url: `/api/files/${id}` }
}

function requireFileAccess(
  db: AppDatabase,
  request: FastifyRequest,
  sessions: SessionService,
  row: Record<string, unknown>
) {
  if (String(row.purpose) === 'logo' && String(row.status) === 'published') return
  const user = sessions.requireUser(request)
  if (row.purpose === 'proof') {
    assertCondition(canReadWorkflowFile(db, user, String(row.id)), 403, 'FILE_FORBIDDEN', '没有权限查看该文件')
    return
  }
  if (user.role === 'admin' || user.id === String(row.owner_user_id)) return
  if (user.role === 'teacher' && row.task_id) {
    const owns = db.get('SELECT id FROM tasks WHERE id = ? AND teacher_id = ?', String(row.task_id), user.id)
    if (owns && String(row.status) === 'attached') return
  }
  throw new AppError(403, 'FILE_FORBIDDEN', '没有权限查看该文件')
}

function contentDispositionFilename(name: string): string {
  const safe =
    name
      .normalize('NFKD')
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/[\r\n"\\]/g, '_')
      .slice(0, 120) || 'image'
  const encoded = encodeURIComponent(name.slice(0, 180)).replace(
    /[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `inline; filename="${safe}"; filename*=UTF-8''${encoded}`
}

export function registerFileAndSettingRoutes(app: FastifyInstance, db: AppDatabase, sessions: SessionService) {
  app.post(
    '/api/files/proof',
    {
      config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
      schema: {
        querystring: Type.Object(
          { taskId: Type.String({ minLength: 1, maxLength: 100 }) },
          { additionalProperties: false }
        ),
        response: DefaultResponseSchema
      }
    },
    async (request, reply) => {
      const user = sessions.requireUser(request)
      const taskId = (request.query as { taskId: string }).taskId
      const validateWrite = () => {
        const current = sessions.requireUser(request)
        assertCondition(current.id === user.id, 403, 'FORBIDDEN', '上传会话已变化')
        assertWorkflowUploadAllowed(db, current, taskId)
      }
      validateWrite()
      const file = await persistImage(request, db, user.id, 'proof', taskId, validateWrite)
      reply.code(201)
      return success(file, '凭证图片已上传')
    }
  )

  app.post(
    '/api/files/logo',
    {
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: { response: DefaultResponseSchema }
    },
    async (request, reply) => {
      const user = sessions.requireUser(request, ['admin'])
      const file = await persistImage(request, db, user.id, 'logo', undefined, () => {
        assertCondition(sessions.requireUser(request, ['admin']).id === user.id, 403, 'FORBIDDEN', '上传会话已变化')
      })
      reply.code(201)
      return success(file, 'Logo 已上传')
    }
  )

  app.delete(
    '/api/files/:id',
    {
      schema: {
        params: IdParamsSchema,
        body: Type.Object({}, { additionalProperties: false }),
        response: DefaultResponseSchema
      }
    },
    async request => {
      const user = sessions.requireUser(request)
      const id = (request.params as { id: string }).id
      const row = db.get('SELECT * FROM files WHERE id = ?', id)
      assertCondition(row, 404, 'FILE_NOT_FOUND', '文件不存在')
      assertCondition(
        String(row.owner_user_id) === user.id && String(row.status) === 'temporary',
        403,
        'FILE_DELETE_FORBIDDEN',
        '只能删除本人尚未提交的临时文件'
      )
      assertCondition(!fileIsReferenced(db, id), 409, 'FILE_REFERENCED', '该文件仍被任务材料引用')
      const absolutePath = path.resolve(db.config.uploadDir, String(row.stored_name))
      db.run("DELETE FROM files WHERE id = ? AND owner_user_id = ? AND status = 'temporary'", id, user.id)
      if (absolutePath.startsWith(path.resolve(db.config.uploadDir) + path.sep))
        fs.rmSync(absolutePath, { force: true })
      return success(null, '临时文件已删除')
    }
  )

  app.get('/api/files/:id', { schema: { params: IdParamsSchema } }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const row = db.get('SELECT * FROM files WHERE id = ?', id)
    assertCondition(row, 404, 'FILE_NOT_FOUND', '文件不存在')
    requireFileAccess(db, request, sessions, row)
    const absolutePath = path.resolve(db.config.uploadDir, String(row.stored_name))
    assertCondition(
      absolutePath.startsWith(path.resolve(db.config.uploadDir) + path.sep) && fs.existsSync(absolutePath),
      404,
      'FILE_NOT_FOUND',
      '文件不存在'
    )
    reply.header('Content-Type', String(row.mime_type))
    reply.header('Content-Disposition', contentDispositionFilename(String(row.original_name)))
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header(
      'Cache-Control',
      String(row.purpose) === 'logo' && String(row.status) === 'published'
        ? 'public, max-age=3600'
        : 'private, no-store'
    )
    return reply.send(fs.createReadStream(absolutePath))
  })

  app.put(
    '/api/admin/school',
    {
      schema: {
        body: Type.Object(
          {
            name: Type.String({ minLength: 1, maxLength: 64 }),
            platformName: Type.String({ minLength: 1, maxLength: 64 }),
            badge: Type.String({ minLength: 1, maxLength: 16 }),
            announcement: Type.String({ maxLength: 240 }),
            primaryColor: Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' }),
            timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
            defaultLocale: Type.Optional(Type.Union([Type.Literal('zh-CN'), Type.Literal('en')])),
            registrationEnabled: Type.Optional(Type.Boolean()),
            requireDepartment: Type.Optional(Type.Boolean()),
            requireGrade: Type.Optional(Type.Boolean()),
            requireClass: Type.Optional(Type.Boolean()),
            allowExternalParticipants: Type.Optional(Type.Boolean()),
            retentionDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 36500 })),
            logoFileId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
            version: Type.Integer({ minimum: 1 })
          },
          { additionalProperties: false }
        ),
        response: DefaultResponseSchema
      }
    },
    async request => {
      const actor = sessions.requireUser(request, ['admin'])
      const body = request.body as Pick<
        SchoolProfile,
        'name' | 'platformName' | 'badge' | 'announcement' | 'primaryColor' | 'version'
      > &
        Partial<SchoolProfile> & { logoFileId?: string }
      assertCondition(
        body.name.trim() && body.platformName.trim() && body.badge.trim(),
        400,
        'SCHOOL_NAME_REQUIRED',
        '学校名称、平台名称和简称不能为空'
      )
      const current = getSchool(db)
      assertCondition(
        current.version === body.version,
        409,
        'STALE_VERSION',
        '学校设置已被其他管理员修改，请刷新后重试'
      )
      const timezone = body.timezone ?? current.timezone
      try {
        assertCondition(!/^[+-]/.test(timezone), 400, 'TIMEZONE_INVALID', '请使用机构所在地区的 IANA 时区')
        Temporal.Now.instant().toZonedDateTimeISO(timezone)
      } catch {
        throw new AppError(400, 'TIMEZONE_INVALID', '请使用有效的 IANA 时区')
      }
      const settings = {
        defaultLocale: body.defaultLocale ?? current.defaultLocale,
        registrationEnabled: body.registrationEnabled ?? current.registrationEnabled,
        requireDepartment: body.requireDepartment ?? current.requireDepartment,
        requireGrade: body.requireGrade ?? current.requireGrade,
        requireClass: body.requireClass ?? current.requireClass,
        allowExternalParticipants: body.allowExternalParticipants ?? current.allowExternalParticipants,
        retentionDays: body.retentionDays ?? current.retentionDays
      }
      assertCondition(
        !settings.requireClass || (settings.requireDepartment && settings.requireGrade),
        400,
        'ORGANIZATION_SETTINGS_INVALID',
        '要求班级时必须同时要求所属部门和年级'
      )
      const logo = body.logoFileId ? db.get('SELECT * FROM files WHERE id = ?', body.logoFileId) : undefined
      if (body.logoFileId) {
        assertCondition(
          logo &&
            String(logo.owner_user_id) === actor.id &&
            String(logo.purpose) === 'logo' &&
            String(logo.status) === 'temporary',
          400,
          'LOGO_FILE_INVALID',
          'Logo 文件不存在、已使用或不属于当前管理员'
        )
      }
      const oldLogoId = db.get('SELECT logo_file_id FROM school_settings WHERE id = 1')?.logo_file_id
      db.transaction(() => {
        const result = db.run(
          `UPDATE school_settings SET name = ?, platform_name = ?, badge = ?, announcement = ?,
        primary_color = ?, timezone = ?, default_locale = ?, registration_enabled = ?, require_department = ?, require_grade = ?,
        require_class = ?, allow_external_participants = ?, retention_days = ?, logo_file_id = COALESCE(?, logo_file_id), logo_url = CASE WHEN ? IS NULL THEN logo_url ELSE ? END,
        version = version + 1, updated_at = ? WHERE id = 1 AND version = ?`,
          body.name.trim(),
          body.platformName.trim(),
          body.badge.trim(),
          body.announcement.trim(),
          body.primaryColor.toUpperCase(),
          timezone,
          settings.defaultLocale,
          Number(settings.registrationEnabled),
          Number(settings.requireDepartment),
          Number(settings.requireGrade),
          Number(settings.requireClass),
          Number(settings.allowExternalParticipants),
          settings.retentionDays,
          body.logoFileId ?? null,
          body.logoFileId ?? null,
          body.logoFileId ? `/api/files/${body.logoFileId}` : null,
          nowIso(),
          body.version
        )
        assertCondition(Number(result.changes) === 1, 409, 'STALE_VERSION', '学校设置已变化，请刷新后重试')
        if (body.logoFileId) {
          db.run("UPDATE files SET status = 'published', expires_at = NULL WHERE id = ?", body.logoFileId)
          if (oldLogoId && String(oldLogoId) !== body.logoFileId) {
            db.run("UPDATE files SET status = 'temporary', expires_at = ? WHERE id = ?", Date.now(), String(oldLogoId))
          }
        }
        audit(db, actor.id, 'school.update', 'school', '1', { logoChanged: Boolean(body.logoFileId) })
      })
      return success(getSchool(db), '学校设置已保存')
    }
  )

  app.get(
    '/api/admin/export',
    { schema: { response: DefaultResponseSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const actor = sessions.requireUser(request, ['admin'])
      const users = db
        .all(
          `SELECT u.id, u.role, u.account, u.name, d.name department, c.name className, g.name grade,
      u.approval, u.skills_json skills, u.version FROM users u LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN classes c ON c.id = u.class_id LEFT JOIN grades g ON g.id = u.grade_id ORDER BY u.created_at`
        )
        .map(row => ({ ...row, skills: JSON.parse(String(row.skills ?? '[]')) }))
      const data = {
        version: 2,
        exportedAt: nowIso(),
        notice: '业务数据导出不包含密码、密码哈希、会话和文件内容，不是完整灾备。',
        school: getSchool(db),
        catalog: getCatalog(db, true),
        users,
        tasks: db.all(
          'SELECT id, title, status, teacher_id teacherId, created_at createdAt, updated_at updatedAt FROM tasks ORDER BY created_at'
        ),
        notices: db.all(
          'SELECT id, user_id userId, title, content, type, read, created_at createdAt FROM notices ORDER BY created_at'
        )
      }
      audit(db, actor.id, 'data.export', 'system', 'business')
      reply.header('Cache-Control', 'no-store')
      return success(data, '业务数据已导出')
    }
  )
}
