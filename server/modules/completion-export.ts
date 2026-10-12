import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import { zip, type Zippable } from 'fflate'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { AppLocale } from '../../shared/contracts.js'
import type { ProofRevision, WorkflowSnapshot } from '../../shared/workflow-contracts.js'
import type { AppDatabase } from '../db/database.js'
import { getSchool } from '../db/models.js'
import type { SessionService } from '../security/session.js'
import { AppError, assertCondition } from '../errors.js'
import { audit } from './accounts.service.js'
import { getWorkflowSnapshot } from './workflow.service.js'
import { productNames } from '../../shared/brand.js'

const labels = {
  'zh-CN': [
    '姓名',
    '学号/工号',
    '外部编号',
    '部门',
    '分组',
    '名单来源',
    '结果',
    '确认分钟数',
    '材料路径',
    '参与记录 ID',
    '确认个人版本',
    '确认公共版本'
  ],
  en: [
    'Name',
    'Account',
    'External ID',
    'Department',
    'Group',
    'Roster source',
    'Outcome',
    'Confirmed minutes',
    'Evidence paths',
    'Participant ID',
    'Approved personal revision',
    'Approved shared revision'
  ]
}
const outcomes: Record<string, Record<AppLocale, string>> = {
  completed: { 'zh-CN': '已确认', en: 'Confirmed' },
  incomplete: { 'zh-CN': '未完成', en: 'Incomplete' },
  withdrawn: { 'zh-CN': '已退出', en: 'Withdrawn' },
  rejected: { 'zh-CN': '已拒绝', en: 'Rejected' },
  cancelled: { 'zh-CN': '已取消', en: 'Cancelled' }
}
const rosterSources: Record<string, Record<AppLocale, string>> = {
  account: { 'zh-CN': '账号报名', en: 'Account sign-up' },
  import: { 'zh-CN': '名单导入', en: 'Imported roster' }
}
const metadataLabels = {
  'zh-CN': {
    snapshot: '结果版本 ID',
    version: '版本',
    supersedes: '取代的版本',
    task: '任务',
    created: '创建时间',
    participants: '参与人数',
    confirmed: '已确认人数',
    confirmedMinutes: '确认分钟数',
    template: '模板',
    templateVersion: '模板版本'
  },
  en: {
    snapshot: 'Snapshot',
    version: 'Version',
    supersedes: 'Supersedes',
    task: 'Task',
    created: 'Created',
    participants: 'Participants',
    confirmed: 'Confirmed',
    confirmedMinutes: 'Confirmed minutes',
    template: 'Template',
    templateVersion: 'Template version'
  }
}
const maxBytes = 50 * 1024 * 1024
const safeId = (id: string) => {
  // Legacy IDs contain colons. Hash unsafe segments without exposing them as paths.
  return /^[a-zA-Z0-9_-]{1,120}$/.test(id) ? id : `id-${createHash('sha256').update(id).digest('hex')}`
}
export function csvCell(value: string | number): string {
  let text = String(value)
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export async function buildCompletionExport(
  db: AppDatabase,
  snapshot: WorkflowSnapshot,
  locale: AppLocale,
  format: 'csv' | 'xlsx' | 'zip'
) {
  assertCondition(snapshot.participants.length <= 5000, 413, 'EXPORT_TOO_LARGE', '单个结果包最多包含 5000 人')
  const entries: Record<string, Buffer> = Object.create(null) as Record<string, Buffer>
  const selected = new Map<string, ProofRevision>()
  const pathsByRevision = new Map<string, string[]>()
  let totalBytes = 0
  const add = (name: string, data: Buffer) => {
    if (entries[name]) return
    totalBytes += data.length
    assertCondition(totalBytes <= maxBytes, 413, 'EXPORT_TOO_LARGE', '结果包超过 50MB，请分批组织任务')
    entries[name] = data
  }
  for (const participant of snapshot.participants) {
    if (participant.status !== 'completed') continue
    if (participant.confirmedRevisionId) {
      const revision = participant.revisions.find(item => item.id === participant.confirmedRevisionId)
      assertCondition(revision, 409, 'EXPORT_REVISION_MISSING', '结项记录缺少已确认材料版本')
      selected.set(revision.id, revision)
    }
    if (participant.commonRevisionId) {
      const revision = snapshot.commonRevisions.find(item => item.id === participant.commonRevisionId)
      assertCondition(revision, 409, 'EXPORT_REVISION_MISSING', '结项记录缺少已确认公共材料')
      selected.set(revision.id, revision)
    }
  }
  for (const revision of selected.values()) {
    const prefix = `evidence/${revision.scope === 'common' ? 'shared' : safeId(revision.participantId!)}/${safeId(revision.id)}`
    const paths = [`${prefix}/record.txt`]
    add(
      paths[0]!,
      Buffer.from(
        [
          `Revision: ${revision.id}`,
          `Submitted: ${revision.submittedAt}`,
          `Scope: ${revision.scope}`,
          '',
          revision.description,
          '',
          revision.note
        ].join('\n'),
        'utf8'
      )
    )
    for (const fileId of revision.fileIds) {
      const file = db.get('SELECT stored_name, mime_type, size_bytes FROM files WHERE id = ?', fileId)
      assertCondition(file, 409, 'EXPORT_FILE_MISSING', '已确认的材料文件不存在')
      const suffix = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[
        String(file.mime_type)
      ]
      assertCondition(suffix, 409, 'EXPORT_FILE_INVALID', '已确认的材料格式不受支持')
      const stored = path.resolve(db.config.uploadDir, String(file.stored_name))
      const root = path.resolve(db.config.uploadDir)
      assertCondition(stored.startsWith(root + path.sep), 409, 'EXPORT_FILE_INVALID', '材料存储路径不正确')
      let data: Buffer
      try {
        const realRoot = await fs.realpath(root)
        const realFile = await fs.realpath(stored)
        assertCondition(realFile.startsWith(realRoot + path.sep), 409, 'EXPORT_FILE_INVALID', '材料存储路径不正确')
        const stat = await fs.stat(realFile)
        assertCondition(
          stat.isFile() && stat.size === Number(file.size_bytes) && totalBytes + stat.size <= maxBytes,
          413,
          'EXPORT_FILE_INVALID',
          '材料文件大小不正确或超过导出上限'
        )
        data = await fs.readFile(realFile)
      } catch (error) {
        if (error instanceof AppError) throw error
        throw new AppError(409, 'EXPORT_FILE_MISSING', '已确认的材料文件无法读取')
      }
      const name = `${prefix}/${safeId(fileId)}.${suffix}`
      paths.push(name)
      add(name, data)
    }
    pathsByRevision.set(revision.id, paths)
  }
  const rows = snapshot.participants.map((person): Array<string | number> => [
    person.name,
    person.userId ? String(db.get('SELECT account FROM users WHERE id = ?', person.userId)?.account ?? '') : '',
    person.externalId ?? '',
    person.department,
    person.className,
    rosterSources[person.source]?.[locale] ?? person.source,
    outcomes[person.status]?.[locale] ?? person.status,
    person.status === 'completed' ? (person.confirmedMinutes ?? '') : '',
    person.status === 'completed'
      ? [person.confirmedRevisionId, person.commonRevisionId]
          .flatMap(id => (id ? (pathsByRevision.get(id) ?? []) : []))
          .join('\n')
      : '',
    person.id,
    person.status === 'completed' ? (person.confirmedRevisionId ?? '') : '',
    person.status === 'completed' ? (person.commonRevisionId ?? '') : ''
  ])
  const csv = Buffer.from(
    '\uFEFF' + [labels[locale], ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n',
    'utf8'
  )
  if (format === 'csv') return { data: csv, mime: 'text/csv; charset=utf-8' }

  const workbook = new ExcelJS.Workbook()
  workbook.creator = productNames.en
  workbook.created = new Date(snapshot.createdAt)
  const sheet = workbook.addWorksheet(locale === 'en' ? 'Participants' : '参与名单', {
    views: [{ state: 'frozen', ySplit: 1 }]
  })
  sheet.addRow(labels[locale])
  rows.forEach(row => sheet.addRow(row))
  sheet.getRow(1).font = { bold: true }
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: labels[locale].length }
  }
  sheet.columns.forEach((column, index) => {
    column.width = index === 8 ? 65 : 24
    if (index !== 7) column.numFmt = '@'
  })
  sheet.getColumn(8).numFmt = '0'
  sheet.eachRow(row => {
    row.alignment = { vertical: 'top', wrapText: true }
  })
  const metadata = workbook.addWorksheet(locale === 'en' ? 'Package' : '结果包')
  const meta = metadataLabels[locale]
  metadata.addRows([
    [meta.snapshot, snapshot.id],
    [meta.version, snapshot.version],
    [meta.supersedes, snapshot.supersedesId ?? ''],
    [meta.task, snapshot.task.title],
    [meta.created, snapshot.createdAt],
    [meta.participants, snapshot.totals.participants],
    [meta.confirmed, snapshot.totals.completed],
    [meta.confirmedMinutes, snapshot.totals.confirmedMinutes],
    [meta.template, snapshot.config.templateId],
    [meta.templateVersion, snapshot.config.templateVersion]
  ])
  metadata.columns.forEach(column => {
    column.width = 45
  })
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer())
  if (format === 'xlsx')
    return { data: xlsx, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  add('participants.csv', csv)
  add('participants.xlsx', xlsx)
  const manifest = {
    format: 'campus-completion-v1',
    locale,
    snapshotId: snapshot.id,
    version: snapshot.version,
    supersedesId: snapshot.supersedesId,
    createdAt: snapshot.createdAt,
    task: snapshot.task,
    template: snapshot.template,
    totals: snapshot.totals,
    participants: snapshot.participants.map(person => ({
      id: person.id,
      externalId: person.externalId,
      name: person.name,
      status: person.status,
      confirmedMinutes: person.status === 'completed' ? person.confirmedMinutes : null,
      confirmedRevisionId: person.status === 'completed' ? person.confirmedRevisionId : null,
      commonRevisionId: person.status === 'completed' ? person.commonRevisionId : null
    })),
    files: Object.entries(entries).map(([name, buffer]) => ({
      path: name,
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex')
    }))
  }
  add('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
  add(
    'README.txt',
    Buffer.from(
      locale === 'en'
        ? 'This package records coordinator-confirmed outcomes, not institutional credit certification. All participants remain in the roster. Only confirmed evidence versions are included. Use XLSX to preserve text IDs when opening in spreadsheet software. The manifest links evidence to people and records SHA-256 file checksums; checksums do not establish activity authenticity. Revisions supersede earlier packages explicitly.\n'
        : '本包记录负责人确认结果，不是校方学分认证。完整名单保留全部参与者，仅包含已确认版本的材料。用表格软件打开时优先选择 XLSX，以保留文本编号。manifest.json 对应人员与材料，并记录文件 SHA-256；校验值不证明活动真实性。更正结果以新版本明确替代旧包。\n',
      'utf8'
    )
  )
  const data = await new Promise<Buffer>((resolve, reject) =>
    zip(entries as Zippable, { level: 1 }, (error, result) => (error ? reject(error) : resolve(Buffer.from(result))))
  )
  return { data, mime: 'application/zip' }
}

export function registerCompletionExportRoutes(app: FastifyInstance, db: AppDatabase, sessions: SessionService) {
  app.get(
    '/api/tasks/:id/workflow/snapshots/:snapshotId/export',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: Type.Object({ id: Type.String({ maxLength: 100 }), snapshotId: Type.String({ maxLength: 100 }) }),
        querystring: Type.Object(
          {
            format: Type.Union([Type.Literal('csv'), Type.Literal('xlsx'), Type.Literal('zip')]),
            locale: Type.Optional(Type.Union([Type.Literal('zh-CN'), Type.Literal('en')]))
          },
          { additionalProperties: false }
        )
      }
    },
    async (request, reply) => {
      const actor = sessions.requireUser(request, ['teacher', 'admin'])
      const { id, snapshotId } = request.params as { id: string; snapshotId: string }
      const { format } = request.query as { format: 'csv' | 'xlsx' | 'zip'; locale?: AppLocale }
      const locale = getSchool(db).defaultLocale
      const snapshot = getWorkflowSnapshot(db, actor, id, snapshotId)
      const result = await buildCompletionExport(db, snapshot, locale, format)
      // Export generation yields for IO; recheck authority before releasing private data.
      getWorkflowSnapshot(db, sessions.requireUser(request, ['teacher', 'admin']), id, snapshotId)
      audit(db, actor.id, 'workflow.export', 'task', id, { snapshotId, format, locale })
      const title = Array.from(snapshot.task.title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g, ''))
        .slice(0, 60)
        .join('')
      const filename = `${title}_${locale === 'en' ? 'result-v' : '结果版本'}${snapshot.version}.${format}`
      const encodedFilename = encodeURIComponent(filename).replace(
        /[!'()*]/g,
        character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      )
      return reply
        .header('Content-Type', result.mime)
        .header('Content-Language', locale)
        .header(
          'Content-Disposition',
          `attachment; filename="completion-${safeId(snapshot.id)}-v${snapshot.version}.${format}"; filename*=UTF-8''${encodedFilename}`
        )
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(result.data)
    }
  )
}
