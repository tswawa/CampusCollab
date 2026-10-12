import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  convertInstitutionalTemplate,
  getInstitutionalTemplate,
  InstitutionalTemplateError,
  listInstitutionalTemplates,
  type InstitutionalTemplateInput
} from '../../shared/institutional-templates.js'
import { getEvidenceTemplate } from '../../shared/templates.js'

const fixture = JSON.parse(
  readFileSync(new URL('../../docs/templates/hfut-2018.anonymous.json', import.meta.url), 'utf8')
)
const input = (): InstitutionalTemplateInput => structuredClone(fixture.input)
const code = (expected: string) => (error: unknown) =>
  error instanceof InstitutionalTemplateError && error.code === expected

test('generic evidence and real historical field contracts have separate compatibility claims', () => {
  assert.equal(getEvidenceTemplate('generic-practice', 1)?.source.compatibility, 'generic')
  const contract = getInstitutionalTemplate('hfut-volunteer-hours-2018', 1)!
  assert.equal(contract.compatibility, 'historical-field-mapping')
  assert.equal(contract.currentInstitutionalAcceptance, 'unverified')
  assert.equal(contract.maintainer.status, 'unassigned')
  assert.equal(contract.source.sha256, fixture.expected.sourceSha256)
  assert.equal(contract.source.publishedDate, '2018-10-25')
  assert.equal(contract.source.sheet, 'Sheet1')
  assert.equal(contract.metadata.length, 6)
  assert.equal(contract.columns.length, 6)
  assert.deepEqual(contract.dataRows, { first: 6, last: 38, maximum: 33 })
  assert.equal(getInstitutionalTemplate(contract.id, 2), undefined)
  assert.equal(getInstitutionalTemplate('unverified-school', 1), undefined)
  contract.source.sha256 = 'changed by caller'
  listInstitutionalTemplates()[0].columns.length = 0
  assert.equal(getInstitutionalTemplate(contract.id, 1)?.source.sha256, fixture.expected.sourceSha256)
  assert.equal(listInstitutionalTemplates()[0].columns.length, 6)
})

test('anonymous golden fixture maps exact historical columns, metadata, text identities and original provenance', () => {
  const original = input()
  const result = convertInstitutionalTemplate(original)
  assert.equal(result.compatibility, fixture.expected.compatibility)
  assert.equal(result.currentInstitutionalAcceptance, fixture.expected.currentInstitutionalAcceptance)
  assert.equal(result.unit, fixture.expected.unit)
  assert.deepEqual(result.headers, fixture.expected.headers)
  assert.deepEqual(
    result.rows.map(({ targetRow, participantId, values, totalMinutes }) => ({
      targetRow,
      participantId,
      values,
      totalMinutes
    })),
    fixture.expected.rows
  )
  for (const [cell, value] of Object.entries(fixture.expected.metadataCells)) assert.equal(result.cells[cell], value)
  assert.equal(result.cells.B6, '000001')
  assert.equal(result.cells.F6, 2)
  assert.equal(result.cells.F7, 2)
  assert.deepEqual(
    result.warnings.map(w => w.code),
    fixture.expected.warningCodes
  )
  assert.deepEqual(result.originalInput, original)
  assert.deepEqual(result.rows[0].original, original.rows[0])
  assert.equal(result.rows[0].originalFormula, 'D6+0.5*E6')
  assert.ok(result.rows[0].totalSourceReference.endsWith('#Sheet1!H1'))
  assert.deepEqual(result.policy.confirmation, original.policyConfirmation)
  result.originalInput.rows[0].travelMinutes = 999
  result.rows[0].original.externalId = 'mutated'
  result.metadata.reportingUnit = 'mutated'
  result.policy.confirmation.reason = 'mutated'
  assert.deepEqual(original, fixture.input)
})

