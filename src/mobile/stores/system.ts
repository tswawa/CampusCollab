import { defineStore } from 'pinia'
import { request } from '@/mobile/api'
import type { InstallationStatus, SchoolProfile } from '@/mobile/types'
import { applyDefaultLocale } from '@/mobile/i18n'
import { setSchoolTimezone } from '@/mobile/utils/date'

function mixColor(color: string, target: number, ratio: number) {
  return '#' + [1, 3, 5].map((offset) => Math.round(parseInt(color.slice(offset, offset + 2), 16) * (1 - ratio) + target * ratio).toString(16).padStart(2, '0')).join('')
}
export const useSystemStore = defineStore('campus-system', {
  state: () => ({
    // 仅为空缓存，App 在 schoolReady 之前不呈现业务页。
    school: { name: '', platformName: '', logo: '', badge: '', announcement: '', primaryColor: '', version: 0, timezone: '' } as SchoolProfile,
    schoolReady: false,
    installation: null as InstallationStatus | null
  }),
  actions: {
    async fetchInstallation() {
      const result = await request<InstallationStatus>('/installation', { key: 'installation' })
      this.installation = result.data
    },
    async fetchSchool(signal?: AbortSignal) {
      const result = await request<SchoolProfile>('/school', { key: 'school', signal })
      this.school = result.data
      applyDefaultLocale(this.school.defaultLocale)
      setSchoolTimezone(this.school.timezone)
      this.schoolReady = true
      this.applyTheme()
    },
    async updateSchool(payload: Omit<SchoolProfile, 'logo'> & { logoFileId?: string }) {
      // A read profile includes a display-only logo URL; write only supported fields.
      const { name, platformName, badge, announcement, primaryColor, version, timezone, defaultLocale,
        registrationEnabled, requireDepartment, requireGrade, requireClass, allowExternalParticipants,
        retentionDays, logoFileId } = payload
      const result = await request<SchoolProfile>('/admin/school', { method: 'PUT', body: {
        name, platformName, badge, announcement, primaryColor, version, timezone, defaultLocale,
        registrationEnabled, requireDepartment, requireGrade, requireClass, allowExternalParticipants,
        retentionDays, logoFileId
      } })
      this.school = result.data
      applyDefaultLocale(this.school.defaultLocale)
      setSchoolTimezone(this.school.timezone)
      this.applyTheme()
      return result
    },
    async exportData() { return request<unknown>('/admin/export') },
    applyTheme() {
      if (!this.schoolReady || !/^#[0-9a-f]{6}$/i.test(this.school.primaryColor)) return
      const color = this.school.primaryColor
      const root = document.documentElement
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
      root.style.setProperty('--brand', color)
      root.style.setProperty('--brand-dark', mixColor(color, 0, 0.2))
      root.style.setProperty('--brand-soft', mixColor(color, 255, 0.93))
      root.style.setProperty('--brand-border', mixColor(color, 255, 0.76))
      root.style.setProperty('--brand-light', mixColor(color, 255, 0.88))
    }
  }
})
