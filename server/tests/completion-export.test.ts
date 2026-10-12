import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import { unzipSync, strFromU8 } from 'fflate'
import type { WorkflowParticipant, WorkflowSnapshot, ProofRevision } from '../../shared/workflow-contracts.js'
import { getEvidenceTemplate } from '../../shared/templates.js'
import { buildCompletionExport, csvCell } from '../modules/completion-export.js'
import { closeTestApp, createTestApp } from './helpers.js'

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
    assert.equal(sheet.getCell('B2').value, '0001')
    assert.equal(sheet.getCell('B2').type, ExcelJS.ValueType.String)
    assert.equal(sheet.getCell('C2').type, ExcelJS.ValueType.String)
    assert.equal(sheet.getCell('C2').value, snapshot.participants[0]!.name)
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
    const result = await buildCompletionExport(context.db, snapshot, 'zh-CN', 'zip')
    const entries = unzipSync(result.data)
    assert.equal(Object.keys(entries).filter(name => name.includes('/shared/')).length, 1)
    assert.equal(
      strFromU8(entries['participants.csv']!).split('evidence/shared/shared_revision/record.txt').length - 1,
      6
    )
    snapshot.participants[0]!.confirmedRevisionId = 'missing_revision'
    await assert.rejects(buildCompletionExport(context.db, snapshot, 'en', 'zip'), { code: 'EXPORT_REVISION_MISSING' })
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