test('explicit historical formula and manual totals produce independent golden values, including manual zero', () => {
  const formula = input()
  formula.totalPolicy = 'original-formula'
  const result = convertInstitutionalTemplate(formula)
  assert.deepEqual(
    result.rows.map(row => row.totalMinutes),
    fixture.expected.originalFormulaTotalsMinutes
  )
  assert.equal(result.rows[0].values[5], 2.25)
  assert.ok(result.rows[0].totalSourceReference.endsWith('#Sheet1!F6'))
  const manual = input()
  manual.totalPolicy = 'manual-confirmed'
  manual.rows.forEach((row, i) => {
    row.manualTotalMinutes = fixture.expected.manualConfirmedTotalsMinutes[i]
    row.manualTotalSourceReference = `fictional:approval/${i}`
  })
  const confirmed = convertInstitutionalTemplate(manual)
  assert.deepEqual(
    confirmed.rows.map(row => row.totalMinutes),
    [125.5, 0]
  )
  assert.equal(confirmed.rows[1].values[5], 0)
  assert.equal(confirmed.rows[0].totalSourceReference, 'fictional:approval/0')
})

test('threshold boundaries retain half minutes without silently rounding hours', () => {
  const value = input()
  const cases = [
    { travel: 0, total: 120 },
    { travel: 30, total: 120 },
    { travel: 59, total: 120 },
    { travel: 60, total: 150 },
    { travel: 61, total: 150.5 }
  ]
  for (const { travel, total } of cases) {
    value.rows[0].travelMinutes = travel
    const result = convertInstitutionalTemplate(value).rows[0]
    assert.equal(result.totalMinutes, total)
    assert.equal(result.values[5], total / 60)
    assert.equal(result.original.travelMinutes, travel)
  }
  value.totalPolicy = 'original-formula'
  value.rows[0].travelMinutes = 59
  assert.equal(convertInstitutionalTemplate(value).rows[0].totalMinutes, 149.5)
})

test('policy, ambiguity acknowledgment and dated actor confirmation have no implicit defaults', () => {
  const value = input()
  for (const policy of [undefined, null, '', 'automatic']) {
    assert.throws(
      () => convertInstitutionalTemplate({ ...value, totalPolicy: policy } as unknown as InstitutionalTemplateInput),
      code('TEMPLATE_POLICY_REQUIRED')
    )
  }
  for (const confirmation of [undefined, { ...value.policyConfirmation, acknowledgedAmbiguity: false }]) {
    assert.throws(
      () => convertInstitutionalTemplate({ ...value, policyConfirmation: confirmation } as InstitutionalTemplateInput),
      code('TEMPLATE_AMBIGUITY_ACK_REQUIRED')
    )
  }
  for (const key of ['confirmedBy', 'reason'] as const) {
    const invalid = input()
    invalid.policyConfirmation[key] = ' '
    assert.throws(() => convertInstitutionalTemplate(invalid), code('TEMPLATE_TEXT_REQUIRED'))
  }
  for (const date of ['', '2026-02-30T08:00:00Z', '2026-10-08', '2026-10-08T16:00:00+08:00']) {
    const invalid = input()
    invalid.policyConfirmation.confirmedAt = date
    assert.throws(() => convertInstitutionalTemplate(invalid), code('TEMPLATE_CONFIRMATION_DATE_INVALID'))
  }
  value.templateVersion = 2
  assert.throws(() => convertInstitutionalTemplate(value), code('TEMPLATE_VERSION_UNSUPPORTED'))
})

test('missing travel is never zero; nonnumeric, negative, fractional and out-of-day minutes fail', () => {
  for (const key of ['confirmedMinutes', 'travelMinutes'] as const) {
    for (const minutes of [undefined, null, '', '60', -1, 1.5, Number.NaN, Infinity, 1441]) {
      const invalid = input()
      Object.assign(invalid.rows[0], { [key]: minutes })
      assert.throws(() => convertInstitutionalTemplate(invalid), code('TEMPLATE_MINUTES_INVALID'))
    }
  }
  const value = input()
  value.rows[0].travelMinutes = 0
  assert.equal(convertInstitutionalTemplate(value).rows[0].values[4], 0)
  const missingSource = input()
  missingSource.rows[0].travelSourceReference = ''
  assert.throws(() => convertInstitutionalTemplate(missingSource), code('TEMPLATE_TEXT_REQUIRED'))
})

