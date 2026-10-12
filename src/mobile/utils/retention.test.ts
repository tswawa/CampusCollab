/// <reference types="node" />
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { setLocale } from '../i18n'
import { retentionBlockers, retentionBlockerLabel, retentionStatus } from './retention'

afterEach(() => setLocale('zh-CN', false))

test('expired tasks with references or mail are blocked rather than reported as not due', () => {
  setLocale('en', false)
  for (const code of ['RETENTION_CROSS_TASK_REFERENCE', 'RETENTION_MAIL_IN_FLIGHT', 'RETENTION_LEGACY_NOTICES']) {
    assert.equal(retentionStatus({ eligible: false, blockers: [{ code, count: 1 }] }), 'Deletion is blocked')
  }
  assert.equal(
    retentionStatus({ eligible: false, blockers: [{ code: 'RETENTION_NOT_DUE', count: 1 }] }),
    'Retention period has not elapsed'
  )
  assert.equal(
    retentionStatus({ eligible: false, blockers: [{ code: 'RETENTION_TASK_OPEN', count: 1 }] }),
    'Task is still open'
  )
  assert.equal(retentionStatus({ eligible: true, blockers: [] }), 'Eligible for deletion')
})

test('blockers retain every reference count and readable copy in each language', () => {
  const merged = retentionBlockers([
    { code: 'RETENTION_CROSS_TASK_REFERENCE', count: 2 },
    { code: 'RETENTION_CROSS_TASK_REFERENCE', count: 3 }
  ])
  assert.deepEqual(merged, [{ code: 'RETENTION_CROSS_TASK_REFERENCE', count: 5 }])
  assert.match(retentionBlockerLabel(merged[0]!), /5 处/)
  setLocale('en', false)
  assert.match(retentionBlockerLabel(merged[0]!), /5 references/)
  assert.match(retentionBlockerLabel({ code: 'UNRECOGNIZED_BLOCKER', count: 1 }), /administrator/)
})
