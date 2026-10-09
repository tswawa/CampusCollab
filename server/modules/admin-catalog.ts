import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { CatalogKind } from '../../shared/contracts.js'
import type { AppDatabase } from '../db/database.js'
import { createId, nowIso } from '../db/database.js'
import { getCatalog } from '../db/models.js'
import { assertCondition } from '../errors.js'
import { DefaultResponseSchema, success } from '../http.js'
import type { SessionService } from '../security/session.js'
import { audit } from './accounts.service.js'

const KindSchema = Type.Union([
  Type.Literal('departments'), Type.Literal('grades'), Type.Literal('classes'),
  Type.Literal('campuses'), Type.Literal('categories')
])
const CatalogParams = Type.Object({ kind: KindSchema }, { additionalProperties: false })
const CatalogItemParams = Type.Object({ kind: KindSchema, id: Type.String({ minLength: 1, maxLength: 100 }) }, { additionalProperties: false })
const CatalogBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 64 }),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
  departmentId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  gradeId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 }))
}, { additionalProperties: false })
const CatalogPatchBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
  departmentId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  gradeId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  enabled: Type.Optional(Type.Boolean()),
  version: Type.Integer({ minimum: 1 })
}, { additionalProperties: false })

const tableByKind: Record<CatalogKind, string> = {
  departments: 'departments', grades: 'grades', classes: 'classes', campuses: 'campuses', categories: 'task_categories'
}
const prefixByKind: Record<CatalogKind, string> = {
  departments: 'dept', grades: 'grade', classes: 'class', campuses: 'campus', categories: 'category'
}

function itemFor(db: AppDatabase, kind: CatalogKind, id: string) {
  const catalog = getCatalog(db, true)
  const list = kind === 'categories' ? catalog.taskCategories : catalog[kind]
  return list.find((item) => item.id === id)
}

function ensureUnique(db: AppDatabase, kind: CatalogKind, name: string, ignoreId?: string, code?: string) {
  const table = tableByKind[kind]
  const duplicate = db.get(`SELECT id FROM ${table} WHERE lower(name) = lower(?)`, name.trim())
  assertCondition(!duplicate || String(duplicate.id) === ignoreId, 409, 'CATALOG_EXISTS', '名称已存在')
  if (kind === 'departments' && code) {
    const duplicateCode = db.get('SELECT id FROM departments WHERE lower(code) = lower(?)', code.trim())
    assertCondition(!duplicateCode || String(duplicateCode.id) === ignoreId, 409, 'CATALOG_CODE_EXISTS', '学院代码已存在')
  }
}

function ensureParents(db: AppDatabase, departmentId?: string, gradeId?: string, current?: { department_id: unknown; grade_id: unknown }) {
  assertCondition(departmentId && gradeId, 400, 'CLASS_PARENT_REQUIRED', '请选择学院和年级')
  const department = db.get('SELECT enabled FROM departments WHERE id = ?', departmentId)
  const grade = db.get('SELECT enabled FROM grades WHERE id = ?', gradeId)
  assertCondition(department && (Number(department.enabled) === 1 || String(current?.department_id) === departmentId), 400, 'DEPARTMENT_INVALID', '所属学院不存在或已停用')
  assertCondition(grade && (Number(grade.enabled) === 1 || String(current?.grade_id) === gradeId), 400, 'GRADE_INVALID', '所属年级不存在或已停用')
}

function isReferenced(db: AppDatabase, kind: CatalogKind, id: string): boolean {
  if (kind === 'departments') return Boolean(db.get(`SELECT 1 marker FROM users WHERE department_id = ? UNION ALL
    SELECT 1 FROM classes WHERE department_id = ? UNION ALL SELECT 1 FROM tasks WHERE audience_scope = 'department' AND audience_id = ? LIMIT 1`, id, id, id))
  if (kind === 'grades') return Boolean(db.get(`SELECT 1 marker FROM users WHERE grade_id = ? UNION ALL
    SELECT 1 FROM classes WHERE grade_id = ? UNION ALL SELECT 1 FROM tasks WHERE audience_scope = 'grade' AND audience_id = ? LIMIT 1`, id, id, id))
  if (kind === 'classes') return Boolean(db.get(`SELECT 1 marker FROM users WHERE class_id = ? UNION ALL
    SELECT 1 FROM tasks WHERE audience_scope = 'class' AND audience_id = ? LIMIT 1`, id, id))
  if (kind === 'campuses') return Boolean(db.get('SELECT 1 marker FROM tasks WHERE campus_id = ? LIMIT 1', id))
  return Boolean(db.get('SELECT 1 marker FROM tasks WHERE category_id = ? LIMIT 1', id))
}

