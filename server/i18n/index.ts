import type { FastifyRequest } from 'fastify'
import type { AppDatabase } from '../db/database.js'
import { getSchool } from '../db/models.js'
import type { MessageParams } from '../errors.js'
import type { SessionService } from '../security/session.js'
import { translateApiMessage, type Locale } from './messages.js'
import { isInstallationConfigured } from '../installation/state.js'

export function parseAcceptLanguage(value: string | undefined): Locale | undefined {
  if (!value) return undefined
  return value.split(',').map((part, index) => {
    const [tag = '', ...parameters] = part.trim().split(';')
    const qValue = parameters.find((parameter) => parameter.trim().startsWith('q='))?.trim().slice(2)
    const quality = qValue === undefined ? 1 : Number(qValue)
    const normalized = tag.toLowerCase()
    const locale: Locale | undefined = normalized === 'en' || normalized.startsWith('en-') ? 'en'
      : normalized === 'zh' || normalized.startsWith('zh-') ? 'zh-CN' : undefined
    return { locale, quality, index }
  }).filter((item) => item.locale && Number.isFinite(item.quality) && item.quality > 0 && item.quality <= 1)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)[0]?.locale
}

export function resolveRequestLocale(request: FastifyRequest, db: AppDatabase, _sessions: SessionService): Locale {
  if (request.url.split('?')[0] === '/api/installation' && !isInstallationConfigured(db)) {
    return parseAcceptLanguage(request.headers['accept-language']) ?? getSchool(db).defaultLocale
  }
  return getSchool(db).defaultLocale
}

export function localizeApiPayload(payload: string, locale: Locale): string {
  let body: Record<string, unknown>
  try { body = JSON.parse(payload) as Record<string, unknown> } catch { return payload }
  if (!body || typeof body !== 'object' || typeof body.ok !== 'boolean' || typeof body.message !== 'string') return payload
  body.message = translateApiMessage(String(body.code ?? (body.ok ? 'SUCCESS' : 'INTERNAL_ERROR')), body.message,
    locale, (body.params ?? {}) as MessageParams, body.ok)
  // Batch review receipts are part of the error contract too. Touch only their
  // explicit {participantId, ok:false, code, message} shape, never authored fields.
  const data = body.data as { results?: unknown[] } | undefined
  if (data && Array.isArray(data.results)) {
    for (const result of data.results) {
      if (!result || typeof result !== 'object') continue
      const item = result as Record<string, unknown>
      if (typeof item.participantId === 'string' && item.ok === false && typeof item.code === 'string' && typeof item.message === 'string') {
        item.message = translateApiMessage(item.code, item.message, locale, (item.params ?? {}) as MessageParams)
      }
    }
  }
  return JSON.stringify(body)
}
