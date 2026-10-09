export type MessageParams = Record<string, string | number | boolean | null>

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly params: MessageParams = {}
  ) {
    super(message)
  }
}

export function assertCondition(condition: unknown, statusCode: number, code: string, message: string, params: MessageParams = {}): asserts condition {
  if (!condition) throw new AppError(statusCode, code, message, params)
}
