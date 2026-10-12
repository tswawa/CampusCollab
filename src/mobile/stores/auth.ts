import { defineStore } from 'pinia'
import { invalidateRequests, request, setCsrfToken, type Query } from '@/mobile/api'
import { setSchoolTimezone } from '@/mobile/utils/date'
import { applyDefaultLocale } from '@/mobile/i18n'
import type {
  AdminAccountPayload,
  ApprovalStatus,
  CampusUser,
  PageData,
  RegistrationPayload,
  SessionData,
  UserRole
} from '@/mobile/types'

export const useAuthStore = defineStore('campus-auth', {
  state: () => ({
    currentUser: null as CampusUser | null,
    sessionReady: false,
    registrationRole: null as 'student' | 'teacher' | null,
    timezone: '',
    accounts: { items: [], total: 0, page: 1, pageSize: 20 } as PageData<CampusUser>
  }),
  getters: {
    currentUserId: state => state.currentUser?.id ?? '',
    isLoggedIn: state => state.currentUser?.approval === 'approved',
    role: (state): UserRole | undefined => state.currentUser?.role,
    users: state => state.accounts.items
  },
  actions: {
    acceptSession(session: SessionData) {
      const previous = `${this.currentUser?.id ?? ''}:${this.currentUser?.role ?? ''}`
      const next = `${session.user?.id ?? ''}:${session.user?.role ?? ''}`
      if (previous !== next) invalidateRequests()
      this.currentUser = session.user
      applyDefaultLocale(session.locale)
      this.timezone = session.timezone
      this.sessionReady = true
      setCsrfToken(session.csrfToken)
      setSchoolTimezone(session.timezone)
    },
    async refreshSession() {
      const result = await request<SessionData>('/auth/session', { key: 'session' })
      this.acceptSession(result.data)
      return result.data
    },
    async login(account: string, password: string) {
      if (!this.sessionReady) await this.refreshSession()
      const result = await request<SessionData>('/auth/login', {
        method: 'POST',
        body: { account: account.trim(), password }
      })
      // 即使重复登录同一账号，也清理全部账号专属缓存及旧请求。
      invalidateRequests()
      this.acceptSession(result.data)
      return result
    },
    async changePassword(currentPassword: string, newPassword: string) {
      const result = await request<SessionData>('/auth/password', {
        method: 'POST',
        body: { currentPassword, newPassword }
      })
      this.acceptSession(result.data)
      return result
    },
    async register(payload: RegistrationPayload) {
      if (!this.sessionReady) await this.refreshSession()
      const result = await request<null>('/auth/register', { method: 'POST', body: payload })
      this.registrationRole = payload.role
      return result
    },
    async logout() {
      await request<null>('/auth/logout', { method: 'POST', body: {} })
      invalidateRequests()
      this.currentUser = null
      this.sessionReady = false
      await this.refreshSession()
    },
    async fetchAccounts(query: Query, signal?: AbortSignal) {
      const result = await request<PageData<CampusUser>>('/admin/accounts', { query, key: 'accounts', signal })
      this.accounts = result.data
    },
    async createAccount(payload: AdminAccountPayload) {
      const { version: _version, ...body } = payload
      return request<CampusUser>('/admin/accounts', { method: 'POST', body })
    },
    async updateAccount(id: string, payload: AdminAccountPayload) {
      return request<CampusUser>(`/admin/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload })
    },
    async setAccountStatus(id: string, approval: ApprovalStatus, version: number) {
      return request<CampusUser>(`/admin/accounts/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        body: { approval, version }
      })
    },
    async resetPassword(id: string, password: string, version: number) {
      return request<CampusUser>(`/admin/accounts/${encodeURIComponent(id)}/password`, {
        method: 'POST',
        body: { password, version }
      })
    },
    async deleteAccount(id: string, version: number) {
      return request<null>(`/admin/accounts/${encodeURIComponent(id)}`, { method: 'DELETE', body: { version } })
    }
  }
})
