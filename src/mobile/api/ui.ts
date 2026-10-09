import { onBeforeUnmount, onMounted, ref, watch, type WatchSource } from 'vue'
import { showToast } from 'vant'
import { errorMessage, isCancelled, requestGeneration } from './index'

// 所有入口 GET 都在这里捕获错误；错误状态可重试，不伪造空列表成功。
export function useLoad(loader: (signal: AbortSignal) => Promise<unknown>, sources: WatchSource[] = []) {
  const loading = ref(false)
  const error = ref('')
  const ready = ref(false)
  let controller: AbortController | undefined
  let sequence = 0
  let disposed = false
  async function reload() {
    if (disposed) return
    const id = ++sequence
    controller?.abort()
    controller = new AbortController()
    loading.value = true
    ready.value = false
    error.value = ''
    try {
      await loader(controller.signal)
      if (id === sequence && !disposed) ready.value = true
    } catch (cause) {
      if (id === sequence && !disposed && !isCancelled(cause)) error.value = errorMessage(cause)
    } finally {
      if (id === sequence && !disposed) loading.value = false
    }
  }
  const refresh = () => { void reload() }
  onMounted(refresh)
  if (sources.length) watch(sources, refresh)
  window.addEventListener('campus:refresh', refresh)
  onBeforeUnmount(() => {
    disposed = true
    sequence++
    controller?.abort()
    window.removeEventListener('campus:refresh', refresh)
  })
  return { loading, error, ready, reload }
}

// 操作成功才提示、关闭；失败草稿保留。串行防止双击及旧账号完成后跳转。
export function useMutation(onError?: (cause: unknown) => void) {
  const busy = ref(false)
  const error = ref('')
  let disposed = false
  let controller: AbortController | undefined
  const cancel = () => controller?.abort()
  onBeforeUnmount(() => { disposed = true; cancel() })
  async function run<T>(action: (signal: AbortSignal) => Promise<T>, success?: (result: T) => void, message?: string) {
    if (busy.value || disposed) return false
    const epoch = requestGeneration()
    busy.value = true
    error.value = ''
    const activeController = new AbortController()
    controller = activeController
    try {
      const result = await action(activeController.signal)
      if (disposed || activeController.signal.aborted || epoch !== requestGeneration()) return false
      if (message) showToast(message)
      success?.(result)
      window.dispatchEvent(new Event('campus:refresh'))
      return true
    } catch (cause) {
      if (!disposed && !activeController.signal.aborted && !isCancelled(cause)) {
        onError?.(cause)
        error.value = errorMessage(cause)
        showToast(error.value)
      }
      return false
    } finally { busy.value = false; controller = undefined }
  }
  return { busy, error, run, cancel }
}

export function usePagination(filters: WatchSource[] = []) {
  const page = ref(1)
  const pageSize = 20
  if (filters.length) watch(filters, () => { page.value = 1 }, { flush: 'sync' })
  return { page, pageSize }
}
