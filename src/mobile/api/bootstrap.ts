import { msg } from '@/mobile/i18n'
import { reactive } from 'vue'
import { useAuthStore } from '@/mobile/stores/auth'
import { useCatalogStore } from '@/mobile/stores/catalog'
import { useSystemStore } from '@/mobile/stores/system'
import { useTaskStore } from '@/mobile/stores/tasks'
import { errorMessage, isCancelled, onSessionBoundary, onUnauthorized, requestGeneration } from './index'

export const bootState = reactive({ ready: false, loading: false, error: '' })
let pending: Promise<boolean> | undefined
let pendingGeneration = -1
export function bootstrap(force = false): Promise<boolean> {
  // 登录/退出可能与窗口 focus 的恢复请求并发；等旧轮次结束再启动新身份的加载。
  if (pending) return pendingGeneration === requestGeneration() ? pending : pending.then(() => bootstrap(force))
  pendingGeneration = requestGeneration()
  if (bootState.ready && !force && useAuthStore().sessionReady) return Promise.resolve(true)
  bootState.loading = true
  bootState.error = ''
  pending = (async () => {
    try {
      // 先确认身份，再请求按角色裁剪的字典，避免匿名响应覆盖管理员字典。
      await useAuthStore().refreshSession()
      pendingGeneration = requestGeneration()
      await Promise.all([
        useSystemStore().fetchSchool(),
        useSystemStore().fetchInstallation(),
        useCatalogStore().fetchCatalog()
      ])
      bootState.ready = true
      return true
    } catch (error) {
      if (!isCancelled(error)) bootState.error = errorMessage(error)
      return false
    } finally {
      bootState.loading = false
      pending = undefined
    }
  })()
  return pending
}
export function initializeSessionLifecycle() {
  onSessionBoundary(() => {
    // 同时卸载旧账号页面，清理页面内的凭证/编辑草稿，不只重置 Pinia。
    bootState.ready = false
    useTaskStore().$reset()
    useCatalogStore().$reset()
    useAuthStore().accounts = { items: [], total: 0, page: 1, pageSize: 20 }
    useAuthStore().registrationRole = null
  })
  onUnauthorized(() => {
    const auth = useAuthStore()
    auth.currentUser = null
    auth.sessionReady = false
    bootState.ready = false
    bootState.error = msg('登录已失效，请重新登录')
    // 不等待自动重登录；恢复匿名 CSRF，会话失败仍保留重试入口。
    void bootstrap(true)
  })
  window.addEventListener('focus', async () => {
    if (document.visibilityState === 'hidden') return
    if (await bootstrap(true)) window.dispatchEvent(new Event('campus:refresh'))
  })
}
