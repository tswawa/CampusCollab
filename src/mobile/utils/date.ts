import { locale, msg } from '@/mobile/i18n'
import { Temporal } from '@js-temporal/polyfill'
let schoolTimezone = 'Asia/Shanghai'
export const setSchoolTimezone = (timezone: string) => {
  schoolTimezone = timezone
}
export function zonedLocalToInstant(value: string, timezone = schoolTimezone): string | null {
  if (!value) return null
  try {
    return Temporal.PlainDateTime.from(value, { overflow: 'reject' })
      .toZonedDateTime(timezone, { disambiguation: 'reject' })
      .toInstant()
      .toString()
  } catch {
    throw new Error(msg('该本地时间无效，或因夏令时不存在或重复，请选择另一个明确时间。'))
  }
}
export function instantToLocalInput(value: string | null, timezone = schoolTimezone): string {
  if (!value) return ''
  return Temporal.Instant.from(value)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' })
}
export function dateOffset(offset = 0): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: schoolTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  const date = new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
export function formatDate(dateText: string): string {
  if (dateText === dateOffset(0)) return msg('今天')
  if (dateText === dateOffset(1)) return msg('明天')
  if (dateText === dateOffset(-1)) return msg('昨天')
  const date = new Date(`${dateText}T12:00:00Z`)
  if (!Number.isFinite(date.getTime())) return dateText
  return new Intl.DateTimeFormat(locale.value, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short'
  }).format(date)
}

export function formatTimestamp(value: string): string {
  if (!value) return '—'
  if (!/(?:Z|[+-]\d\d:\d\d)$/.test(value)) return `${value} (${schoolTimezone})`
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(locale.value, {
    timeZone: schoolTimezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date)
}
