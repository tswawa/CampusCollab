/// <reference types="node" />
// 独立请求层单元测试，fetch 为可控桩；不替代真实后端联调或浏览器业务验收。
import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import {
  ApiError,
  invalidateRequests,
  isCancelled,
  onSessionBoundary,
  onUnauthorized,
  request,
  requestBlob,
  setCsrfToken,
  uploadFile
} from './index'
import { setLocale } from '../i18n'

const originalFetch = globalThis.fetch
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
Object.defineProperty(globalThis, 'window', { value: { setTimeout, clearTimeout }, configurable: true })
const success = (data: unknown = null) => Response.json({ ok: true, message: '成功', data })
beforeEach(() => {
  setLocale('zh-CN', false)
  invalidateRequests()
  setCsrfToken('test-csrf')
  onUnauthorized(() => {})
})
after(() => {
  globalThis.fetch = originalFetch
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

test('JSON 写操作携带同源 Cookie、CSRF 和 JSON 请求体，不手设 Origin', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), '/api/admin/accounts/u1')
    assert.equal(options?.credentials, 'same-origin')
    assert.equal(options?.method, 'DELETE')
    assert.equal(options?.body, '{"version":7}')
    const headers = new Headers(options?.headers)
    assert.equal(headers.get('X-CSRF-Token'), 'test-csrf')
    assert.equal(headers.get('Content-Type'), 'application/json')
    assert.equal(headers.has('Origin'), false)
    return success()
  }
  assert.equal((await request('/admin/accounts/u1', { method: 'DELETE', body: { version: 7 } })).ok, true)
})

test('GET 仅传服务端筛选与分页参数', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), '/api/tasks?keyword=%E6%B5%8B%E8%AF%95&mine=true&page=2&pageSize=20')
    assert.equal(options?.body, undefined)
    assert.equal(new Headers(options?.headers).has('X-CSRF-Token'), false)
    return success({ items: [], total: 0, page: 2, pageSize: 20 })
  }
  await request('/tasks', { query: { keyword: '测试', mine: true, page: 2, pageSize: 20, status: undefined } })
})

test('English requests declare their locale and never show an unknown Chinese server error', async () => {
  setLocale('en', false)
  globalThis.fetch = async (_url, options) => {
    assert.equal(new Headers(options?.headers).get('Accept-Language'), 'en')
    return Response.json({ ok: false, message: '未知的中文错误', code: 'UNRECOGNIZED_EVENT' }, { status: 400 })
  }
  await assert.rejects(
    request('/unknown'),
    (error: unknown) =>
      error instanceof ApiError && error.code === 'UNRECOGNIZED_EVENT' && !/[\u3400-\u9fff]/.test(error.message)
  )
})

test('multipart 上传由浏览器生成 Content-Type boundary', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), '/api/files/proof?taskId=t1')
    assert.equal(new Headers(options?.headers).has('Content-Type'), false)
    assert.equal(new Headers(options?.headers).get('X-CSRF-Token'), 'test-csrf')
    assert.ok(options?.body instanceof FormData)
    assert.equal([...options.body.keys()].join(','), 'file')
    return success({ id: 'f1', url: '/api/files/f1' })
  }
  assert.equal((await uploadFile('proof', new File(['image'], 'proof.png', { type: 'image/png' }), 't1')).data.id, 'f1')
})

test('缺少 CSRF 不发送写请求', async () => {
  setCsrfToken('')
  globalThis.fetch = async () => {
    assert.fail('不应发起请求')
  }
  await assert.rejects(
    request('/auth/login', { method: 'POST' }),
    (error: unknown) => error instanceof ApiError && error.code === 'CSRF_MISSING'
  )
})

