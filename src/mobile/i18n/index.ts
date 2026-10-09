import { ref } from 'vue'
import { english } from './en'

export type Locale = 'zh-CN' | 'en'
export type MessageKey = keyof typeof english
export const locale = ref<Locale>('zh-CN')
// The institution owns the edition. Browser preferences never override it.
// The second argument remains compatible with internal callers during upgrades.
export function setLocale(value: Locale, _persist = false) {
  locale.value = value
}
export function applyDefaultLocale(value?: string) {
  if (value === 'en' || value === 'zh-CN') setLocale(value)
}
export function msg(key: MessageKey, params: Record<string, unknown> = {}): string {
  const template = locale.value === 'en' ? english[key] : key
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    return typeof value === 'number' ? formatNumber(value) : String(value ?? '')
  })
}
export function knownMessage(key: string): string {
  return key in english ? msg(key as MessageKey) : key
}
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale.value, options).format(value)
}
export const resourceKeys = Object.keys(english) as MessageKey[]
export { english }