export function registerAdminCatalogRoutes(app: FastifyInstance, db: AppDatabase, sessions: SessionService) {
  app.post('/api/admin/catalog/:kind', {
    schema: { params: CatalogParams, body: CatalogBody, response: DefaultResponseSchema }
  }, async (request, reply) => {
    const actor = sessions.requireUser(request, ['admin'])
    const kind = (request.params as { kind: CatalogKind }).kind
    const body = request.body as { name: string; code?: string; departmentId?: string; gradeId?: string }
    const name = body.name.trim()
    assertCondition(name, 400, 'CATALOG_NAME_REQUIRED', '请输入名称')
    if (kind === 'departments') assertCondition(body.code?.trim(), 400, 'CATALOG_CODE_REQUIRED', '请输入学院代码')
    if (kind === 'classes') ensureParents(db, body.departmentId, body.gradeId)
    ensureUnique(db, kind, name, undefined, body.code)
    const id = createId(prefixByKind[kind])
    const timestamp = nowIso()
    if (kind === 'departments') db.run(`INSERT INTO departments(id, name, code, enabled, version, created_at, updated_at)
      VALUES (?, ?, ?, 1, 1, ?, ?)`, id, name, body.code!.trim().toUpperCase(), timestamp, timestamp)
    else if (kind === 'classes') db.run(`INSERT INTO classes(id, name, department_id, grade_id, enabled, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?)`, id, name, body.departmentId!, body.gradeId!, timestamp, timestamp)
    else db.run(`INSERT INTO ${tableByKind[kind]}(id, name, enabled, version, created_at, updated_at)
      VALUES (?, ?, 1, 1, ?, ?)`, id, name, timestamp, timestamp)
    audit(db, actor.id, 'catalog.create', kind, id, { name })
    reply.code(201)
    return success(itemFor(db, kind, id), '已添加')
  })

  app.patch('/api/admin/catalog/:kind/:id', {
    schema: { params: CatalogItemParams, body: CatalogPatchBody, response: DefaultResponseSchema }
  }, async (request) => {
    const actor = sessions.requireUser(request, ['admin'])
    const { kind, id } = request.params as { kind: CatalogKind; id: string }
    const body = request.body as { name?: string; code?: string; departmentId?: string; gradeId?: string; enabled?: boolean; version: number }
    const table = tableByKind[kind]
    const current = db.get(`SELECT * FROM ${table} WHERE id = ?`, id)
    assertCondition(current, 404, 'CATALOG_NOT_FOUND', '配置项不存在')
    assertCondition(Number(current.version) === body.version, 409, 'STALE_VERSION', '配置已被其他管理员修改，请刷新后重试')
    const name = body.name?.trim() || String(current.name)
    const code = kind === 'departments' ? (body.code?.trim().toUpperCase() || String(current.code)) : undefined
    ensureUnique(db, kind, name, id, code)
    let departmentId: string | undefined
    let gradeId: string | undefined
    if (kind === 'classes') {
      departmentId = body.departmentId ?? String(current.department_id)
      gradeId = body.gradeId ?? String(current.grade_id)
      ensureParents(db, departmentId, gradeId, current as { department_id: unknown; grade_id: unknown })
      if ((departmentId !== String(current.department_id) || gradeId !== String(current.grade_id)) && isReferenced(db, kind, id)) {
        assertCondition(false, 409, 'CLASS_IN_USE', '班级已有账号或任务关联，不能直接迁移所属学院或年级')
      }
    }
    const enabled = body.enabled === undefined ? Number(current.enabled) : Number(body.enabled)
    const timestamp = nowIso()
    let result
    if (kind === 'departments') result = db.run(`UPDATE departments SET name = ?, code = ?, enabled = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?`, name, code!, enabled, timestamp, id, body.version)
    else if (kind === 'classes') result = db.run(`UPDATE classes SET name = ?, department_id = ?, grade_id = ?, enabled = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?`, name, departmentId!, gradeId!, enabled, timestamp, id, body.version)
    else result = db.run(`UPDATE ${table} SET name = ?, enabled = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?`, name, enabled, timestamp, id, body.version)
    assertCondition(Number(result.changes) === 1, 409, 'STALE_VERSION', '配置已变化，请刷新后重试')
    audit(db, actor.id, 'catalog.update', kind, id, { name, enabled: Boolean(enabled) })
    return success(itemFor(db, kind, id), '已更新')
  })

  app.delete('/api/admin/catalog/:kind/:id', {
    schema: {
      params: CatalogItemParams,
      body: Type.Object({ version: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
      response: DefaultResponseSchema
    }
  }, async (request) => {
    const actor = sessions.requireUser(request, ['admin'])
    const { kind, id } = request.params as { kind: CatalogKind; id: string }
    const version = (request.body as { version: number }).version
    const current = db.get(`SELECT version FROM ${tableByKind[kind]} WHERE id = ?`, id)
    assertCondition(current, 404, 'CATALOG_NOT_FOUND', '配置项不存在')
    assertCondition(Number(current.version) === version, 409, 'STALE_VERSION', '配置已变化，请刷新后重试')
    assertCondition(!isReferenced(db, kind, id), 409, 'CATALOG_IN_USE', '该项正在被账号或任务使用，可先停用')
    db.run(`DELETE FROM ${tableByKind[kind]} WHERE id = ? AND version = ?`, id, version)
    audit(db, actor.id, 'catalog.delete', kind, id)
    return success(null, '已删除')
  })
}
