/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError, invalidateRequests, isCancelled } from '@/mobile/api'
import { reviewInBatches } from './review-batches'
import type { BatchReviewResult, ReviewRevisionInput } from '../../../shared/workflow-contracts'

const reviews = (count: number): ReviewRevisionInput[] =>
  Array.from({ length: count }, (_, index) => ({
    participantId: `p-${index}`,
    revisionId: `r-${index}`,
    version: 7,
    decision: 'approved',
    feedback: '',
    confirmedMinutes: 60
  }))

test('201 个选择分批处理，冲突行保留原版本和逐条失败，其余行不丢失', async () => {
  const batches: ReviewRevisionInput[][] = []
  const progress: number[] = []
  const inputs = reviews(201)
  const result = await reviewInBatches(
    inputs,
    async batch => {
      batches.push(batch)
      return {
        results: batch.map(item =>
          item.participantId === 'p-75'
            ? { participantId: item.participantId, ok: false, code: 'STALE_VERSION', message: 'Version changed' }
            : { participantId: item.participantId, ok: true }
        )
      }
    },
    receipt => {
      progress.push(receipt.results.length)
    },
    new AbortController().signal
  )
  assert.deepEqual(
    batches.map(batch => batch.length),
    [100, 100, 1]
  )
  assert.deepEqual(batches.flat(), inputs)
  assert.deepEqual(progress, [100, 200, 201])
  assert.equal(result.results.length, 201)
  assert.equal(result.results.filter(item => item.ok).length, 200)
  assert.deepEqual(
    result.results.filter(item => !item.ok).map(item => [item.participantId, item.code]),
    [['p-75', 'STALE_VERSION']]
  )
})

test('中途网络失败保留已成功回执，区分结果未知与尚未发出的人员', async () => {
  let calls = 0
  let receipt: BatchReviewResult = { results: [] }
  await assert.rejects(
    reviewInBatches(
      reviews(250),
      async batch => {
        if (++calls === 2) throw new ApiError('network interrupted')
        return { results: batch.map(item => ({ participantId: item.participantId, ok: true })) }
      },
      result => {
        receipt = result
      },
      new AbortController().signal
    ),
    /network interrupted/
  )
  assert.equal(calls, 2)
  assert.equal(receipt.results.length, 250)
  assert.equal(receipt.results.filter(item => item.ok).length, 100)
  assert.equal(receipt.results.filter(item => item.code === 'BATCH_RESULT_UNKNOWN').length, 100)
  assert.equal(receipt.results.filter(item => item.code === 'BATCH_NOT_SENT').length, 50)
})

test('卸载或账号边界之后不发送下一批，也不回填旧身份的结果', async () => {
  for (const boundary of ['unmount', 'session']) {
    const controller = new AbortController()
    let release!: (result: BatchReviewResult) => void
    let calls = 0
    let updates = 0
    const pending = reviewInBatches(
      reviews(101),
      () => {
        calls++
        return new Promise<BatchReviewResult>(resolve => {
          release = resolve
        })
      },
      () => {
        updates++
      },
      controller.signal
    ).catch((error: unknown) => error)
    if (boundary === 'unmount') controller.abort()
    else invalidateRequests()
    release({ results: reviews(100).map(item => ({ participantId: item.participantId, ok: true })) })
    assert.ok(isCancelled(await pending))
    assert.equal(calls, 1)
    assert.equal(updates, 0)
  }
})