test('403 与 409 保留中文错误并提示权限/刷新，不转换成成功', async () => {
  for (const status of [403, 409]) {
    globalThis.fetch = async () => Response.json({ ok: false, message: '操作被拒绝', code: 'CONFLICT' }, { status })
    await assert.rejects(
      request('/tasks/t1', { method: 'PATCH', body: { version: 1 } }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === status &&
        error.message.includes(status === 409 ? '表单内容已保留' : '账号权限')
    )
  }
})

test('更晚的同键请求淘汰旧响应，即使网络实现忽略 abort', async () => {
  let release!: (response: Response) => void
  let calls = 0
  globalThis.fetch = async () =>
    ++calls === 1
      ? new Promise<Response>(resolve => {
          release = resolve
        })
      : success('new')
  const first = request('/tasks', { key: 'tasks' }).catch((error: unknown) => error)
  assert.equal((await request('/tasks', { key: 'tasks' })).data, 'new')
  release(success('old'))
  assert.ok(isCancelled(await first))
})

test('账号边界清理缓存监听器并禁止旧账号响应回填', async () => {
  let release!: (response: Response) => void
  let cleared = 0
  const remove = onSessionBoundary(() => {
    cleared++
  })
  globalThis.fetch = async () =>
    new Promise<Response>(resolve => {
      release = resolve
    })
  const pending = request('/dashboard').catch((error: unknown) => error)
  invalidateRequests()
  release(success('previous-account'))
  assert.ok(isCancelled(await pending))
  assert.equal(cleared, 1)
  remove()
})

test('401 即使没有 JSON 也注销会话并清理缓存', async () => {
  let loggedOut = 0
  let cleared = 0
  const remove = onSessionBoundary(() => {
    cleared++
  })
  onUnauthorized(() => {
    loggedOut++
  })
  globalThis.fetch = async () => new Response('expired', { status: 401 })
  await assert.rejects(request('/dashboard'), (error: unknown) => error instanceof ApiError && error.status === 401)
  assert.equal(loggedOut, 1)
  assert.equal(cleared, 1)
  remove()
})

test('超时明确失败，不回退演示数据', async () => {
  globalThis.fetch = async (_url, options) =>
    new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
        once: true
      })
    })
  await assert.rejects(
    request('/school', { timeout: 5 }),
    (error: unknown) => error instanceof ApiError && error.code === 'TIMEOUT'
  )
})

test('非 JSON 和不完整成功响应不成为正常数据', async () => {
  for (const response of [new Response('<html>offline</html>'), Response.json(null), Response.json({ ok: true })]) {
    globalThis.fetch = async () => response
    await assert.rejects(
      request('/school'),
      (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESPONSE'
    )
  }
})

test('二进制结果包仍携带机构语言和同源会话，并返回原始字节', async () => {
  setLocale('en')
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), '/api/tasks/t1/workflow/snapshots/s1/export?format=csv')
    assert.equal(options?.credentials, 'same-origin')
    assert.equal(new Headers(options?.headers).get('Accept-Language'), 'en')
    assert.ok(options?.signal)
    return new Response('Name,Minutes\nAlex,60', { headers: { 'Content-Type': 'text/csv' } })
  }
  const blob = await requestBlob('/tasks/t1/workflow/snapshots/s1/export', { query: { format: 'csv' } })
  assert.equal(blob.type, 'text/csv')
  assert.equal(await blob.text(), 'Name,Minutes\nAlex,60')
})

test('已收到响应但尚未读完的结果包在账号边界后被取消', async () => {
  let release!: (blob: Blob) => void
  let started!: () => void
  const bodyStarted = new Promise<void>(resolve => {
    started = resolve
  })
  let signal: AbortSignal | null | undefined
  globalThis.fetch = async (_url, options) => {
    signal = options?.signal
    const response = new Response('unused')
    response.blob = () => {
      started()
      return new Promise<Blob>(resolve => {
        release = resolve
      })
    }
    return response
  }
  const pending = requestBlob('/export').catch((error: unknown) => error)
  await bodyStarted
  invalidateRequests()
  release(new Blob(['previous account']))
  assert.ok(signal?.aborted)
  assert.ok(isCancelled(await pending))
})

test('结果包下载支持调用方卸载取消和超时恢复', async () => {
  globalThis.fetch = async (_url, options) =>
    new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
        once: true
      })
    })
  const controller = new AbortController()
  const pending = requestBlob('/export', { signal: controller.signal }).catch((error: unknown) => error)
  controller.abort()
  assert.ok(isCancelled(await pending))
  await assert.rejects(
    requestBlob('/export', { timeout: 5 }),
    (error: unknown) => error instanceof ApiError && error.code === 'TIMEOUT'
  )
})

test('结果包失权响应保留真实错误，401 同样清理会话', async () => {
  globalThis.fetch = async () =>
    Response.json({ ok: false, message: '只能操作本人负责的任务', code: 'TASK_FORBIDDEN' }, { status: 403 })
  await assert.rejects(
    requestBlob('/export'),
    (error: unknown) => error instanceof ApiError && error.status === 403 && error.code === 'TASK_FORBIDDEN'
  )
  let loggedOut = false
  onUnauthorized(() => {
    loggedOut = true
  })
  globalThis.fetch = async () => new Response('expired', { status: 401 })
  await assert.rejects(requestBlob('/export'), (error: unknown) => error instanceof ApiError && error.status === 401)
  assert.ok(loggedOut)
})
