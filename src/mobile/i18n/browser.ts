import { watchEffect } from 'vue'
import { Locale as VantLocale } from 'vant'
import enUS from 'vant/es/locale/lang/en-US'
import zhCN from 'vant/es/locale/lang/zh-CN'
import { locale } from './index'

export function initializeLocale() {
  watchEffect(() => {
    document.documentElement.lang = locale.value
    document
      .querySelector('link[rel="manifest"]')
      ?.setAttribute('href', locale.value === 'en' ? '/site.en.webmanifest' : '/site.webmanifest')
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        locale.value === 'en'
          ? 'CampusTask: campus collaboration, evidence review and completion records.'
          : '校园任务通：任务发布、人员参与、材料审核与结项归档。'
      )
    VantLocale.use(locale.value === 'en' ? 'en-US' : 'zh-CN', locale.value === 'en' ? enUS : zhCN)
  })
}
