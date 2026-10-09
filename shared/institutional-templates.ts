import type { TemplateLocale } from './templates.js'

type LocalizedText = Record<TemplateLocale, string>
export type InstitutionalTotalPolicy = 'manual-confirmed' | 'documented-threshold' | 'original-formula'

export interface InstitutionalTemplateContract {
  id: string
  version: number
  name: LocalizedText
  compatibility: 'historical-field-mapping'
  currentInstitutionalAcceptance: 'unverified'
  maintainer: { status: 'unassigned'; name: null; reviewContact: string }
  source: {
    pageUrl: string; fileUrl: string; publishedDate: string; inspectedDate: string
    sha256: string; bytes: number; sheet: string
  }
  metadata: Array<{ key: string; cell: string; label: LocalizedText; required: true }>
  columns: Array<{ key: string; column: string; label: LocalizedText; type: 'text' | 'number'; unit?: 'hours' }>
  dataRows: { first: number; last: number; maximum: number }
  units: { input: 'minutes'; output: 'hours'; minutesPerHour: 60; rounding: 'none'; evidence: LocalizedText }
  policies: Array<{ id: InstitutionalTotalPolicy; sourceCell: string | null; description: LocalizedText }>
  ambiguities: Array<{ code: string; sourceCells: string[]; description: LocalizedText }>
  scope: LocalizedText
  fixture: string
}

