import { Type } from '@sinclair/typebox'
import type { ApiSuccess } from '../shared/contracts.js'
import { successCode } from './i18n/messages.js'

export const SuccessSchema = Type.Object({
  ok: Type.Literal(true),
  message: Type.String(),
  code: Type.Optional(Type.String()),
  data: Type.Any()
})

export const FailureSchema = Type.Object({
  ok: Type.Literal(false),
  message: Type.String(),
  code: Type.String(),
  params: Type.Optional(
    Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]))
  )
})

export const DefaultResponseSchema = {
  '2xx': SuccessSchema,
  default: FailureSchema
}

export function success<T>(data: T, message = '操作成功'): ApiSuccess<T> {
  return { ok: true, message, code: successCode(message), data }
}

export function pageNumber(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}

export const IdParamsSchema = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 100 }) },
  { additionalProperties: false }
)
