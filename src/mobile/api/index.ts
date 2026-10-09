import { locale, msg } from '@/mobile/i18n'
import type { ApiResult, ApiSuccess, UploadData } from '@/mobile/types'

export class ApiError extends Error {
  constructor(message: string, public code = 'NETWORK_ERROR', public status = 0) {
    super(message)
    this.name = 'ApiError'
  }
}
export type Query = Record<string, string | number | boolean | undefined>
let csrfToken = ''
let generation = 0
let unauthorized: (() => void) | undefined
const controllers = new Set<AbortController>()
const keyedRequests = new Map<string, AbortController>()
const resetListeners = new Set<() => void>()
export const requestGeneration = () => generation
export const setCsrfToken = (token: string) => { csrfToken = token }
export const onUnauthorized = (handler: () => void) => { unauthorized = handler }
export const onSessionBoundary = (handler: () => void) => {
  resetListeners.add(handler)
  return () => resetListeners.delete(handler)
}
export function invalidateRequests() {
  generation += 1
  csrfToken = ''
  controllers.forEach((controller) => controller.abort())
  controllers.clear()
  keyedRequests.clear()
  resetListeners.forEach((handler) => handler())
}
export const isCancelled = (error: unknown) => error instanceof ApiError && error.code === 'CANCELLED'
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return msg('请求失败，请重试')
  if (locale.value === 'en' && /[\u3400-\u9fff]/.test(error.message)) return `${msg('请求失败，请重试')}${error instanceof ApiError ? ` (${error.code})` : ''}`
  return error.message
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Query
  key?: string
  signal?: AbortSignal
  timeout?: number
}

export function request<T>(path: string, options: RequestOptions = {}): Promise<ApiSuccess<T>> {
  return managedRequest<ApiSuccess<T>>(path, options, 'json')
}

export function requestBlob(path: string, options: Pick<RequestOptions, 'query' | 'key' | 'signal' | 'timeout'> = {}): Promise<Blob> {
  return managedRequest<Blob>(path, options, 'blob')
}

async function managedRequest<T>(path: string, options: RequestOptions, format: 'json' | 'blob'): Promise<T> {
  const method = options.method ?? 'GET'
  const epoch = generation
  const controller = new AbortController()
  if (options.key) {
    keyedRequests.get(options.key)?.abort()
    keyedRequests.set(options.key, controller)
  }
  controllers.add(controller)
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) controller.abort()
  let timedOut = false
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, options.timeout ?? 20000)
  try {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') params.set(key, String(value))
    }
    const headers: Record<string, string> = { Accept: format === 'blob' ? '*/*' : 'application/json', 'Accept-Language': locale.value }
    const formData = options.body instanceof FormData
    if (method !== 'GET') {
      if (!csrfToken) throw new ApiError(msg("会话尚未就绪，请刷新后重试"), 'CSRF_MISSING', 403)
      headers['X-CSRF-Token'] = csrfToken
      if (!formData) headers['Content-Type'] = 'application/json'
    }
    const response = await fetch(`/api${path}${params.size ? `?${params}` : ''}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      body: method === 'GET' ? undefined : formData ? options.body as FormData : JSON.stringify(options.body ?? {}),
      signal: controller.signal
    })
    if (epoch !== generation || controller.signal.aborted) throw new ApiError(msg("请求已取消"), 'CANCELLED')
    if (response.status === 401) {
      invalidateRequests()
      unauthorized?.()
      throw new ApiError(msg("登录已失效，请重新登录"), 'UNAUTHORIZED', 401)
    }
    if (format === 'blob' && response.ok) {
      const blob = await response.blob()
      if (epoch !== generation || controller.signal.aborted) throw new ApiError(msg("请求已取消"), 'CANCELLED')
      return blob as T
    }
    let payload: ApiResult<unknown>
    try { payload = await response.json() as ApiResult<unknown> }
    catch (cause) {
      if (controller.signal.aborted) throw cause
      throw new ApiError(msg("暂时无法处理请求，请稍后重试"), 'INVALID_RESPONSE', response.status)
    }
    if (!payload || typeof payload !== 'object' || typeof payload.ok !== 'boolean' || (payload.ok && !('data' in payload))) {
      throw new ApiError(msg("暂时无法处理请求，请稍后重试"), 'INVALID_RESPONSE', response.status)
    }
    if (epoch !== generation || controller.signal.aborted) throw new ApiError(msg("请求已取消"), 'CANCELLED')
    if (!response.ok || payload.ok !== true) {
      const raw = payload.ok === false ? payload.message : ''
      const message = raw && !(locale.value === 'en' && /[\u3400-\u9fff]/.test(raw)) ? raw : msg('请求失败，请重试')
      const hint = response.status === 409 ? msg("请刷新最新数据后重试，表单内容已保留。") : response.status === 403 ? msg("请确认账号权限或刷新会话后重试。") : ''
      throw new ApiError(`${message}${hint ? ` ${hint}` : ''}`, payload.ok === false ? payload.code : 'HTTP_ERROR', response.status)
    }
    if (locale.value === 'en' && /[\u3400-\u9fff]/.test(payload.message)) payload.message = msg('已保存')
    return payload as T
  } catch (error) {
    if (timedOut) throw new ApiError(msg("请求超时，请重试；提交类操作请先刷新确认结果"), 'TIMEOUT')
    if (error instanceof ApiError) throw error
    if (controller.signal.aborted || epoch !== generation) throw new ApiError(msg("请求已取消"), 'CANCELLED')
    throw new ApiError(msg("连接失败，请检查网络后重试"))
  } finally {
    window.clearTimeout(timeout)
    controllers.delete(controller)
    if (options.key && keyedRequests.get(options.key) === controller) keyedRequests.delete(options.key)
    options.signal?.removeEventListener('abort', abort)
  }
}

export async function uploadFile(kind: 'proof' | 'logo', file: File, taskId?: string, signal?: AbortSignal) {
  const maximum = kind === 'logo' ? 2 : 10
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new ApiError(msg("仅支持 JPEG、PNG、WebP 图片"), 'INVALID_FILE')
  if (file.size > maximum * 1024 * 1024) throw new ApiError(msg("图片不能超过 {p0}MB", { p0: maximum }), 'INVALID_FILE')
  const body = new FormData()
  body.append('file', file)
  return request<UploadData>(`/files/${kind}`, { method: 'POST', body, query: { taskId }, signal, timeout: 60000 })
}
