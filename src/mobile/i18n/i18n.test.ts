/// <reference types="node" />
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { computed } from 'vue'
import { applyDefaultLocale, english, locale, msg, resourceKeys, setLocale } from './index'
import { instantToLocalInput, setSchoolTimezone, zonedLocalToInstant, formatTimestamp } from '../utils/date'
import { memberStatusMeta, proofTypeLabels } from '../utils/task'
afterEach(() => { setLocale('zh-CN', false); setSchoolTimezone('Asia/Shanghai') })

test('all bilingual resources preserve interpolation parameters and have English copy', () => {
  assert.ok(resourceKeys.length > 500)
  const parameters = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
  for (const key of resourceKeys) {
    assert.deepEqual(parameters(english[key]), parameters(key), key)
    assert.equal(/[\u3400-\u9fff]/.test(english[key]), false, key)
  }
})
test('institution edition changes are reactive without changing role or status identifiers', () => {
  const state = { role: 'teacher', status: 'changes_requested' as const }
  const label = computed(() => memberStatusMeta[state.status].label)
  assert.equal(label.value, '待补正')
  setLocale('en', false)
  assert.equal(label.value, 'Changes requested')
  assert.equal(msg('教师'), 'Coordinator')
  assert.equal(proofTypeLabels.image, 'Photos')
  assert.equal(state.role, 'teacher'); assert.equal(state.status, 'changes_requested')
  assert.equal(msg('共 {p0} 项', { p0: 1000 }), '1,000 items')
})
test('institution locale overrides any earlier browser or session locale', () => {
  setLocale('en', true)
  applyDefaultLocale('zh-CN')
  assert.equal(locale.value, 'zh-CN')
  applyDefaultLocale('en')
  assert.equal(msg('教师'), 'Coordinator')
  applyDefaultLocale('invalid')
  assert.equal(locale.value, 'en')
})
test('institution wall time maps to the same instant in both languages', () => {
  const value = '2026-10-08T14:30'
  const instant = zonedLocalToInstant(value, 'America/New_York')
  assert.equal(instant, '2026-10-08T18:30:00Z')
  setLocale('en', false)
  assert.equal(zonedLocalToInstant(value, 'America/New_York'), instant)
  assert.equal(instantToLocalInput(instant, 'America/New_York'), value)
  setSchoolTimezone('America/New_York')
  assert.match(formatTimestamp(instant!), /2026/)
  assert.equal(locale.value, 'en')
})
test('missing, repeated and invalid local times are rejected with localized feedback', () => {
  setLocale('en', false)
  for (const value of ['2026-03-08T02:30', '2026-11-01T01:30', '2026-02-30T10:00']) {
    assert.throws(() => zonedLocalToInstant(value, 'America/New_York'), /daylight saving time/)
  }
  assert.equal(zonedLocalToInstant('', 'America/New_York'), null)
})
