import { defineStore } from 'pinia'
import { request, type Query } from '@/mobile/api'
import type { CampusTask, CreateTaskPayload, DashboardData, NoticePage, PageData, ReviewItem } from '@/mobile/types'
import type { TaskWorkflow } from '../../../shared/workflow-contracts'
const emptyPage = <T>(): PageData<T> => ({ items: [], total: 0, page: 1, pageSize: 20 })

export const useTaskStore = defineStore('campus-tasks', {
  state: () => ({
    taskPage: emptyPage<CampusTask>(),
    details: {} as Record<string, CampusTask>,
    dashboard: null as DashboardData | null,
    reviews: emptyPage<ReviewItem>(),
    noticePage: { ...emptyPage<NoticePage['items'][number]>(), unreadCount: 0 } as NoticePage
  }),
  getters: {
    tasks: (state) => state.taskPage.items,
    notices: (state) => state.noticePage.items,
    taskById: (state) => (id: string) => state.details[id] ?? state.taskPage.items.find((task) => task.id === id),
    unreadCount: (state) => state.noticePage.unreadCount
  },
  actions: {
    forgetTask(id: string) {
      delete this.details[id]
      const listed = this.taskPage.items.some(task => task.id === id)
      this.taskPage.items = this.taskPage.items.filter(task => task.id !== id)
      if (listed) this.taskPage.total = Math.max(0, this.taskPage.total - 1)
      const removedReviews = this.reviews.items.filter(item => item.task.id === id).length
      this.reviews.items = this.reviews.items.filter(item => item.task.id !== id)
      this.reviews.total = Math.max(0, this.reviews.total - removedReviews)
      this.dashboard = null
    },
    cacheTask(task: CampusTask) {
      this.details[task.id] = task
      const index = this.taskPage.items.findIndex((item) => item.id === task.id)
      if (index >= 0) this.taskPage.items[index] = task
    },
    async fetchTasks(query: Query = {}, signal?: AbortSignal) {
      const result = await request<PageData<CampusTask>>('/tasks', { query, signal, key: 'tasks' })
      this.taskPage = result.data
    },
    async fetchTask(id: string, signal?: AbortSignal) {
      const result = await request<CampusTask>(`/tasks/${encodeURIComponent(id)}`, { signal, key: `task:${id}` })
      this.cacheTask(result.data)
      return result.data
    },
    async fetchDashboard(signal?: AbortSignal) {
      const result = await request<DashboardData>('/dashboard', { signal, key: 'dashboard' })
      this.dashboard = result.data
    },
    async fetchReviews(query: Query = {}, signal?: AbortSignal) {
      const result = await request<PageData<ReviewItem>>('/reviews', { query, signal, key: 'reviews' })
      this.reviews = result.data
    },
    async fetchNotices(query: Query = {}, signal?: AbortSignal) {
      const result = await request<NoticePage>('/notices', { query, signal, key: 'notices' })
      this.noticePage = result.data
    },
    async markNoticeRead(id: string) { return request<null>(`/notices/${encodeURIComponent(id)}/read`, { method: 'POST', body: {} }) },
    async markAllNoticesRead() { return request<null>('/notices/read-all', { method: 'POST', body: {} }) },
    async createTask(payload: CreateTaskPayload, copyFrom?: string) {
      const result = await request<CampusTask>(copyFrom ? `/tasks/${encodeURIComponent(copyFrom)}/copy` : '/tasks', { method: 'POST', body: copyFrom ? { task: payload } : payload })
      this.cacheTask(result.data)
      return result.data
    },
    async updateTask(id: string, payload: Partial<CreateTaskPayload> & { version: number }) {
      const result = await request<CampusTask>(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload })
      this.cacheTask(result.data)
      return result
    },
    async action(id: string, action: string, body: unknown = {}) {
      const result = await request<CampusTask>(`/tasks/${encodeURIComponent(id)}/${action}`, { method: 'POST', body })
      this.cacheTask(result.data)
      return result
    },
    claimTask(id: string) { return this.action(id, 'claim') },
    cancelClaim(id: string) { return this.action(id, 'withdraw') },
    startTask(id: string) { return this.action(id, 'start') },
    cancelTask(id: string, version: number) { return this.action(id, 'cancel', { version }) },
    restoreTask(id: string, version: number) { return this.action(id, 'restore', { version }) },
    approveApplication(id: string, userId: string, version: number) { return this.action(id, 'approve', { userId, version }) },
    inviteStudent(id: string, userId: string, version: number) { return this.action(id, 'invite', { userId, version }) },
    submitProof(id: string, proof: { description: string; note: string; fileIds: string[]; version: number }) { return this.action(id, 'proof', proof) },
    async reviewSubmission(id: string, userId: string, approved: boolean, feedback: string, version: number, confirmedMinutes?: number) {
      const current = await request<TaskWorkflow>(`/tasks/${encodeURIComponent(id)}/workflow`)
      const participant = current.data.participants.find(p => p.userId === userId)
      const result = await request<TaskWorkflow>(`/tasks/${encodeURIComponent(id)}/workflow/review`, { method: 'POST', body: { participantId: participant?.id, version, revisionId: participant?.latestRevisionId, decision: approved ? 'approved' : 'changes_requested', feedback, ...(approved ? { confirmedMinutes } : {}) } })
      await this.fetchTask(id)
      return result
    }
  }
})