test('manual confirmation requires a value and source; other policies reject unnoticed manual overrides', () => {
  const value = input()
  value.totalPolicy = 'manual-confirmed'
  assert.throws(() => convertInstitutionalTemplate(value), code('TEMPLATE_MINUTES_INVALID'))
  value.rows[0].manualTotalMinutes = 120
  assert.throws(() => convertInstitutionalTemplate(value), code('TEMPLATE_TEXT_REQUIRED'))
  value.rows[0].manualTotalSourceReference = 'fictional:approval'
  value.rows[0].manualTotalMinutes = 120.25
  assert.throws(() => convertInstitutionalTemplate(value), code('TEMPLATE_MINUTES_INVALID'))
  value.totalPolicy = 'documented-threshold'
  assert.throws(() => convertInstitutionalTemplate(value), code('TEMPLATE_UNUSED_MANUAL_TOTAL'))
})

test('duplicate identities fail, same names remain separate, and numeric student IDs are not coerced', () => {
  const value = input()
  value.rows[1].name = value.rows[0].name
  assert.equal(convertInstitutionalTemplate(value).rows.length, 2)
  for (const key of ['externalId', 'participantId'] as const) {
    const invalid = input()
    invalid.rows[1][key] = invalid.rows[0][key]
    assert.throws(() => convertInstitutionalTemplate(invalid), code('TEMPLATE_DUPLICATE_ID'))
  }
  Object.assign(value.rows[0], { externalId: 1 })
  assert.throws(() => convertInstitutionalTemplate(value), code('TEMPLATE_TEXT_REQUIRED'))
})

test('required metadata, real calendar days, same-day time ranges and original row capacity are enforced', () => {
  for (const key of Object.keys(input().metadata)) {
    const value = input()
    Object.assign(value.metadata, { [key]: '' })
    assert.throws(() => convertInstitutionalTemplate(value), code('TEMPLATE_TEXT_REQUIRED'))
  }
  for (const date of ['2026-02-29', '2026-10-8', '2026-13-01']) {
    const value = input()
    value.metadata.serviceDate = date
    assert.throws(() => convertInstitutionalTemplate(value), code('TEMPLATE_SERVICE_DATE_INVALID'))
  }
  const leap = input()
  leap.metadata.serviceDate = '2028-02-29'
  assert.equal(convertInstitutionalTemplate(leap).cells.F3, '2028-02-29')
  for (const range of ['23:00-01:00', '10:00-10:00', '10:00-24:00', '2026-10-08/2026-10-09']) {
    const value = input()
    value.metadata.serviceTimeRange = range
    assert.throws(() => convertInstitutionalTemplate(value), code('TEMPLATE_SINGLE_DAY_REQUIRED'))
  }
  const capacity = input()
  capacity.rows = Array.from({ length: 33 }, (_, i) => ({
    ...capacity.rows[0],
    participantId: `fictional:p${i}`,
    externalId: `${i}`
  }))
  assert.equal(convertInstitutionalTemplate(capacity).rows[32].targetRow, 38)
  capacity.rows.push({ ...capacity.rows[0], participantId: 'fictional:extra', externalId: 'extra' })
  assert.throws(() => convertInstitutionalTemplate(capacity), code('TEMPLATE_ROW_COUNT_INVALID'))
  capacity.rows = []
  assert.throws(() => convertInstitutionalTemplate(capacity), code('TEMPLATE_ROW_COUNT_INVALID'))
})
