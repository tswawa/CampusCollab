import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import { unzipSync, strFromU8 } from 'fflate'
import type { WorkflowParticipant, WorkflowSnapshot, ProofRevision } from '../../shared/workflow-contracts.js'
import { getEvidenceTemplate } from '../../shared/templates.js'
import { seedWorkflowDemo } from '../demo/workflow-seed.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'
import { buildCompletionExport, csvCell } from '../modules/completion-export.js'
import { closeTestApp, createTestApp, login } from './helpers.js'

const revision = (id: string, description: string): ProofRevision => ({
  id,
  participantId: 'member:task:user',
  revision: id === 'legacy:old' ? 1 : 2,
  scope: 'personal',
  description,
  note: '',
  fileIds: [],
  images: [],
  reportedMinutes: 90,
  submittedBy: 'user',
  submittedAt: '2026-10-01T12:00:00Z',
  sourceRevisionId: null,
  changedFields: ['description'],
  reviews: []
})
function fixture(): WorkflowSnapshot {
  const participants: WorkflowParticipant[] = Array.from({ length: 8 }, (_, index) => ({
    id: index === 0 ? 'member:task:user' : `person_${index}`,
    taskId: 'task_demo',
    userId: null,
    externalId: `000${index + 1}`,
    source: 'fictional-roster',
    name: index === 0 ? '=HYPERLINK("https://invalid.example")' : `Person ${index + 1}`,
    department: 'Community',
    className: '',
    status: index < 6 ? 'completed' : 'incomplete',
    version: 3,
    latestRevisionId: index < 6 ? `revision_${index}` : null,
    confirmedRevisionId: index < 6 ? `revision_${index}` : null,
    commonRevisionId: null,
    reportedMinutes: index < 6 ? 120 : null,
    confirmedMinutes: index < 5 ? 90 : index === 5 ? 75 : null,
    feedback: '',
    missingItems: [],
    joinedAt: '2026-10-01T10:00:00Z',
    revisions:
      index < 6
        ? [
            revision('legacy:old', 'obsolete material must not be exported'),
            {
              ...revision(`revision_${index}`, 'accepted activity record'),
              participantId: index === 0 ? 'member:task:user' : `person_${index}`
            }
          ]
        : [],
    reviews: []
  }))
  return {
    id: 'snapshot_demo',
    taskId: 'task_demo',
    version: 1,
    supersedesId: null,
    reason: 'Fictional fixture',
    createdAt: '2026-10-01T13:00:00Z',
    createdBy: 'coordinator',
    task: {
      title: 'Community Garden',
      ownerId: 'coordinator',
      originalOwnerId: 'coordinator',
      startAt: '2026-10-01T10:00:00Z',
      endAt: '2026-10-01T12:00:00Z'
    },
    config: {
      templateId: 'community-garden',
      templateVersion: 1,
      mode: 'individual',
      plannedMinutes: 120,
      submissionDeadline: null,
      personalSubmissionRequired: true,
      status: 'closed',
      version: 1
    },
    template: getEvidenceTemplate('community-garden', 1) as unknown as Record<string, unknown>,
    participants,
    commonRevisions: [],
    totals: { participants: 8, completed: 6, confirmedMinutes: 525, byStatus: { completed: 6, incomplete: 2 } }
  }
}

test('completion package preserves all eight people, only approved revisions and 525 confirmed minutes', async () => {
  const context = await createTestApp()
  try {
    const snapshot = fixture()
    const student = await createAdminManagedUser(context.db, {
      role: 'student',
      account: '00001234',
      name: 'Linked participant',
      departmentId: 'dept-cs',
      gradeId: 'grade-2024',
      classId: 'class-24se1',
      approval: 'approved',
      password: 'Campus@123'
    })
    snapshot.participants[0]!.userId = student.id
    snapshot.participants[0]!.source = 'account'
    snapshot.participants[1]!.source = 'import'
    const result = await buildCompletionExport(context.db, snapshot, 'en', 'zip')
    const entries = unzipSync(result.data)
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!))
    assert.deepEqual(manifest.totals, snapshot.totals)
    assert.equal(manifest.participants.length, 8)
    const evidence = Object.keys(entries).filter(name => name.startsWith('evidence/'))
    assert.equal(evidence.length, 6)
    assert.ok(evidence.every(name => !name.includes(':') && !name.includes('..') && !name.includes('legacy')))
    assert.ok(evidence.every(name => strFromU8(entries[name]!).includes('accepted activity record')))
    assert.ok(Object.values(entries).every(data => !strFromU8(data).includes('obsolete material')))
    for (const file of manifest.files) {
      assert.equal(createHash('sha256').update(entries[file.path]!).digest('hex'), file.sha256)
    }
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      Buffer.from(entries['participants.xlsx']!) as unknown as Parameters<typeof workbook.xlsx.load>[0]
    )
    const sheet = workbook.getWorksheet('Participants')!
    assert.equal(sheet.rowCount, 9)
    assert.deepEqual(sheet.getRow(1).values, [
      ,
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
    ])
    assert.equal(sheet.getCell('A2').type, ExcelJS.ValueType.String)
    assert.equal(sheet.getCell('A2').value, snapshot.participants[0]!.name)
    assert.equal(sheet.getCell('B2').value, student.account)
    assert.equal(sheet.getCell('B2').type, ExcelJS.ValueType.String)
    assert.equal(sheet.getCell('B3').value, '')
    assert.equal(sheet.getCell('C2').value, '0001')
    assert.equal(sheet.getCell('C2').type, ExcelJS.ValueType.String)
    assert.equal(sheet.getCell('F2').value, 'Account sign-up')
    assert.equal(sheet.getCell('F3').value, 'Imported roster')
    assert.equal(sheet.getCell('I2').value, evidence[0])
    assert.equal(sheet.getCell('J2').value, snapshot.participants[0]!.id)
    assert.equal(sheet.getCell('K2').value, snapshot.participants[0]!.confirmedRevisionId)
    assert.equal(sheet.getCell('H8').value, '')
    assert.equal(workbook.getWorksheet('Package')!.getCell('B8').value, 525)
    const csv = strFromU8(entries['participants.csv']!)
    assert.match(csv, /'=?HYPERLINK/)
    assert.match(csv, /"0001"/)
  } finally {
    await closeTestApp(context)
  }
})