const hfut2018: InstitutionalTemplateContract = {
  id: 'hfut-volunteer-hours-2018', version: 1,
  name: { 'zh-CN': '合肥工业大学 2018 志愿服务时长表（历史字段映射）', en: 'HFUT 2018 volunteer hours form (historical field mapping)' },
  compatibility: 'historical-field-mapping', currentInstitutionalAcceptance: 'unverified',
  maintainer: { status: 'unassigned', name: null, reviewContact: 'Repository template contribution review; no institutional maintainer appointed' },
  source: {
    pageUrl: 'https://gsu.hfut.edu.cn/2018/1025/c2356a186193/page.psp',
    fileUrl: 'https://gsu.hfut.edu.cn/_upload/article/files/10/cd/d04075af4e94ab2e878a12586ef6/3cd06e40-2182-4677-beb7-5b024f24418e.xlsx',
    publishedDate: '2018-10-25', inspectedDate: '2026-10-08',
    sha256: '5102bd275a962545252bf5f8b4398ba2e731a48ef6c21bcfd9e1d3539e2dab1f', bytes: 11334, sheet: 'Sheet1'
  },
  metadata: [
    { key: 'reporterName/reporterStudentNumber', cell: 'B2', label: { 'zh-CN': '填报人/学号', en: 'Reporting coordinator / student number' }, required: true },
    { key: 'reportingUnit', cell: 'E2', label: { 'zh-CN': '填报单位（盖章）', en: 'Reporting unit (official stamp)' }, required: true },
    { key: 'serviceLocation', cell: 'B3', label: { 'zh-CN': '服务地点', en: 'Service location' }, required: true },
    { key: 'serviceDate', cell: 'F3', label: { 'zh-CN': '服务日期', en: 'Service date' }, required: true },
    { key: 'travelRecord', cell: 'B4', label: { 'zh-CN': '车程记录', en: 'Round-trip travel record' }, required: true },
    { key: 'serviceTimeRange', cell: 'F4', label: { 'zh-CN': '服务时间', en: 'Service time range' }, required: true }
  ],
  columns: [
    { key: 'sequence', column: 'A', label: { 'zh-CN': '序号', en: 'Sequence' }, type: 'number' },
    { key: 'externalId', column: 'B', label: { 'zh-CN': '学号', en: 'Student number' }, type: 'text' },
    { key: 'name', column: 'C', label: { 'zh-CN': '姓名', en: 'Name' }, type: 'text' },
    { key: 'serviceHours', column: 'D', label: { 'zh-CN': '实际服务时长', en: 'Actual service hours' }, type: 'number', unit: 'hours' },
    { key: 'travelHours', column: 'E', label: { 'zh-CN': '车程时长', en: 'Travel hours' }, type: 'number', unit: 'hours' },
    { key: 'totalHours', column: 'F', label: { 'zh-CN': '总时长', en: 'Total hours under selected policy' }, type: 'number', unit: 'hours' }
  ],
  dataRows: { first: 6, last: 38, maximum: 33 },
  units: {
    input: 'minutes', output: 'hours', minutesPerHour: 60, rounding: 'none',
    evidence: { 'zh-CN': 'H1 使用小时；原表 D6 的 3.5 与 F4 的 12:30–16:00 对应。列标题本身未写单位。', en: 'H1 refers to hours; source D6 = 3.5 matches F4 = 12:30–16:00. Column headings do not state units.' }
  },
  policies: [
    { id: 'manual-confirmed', sourceCell: null, description: { 'zh-CN': '逐人明确填写总分钟数及确认依据，不替机构推导。', en: 'Explicit total minutes and an approval reference for each person.' } },
    { id: 'documented-threshold', sourceCell: 'H1', description: { 'zh-CN': '车程不少于 60 分钟才把车程的 50% 计入总时长。', en: 'Add 50% of travel only when round-trip travel is at least 60 minutes.' } },
    { id: 'original-formula', sourceCell: 'F6; F7:F38', description: { 'zh-CN': '复现原式 D6+0.5*E6，任何非负车程均折半计入。', en: 'Reproduce D6+0.5*E6: add 50% of any nonnegative travel duration.' } }
  ],
  ambiguities: [
    { code: 'TRAVEL_THRESHOLD_FORMULA_CONFLICT', sourceCells: ['H1', 'F6', 'F7:F38'], description: { 'zh-CN': '文字说明有 1 小时门槛，公式没有。必须显式选择口径并记录确认人、时间和理由。', en: 'The note has a one-hour threshold; formulas do not. Choose a policy and record who confirmed it, when and why.' } },
    { code: 'HISTORICAL_ACCEPTANCE_UNVERIFIED', sourceCells: [], description: { 'zh-CN': '仅验证 2018 原文件字段；尚无机构维护人和现行接收确认。', en: 'Only the 2018 source fields are verified. Institutional maintenance and current acceptance remain unverified.' } },
    { code: 'HOURS_UNIT_INFERRED_FROM_SOURCE', sourceCells: ['H1', 'D6', 'F4'], description: { 'zh-CN': '小时单位由说明及示例交叉核对，未出现在列标题中；导出明确标注单位并保留分钟原值。', en: 'Hours are cross-checked against the note and example, not printed in column headings. Outputs identify units and retain original minutes.' } }
  ],
  scope: { 'zh-CN': '一次活动的一日记录，至多 33 人；只做字段转换，不证明盖章、真实性、时长认定或现行学校系统接收。', en: 'One day of one activity, up to 33 people. Field conversion does not establish stamping, authenticity, recognition or acceptance by a current institutional system.' },
  fixture: 'docs/templates/hfut-2018.anonymous.json'
}

/** Return copies: callers cannot mutate the registered version used by later conversions. */
export function getInstitutionalTemplate(id: string, version: number): InstitutionalTemplateContract | undefined {
  return id === hfut2018.id && version === hfut2018.version ? structuredClone(hfut2018) : undefined
}

export function listInstitutionalTemplates(): InstitutionalTemplateContract[] { return [structuredClone(hfut2018)] }

export interface InstitutionalTemplateMetadata {
  reporterName: string
  reporterStudentNumber: string
  reportingUnit: string
  serviceLocation: string
  serviceDate: string
  travelRecord: string
  serviceTimeRange: string
}

export interface InstitutionalTemplateRowInput {
  participantId: string
  externalId: string
  name: string
  confirmedMinutes: number
  travelMinutes: number
  sourceReference: string
  travelSourceReference: string
  manualTotalMinutes?: number
  manualTotalSourceReference?: string
}

