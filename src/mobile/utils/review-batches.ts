import { ApiError, isCancelled, requestGeneration } from '@/mobile/api'
import { msg } from '@/mobile/i18n'
import type { BatchReviewResult, ReviewRevisionInput } from '../../../shared/workflow-contracts'

// Preserve the selected versions across batches. A conflict never silently retries a newer revision.
export async function reviewInBatches(
  items: ReviewRevisionInput[],
  submit: (batch: ReviewRevisionInput[], signal: AbortSignal) => Promise<BatchReviewResult>,
  progress: (result: BatchReviewResult) => void,
  signal: AbortSignal
): Promise<BatchReviewResult> {
  const epoch = requestGeneration()
  const results: BatchReviewResult['results'] = []
  const assertActive = () => {
    if (signal.aborted || requestGeneration() !== epoch) throw new ApiError(msg('请求已取消'), 'CANCELLED')
  }
  for (let offset = 0; offset < items.length; offset += 100) {
    assertActive()
    const batch = items.slice(offset, offset + 100)
    let response: BatchReviewResult
    try {
      response = await submit(batch, signal)
      assertActive()
    } catch (cause) {
      if (isCancelled(cause) || signal.aborted || requestGeneration() !== epoch) throw cause
      // A failed response can follow committed writes. Keep those outcomes distinct from unsent rows.
      results.push(...batch.map(item => ({ participantId: item.participantId, ok: false, code: 'BATCH_RESULT_UNKNOWN', message: msg('处理结果未确认，请刷新核对。') })))
      results.push(...items.slice(offset + batch.length).map(item => ({ participantId: item.participantId, ok: false, code: 'BATCH_NOT_SENT', message: msg('尚未处理') })))
      progress({ results: [...results] })
      throw cause
    }
    const receipts = new Map(response.results.map(result => [result.participantId, result]))
    results.push(...batch.map(item => receipts.get(item.participantId) ?? ({ participantId: item.participantId, ok: false, code: 'BATCH_RESULT_UNKNOWN', message: msg('处理结果未确认，请刷新核对。') })))
    progress({ results: [...results] })
  }
  return { results }
}
