import { msg } from '@/mobile/i18n'
import { defineStore } from 'pinia'
import { request } from '@/mobile/api'
import type { CatalogData, CatalogKind } from '@/mobile/types'

interface CatalogPayload { name?: string; code?: string; departmentId?: string; gradeId?: string; enabled?: boolean; version?: number }
export const useCatalogStore = defineStore('campus-catalog', {
  state: (): CatalogData => ({ departments: [], grades: [], classes: [], campuses: [], taskCategories: [] }),
  getters: {
    activeDepartments: (state) => state.departments.filter((item) => item.enabled),
    activeGrades: (state) => state.grades.filter((item) => item.enabled),
    activeClasses: (state) => state.classes.filter((item) => item.enabled && state.departments.some((d) => d.id === item.departmentId && d.enabled) && state.grades.some((g) => g.id === item.gradeId && g.enabled)),
    activeCampuses: (state) => state.campuses.filter((item) => item.enabled),
    activeTaskCategories: (state) => state.taskCategories.filter((item) => item.enabled),
    departmentNameById: (state) => (id: string) => state.departments.find((item) => item.id === id)?.name ?? msg("未设置学院"),
    gradeNameById: (state) => (id: string) => state.grades.find((item) => item.id === id)?.name ?? msg("未设置年级"),
    classesFor: (state) => (departmentId: string, gradeId?: string) => state.classes.filter((item) => item.enabled && item.departmentId === departmentId && (!gradeId || item.gradeId === gradeId))
  },
  actions: {
    async fetchCatalog(signal?: AbortSignal) {
      const result = await request<CatalogData>('/catalog', { key: 'catalog', signal })
      this.$patch(result.data)
    },
    async saveItem(kind: CatalogKind, payload: CatalogPayload, id?: string) {
      return request<unknown>(`/admin/catalog/${kind}${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PATCH' : 'POST', body: payload })
    },
    async removeItem(kind: CatalogKind, id: string, version: number) {
      return request<null>(`/admin/catalog/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE', body: { version } })
    }
  }
})