export interface InstitutionalTemplateInput {
  templateId: string
  templateVersion: number
  metadata: InstitutionalTemplateMetadata
  metadataSourceReference: string
  totalPolicy: InstitutionalTotalPolicy
  policyConfirmation: { confirmedBy: string; confirmedAt: string; reason: string; acknowledgedAmbiguity: true }
  rows: InstitutionalTemplateRowInput[]
}

export interface InstitutionalTemplateRowOutput {
  targetRow: number
  participantId: string
  values: [number, string, string, number, number, number]
  original: InstitutionalTemplateRowInput
  totalMinutes: number
  totalSourceReference: string
  originalFormula: string
}

export interface InstitutionalTemplateOutput {
  templateId: string
  templateVersion: number
  compatibility: InstitutionalTemplateContract['compatibility']
  currentInstitutionalAcceptance: 'unverified'
  source: InstitutionalTemplateContract['source']
  metadata: InstitutionalTemplateMetadata
  headers: string[]
  cells: Record<string, string | number>
  rows: InstitutionalTemplateRowOutput[]
  originalInput: InstitutionalTemplateInput
  policy: { id: InstitutionalTotalPolicy; confirmation: InstitutionalTemplateInput['policyConfirmation'] }
  unit: 'hours'
  warnings: InstitutionalTemplateContract['ambiguities']
}

export class InstitutionalTemplateError extends Error {
  constructor(readonly code: string, readonly field: string) {
    super(`${code}: ${field}`)
    this.name = 'InstitutionalTemplateError'
  }
}

function requiredText(value: unknown, field: string, limit = 2000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /\u0000/.test(value)) {
    throw new InstitutionalTemplateError('TEMPLATE_TEXT_REQUIRED', field)
  }
}

function duration(value: unknown, field: string, allowHalf = false): asserts value is number {
  // This historical form covers one day. Whole input minutes retain the workflow's precision.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1440 || !Number.isInteger(value * (allowHalf ? 2 : 1))) {
    throw new InstitutionalTemplateError('TEMPLATE_MINUTES_INVALID', field)
  }
}