test('shared evidence is stored once and linked to each confirmed participant; missing versions fail closed', async () => {
  const context = await createTestApp()
  try {
    const snapshot = fixture()
    snapshot.commonRevisions = [
      { ...revision('shared_revision', 'Common garden evidence'), scope: 'common', participantId: null }
    ]
    snapshot.participants.slice(0, 6).forEach(person => {
      person.commonRevisionId = 'shared_revision'
    })
    snapshot.participants[0]!.source = 'account'
    snapshot.participants[1]!.source = 'import'
    const result = await buildCompletionExport(context.db, snapshot, 'zh-CN', 'zip')
    const entries = unzipSync(result.data)
    assert.equal(Object.keys(entries).filter(name => name.includes('/shared/')).length, 1)
    assert.equal(
      strFromU8(entries['participants.csv']!).split('evidence/shared/shared_revision/record.txt').length - 1,
      6
    )
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      Buffer.from(entries['participants.xlsx']!) as unknown as Parameters<typeof workbook.xlsx.load>[0]
    )
    assert.equal(workbook.getWorksheet('参与名单')!.getCell('F2').value, '账号报名')
    assert.equal(workbook.getWorksheet('参与名单')!.getCell('F3').value, '名单导入')
    assert.deepEqual(workbook.getWorksheet('结果包')!.getColumn(1).values, [
      ,
      '结果版本 ID',
      '版本',
      '取代的版本',
      '任务',
      '创建时间',
      '参与人数',
      '已确认人数',
      '确认分钟数',
      '模板',
      '模板版本'
    ])
    snapshot.participants[0]!.confirmedRevisionId = 'missing_revision'
    await assert.rejects(buildCompletionExport(context.db, snapshot, 'en', 'zip'), { code: 'EXPORT_REVISION_MISSING' })
  } finally {
    await closeTestApp(context)
  }
})

test('completion export headers include an ASCII fallback and a localized task-title filename', async () => {
  const context = await createTestApp()
  try {
    const teacher = await createAdminManagedUser(context.db, {
      role: 'teacher',
      account: 'EXPORTTEACH',
      name: 'Export coordinator',
      departmentId: 'dept-cs',
      approval: 'approved',
      password: 'Campus@123'
    })
    const { taskId, snapshot } = seedWorkflowDemo(context.db, teacher)
    const session = await login(context, teacher.account, 'Campus@123')
    for (const locale of ['zh-CN', 'en'] as const) {
      context.db.run('UPDATE school_settings SET default_locale = ? WHERE id = 1', locale)
      const response = await context.app.inject({
        method: 'GET',
        url: `/api/tasks/${taskId}/workflow/snapshots/${snapshot.id}/export?format=csv`,
        headers: { cookie: session.cookie }
      })
      assert.equal(response.statusCode, 200, response.body)
      const disposition = String(response.headers['content-disposition'])
      assert.ok(disposition.includes(`filename="completion-${snapshot.id}-v${snapshot.version}.csv"`))
      assert.ok(disposition.includes("filename*=UTF-8''"))
      assert.equal(
        decodeURIComponent(disposition.split("filename*=UTF-8''")[1]!),
        `${snapshot.task.title}_${locale === 'en' ? 'result-v' : '结果版本'}${snapshot.version}.csv`
      )
    }
  } finally {
    await closeTestApp(context)
  }
})

test('CSV formula-like values are escaped without turning identifiers into executable formulas', () => {
  for (const text of ['=1+1', '+SUM(A1)', '-5+1', '@SUM(A1)', '  =1+1', '\t1+1', '\r1+1'])
    assert.ok(csvCell(text).startsWith('"\''))
  assert.equal(csvCell('0001'), '"0001"')
  assert.equal(csvCell('张 A, "B"'), '"张 A, ""B"""')
})

test('completion packages reject more than 5000 participants before preparing evidence', async () => {
  const context = await createTestApp()
  try {
    const snapshot = fixture()
    snapshot.participants = Array.from({ length: 5001 }, () => snapshot.participants[0]!)
    await assert.rejects(buildCompletionExport(context.db, snapshot, 'en', 'zip'), { code: 'EXPORT_TOO_LARGE' })
  } finally {
    await closeTestApp(context)
  }
})