/** Pure, deterministic mapping. No database, network, implicit policy, identity binding or official recognition. */
export function convertInstitutionalTemplate(input: InstitutionalTemplateInput): InstitutionalTemplateOutput {
  const contract = getInstitutionalTemplate(input?.templateId, input?.templateVersion)
  if (!contract) throw new InstitutionalTemplateError('TEMPLATE_VERSION_UNSUPPORTED', 'templateId/templateVersion')
  if (!contract.policies.some(p => p.id === input.totalPolicy)) throw new InstitutionalTemplateError('TEMPLATE_POLICY_REQUIRED', 'totalPolicy')
  const confirmation = input.policyConfirmation
  if (confirmation?.acknowledgedAmbiguity !== true) throw new InstitutionalTemplateError('TEMPLATE_AMBIGUITY_ACK_REQUIRED', 'policyConfirmation')
  requiredText(confirmation.confirmedBy, 'policyConfirmation.confirmedBy')
  requiredText(confirmation.reason, 'policyConfirmation.reason')
  if (typeof confirmation.confirmedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(confirmation.confirmedAt) || !Number.isFinite(Date.parse(confirmation.confirmedAt)) || new Date(confirmation.confirmedAt).toISOString().replace('.000Z', 'Z') !== confirmation.confirmedAt.replace('.000Z', 'Z')) {
    throw new InstitutionalTemplateError('TEMPLATE_CONFIRMATION_DATE_INVALID', 'policyConfirmation.confirmedAt')
  }
  const meta = input.metadata
  for (const key of ['reporterName', 'reporterStudentNumber', 'reportingUnit', 'serviceLocation', 'serviceDate', 'travelRecord', 'serviceTimeRange'] as const) {
    requiredText(meta?.[key], `metadata.${key}`)
  }
  requiredText(input.metadataSourceReference, 'metadataSourceReference')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.serviceDate) || !Number.isFinite(Date.parse(`${meta.serviceDate}T00:00:00Z`)) || new Date(`${meta.serviceDate}T00:00:00Z`).toISOString().slice(0, 10) !== meta.serviceDate) {
    throw new InstitutionalTemplateError('TEMPLATE_SERVICE_DATE_INVALID', 'metadata.serviceDate')
  }
  const times = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(meta.serviceTimeRange)
  if (!times || Number(times[1]) * 60 + Number(times[2]) >= Number(times[3]) * 60 + Number(times[4])) {
    throw new InstitutionalTemplateError('TEMPLATE_SINGLE_DAY_REQUIRED', 'metadata.serviceTimeRange')
  }
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > contract.dataRows.maximum) {
    throw new InstitutionalTemplateError('TEMPLATE_ROW_COUNT_INVALID', 'rows')
  }
  const participantIds = new Set<string>()
  const externalIds = new Set<string>()
  const rows = input.rows.map((row, index): InstitutionalTemplateRowOutput => {
    const field = `rows[${index}]`
    for (const key of ['participantId', 'externalId', 'name', 'sourceReference', 'travelSourceReference'] as const) requiredText(row?.[key], `${field}.${key}`)
    if (participantIds.has(row.participantId) || externalIds.has(row.externalId)) throw new InstitutionalTemplateError('TEMPLATE_DUPLICATE_ID', field)
    participantIds.add(row.participantId); externalIds.add(row.externalId)
    duration(row.confirmedMinutes, `${field}.confirmedMinutes`)
    duration(row.travelMinutes, `${field}.travelMinutes`)
    let totalMinutes: number
    let totalSourceReference: string
    if (input.totalPolicy === 'manual-confirmed') {
      duration(row.manualTotalMinutes, `${field}.manualTotalMinutes`, true)
      requiredText(row.manualTotalSourceReference, `${field}.manualTotalSourceReference`)
      totalMinutes = row.manualTotalMinutes
      totalSourceReference = row.manualTotalSourceReference
    } else {
      if (row.manualTotalMinutes !== undefined || row.manualTotalSourceReference !== undefined) throw new InstitutionalTemplateError('TEMPLATE_UNUSED_MANUAL_TOTAL', field)
      totalMinutes = row.confirmedMinutes + (input.totalPolicy === 'original-formula' || row.travelMinutes >= 60 ? row.travelMinutes / 2 : 0)
      totalSourceReference = `${contract.source.fileUrl}#${input.totalPolicy === 'documented-threshold' ? 'Sheet1!H1' : 'Sheet1!F6'}`
    }
    const targetRow = contract.dataRows.first + index
    return {
      targetRow, participantId: row.participantId,
      values: [index + 1, row.externalId, row.name, row.confirmedMinutes / 60, row.travelMinutes / 60, totalMinutes / 60],
      original: structuredClone(row), totalMinutes, totalSourceReference,
      // Evidence text only. Writers must not execute this formula for another selected policy.
      originalFormula: `D${targetRow}+0.5*E${targetRow}`
    }
  })
  const headers = contract.columns.map(c => c.label['zh-CN'])
  const cells: Record<string, string | number> = {
    A1: '志愿服务时长登记表', A2: '填报人/学号', B2: `${meta.reporterName}/${meta.reporterStudentNumber}`,
    D2: '填报单位（盖章）', E2: meta.reportingUnit, A3: '服务地点', B3: meta.serviceLocation,
    E3: '服务日期', F3: meta.serviceDate, A4: '车程记录', B4: meta.travelRecord,
    E4: '服务时间', F4: meta.serviceTimeRange
  }
  contract.columns.forEach((column, index) => { cells[`${column.column}5`] = headers[index] })
  rows.forEach(row => row.values.forEach((value, index) => { cells[`${contract.columns[index].column}${row.targetRow}`] = value }))
  return {
    templateId: contract.id, templateVersion: contract.version,
    compatibility: contract.compatibility, currentInstitutionalAcceptance: contract.currentInstitutionalAcceptance,
    source: contract.source, metadata: structuredClone(meta), headers, cells, rows, originalInput: structuredClone(input),
    policy: { id: input.totalPolicy, confirmation: structuredClone(confirmation) }, unit: 'hours', warnings: contract.ambiguities
  }
}
