import type { ApiErrorCode, ApiFailure, ApiResponse, ApplyHandle, ConfigApplyResult } from './types'

type Translate = (key: string, params?: Record<string, unknown>) => string

const ERROR_CODE_KEYS: Record<ApiErrorCode, string> = {
  UNAUTHORIZED: 'errors.unauthorized',
  FORBIDDEN: 'errors.forbidden',
  VALIDATION: 'errors.validation',
  TIMEOUT: 'errors.timeout',
  NETWORK: 'errors.network',
  DEVICE_BUSY: 'errors.deviceBusy',
  ROLLBACK: 'errors.rollback',
  NOT_IMPLEMENTED: 'errors.notImplemented',
  INTERNAL: 'errors.internal',
}

export class ApiCallError extends Error {
  code: ApiErrorCode
  details?: unknown
  messageKey?: string

  constructor(failure: ApiFailure & { messageKey?: string }) {
    super(failure.message)
    this.name = 'ApiCallError'
    this.code = failure.code
    this.details = failure.details
    this.messageKey = failure.messageKey
  }

  get isUnsupported() {
    return this.code === 'NOT_IMPLEMENTED'
  }
}

export function unwrap<T>(res: ApiResponse<T>): T {
  if (!res.ok) throw new ApiCallError(res)
  return res.data
}

export function isUnauthorizedError(err: unknown): boolean {
  return err instanceof ApiCallError && err.code === 'UNAUTHORIZED'
}

export function toApiError(err: unknown): ApiCallError {
  if (err instanceof ApiCallError) return err
  if (err instanceof Error) {
    return new ApiCallError({
      ok: false,
      code: 'INTERNAL',
      message: err.message,
      ts: Date.now(),
    })
  }
  return new ApiCallError({
    ok: false,
    code: 'INTERNAL',
    message: '未知错误',
    messageKey: 'errors.unknown',
    ts: Date.now(),
  })
}

/** 展示层统一翻译 API 错误；有 messageKey 优先，通用 code 用 errors.*，其余回退原文。 */
export function formatApiError(err: unknown, t: Translate): string {
  const apiErr = toApiError(err)
  if (apiErr.messageKey === 'errors.httpStatus') {
    const status =
      apiErr.details && typeof apiErr.details === 'object' && 'status' in apiErr.details
        ? Number((apiErr.details as { status?: number }).status)
        : undefined
    return t('errors.httpStatus', { status: Number.isFinite(status) ? status : '' })
  }
  if (apiErr.messageKey) return t(apiErr.messageKey)
  const generic =
    apiErr.code === 'UNAUTHORIZED' ||
    apiErr.code === 'FORBIDDEN' ||
    apiErr.code === 'TIMEOUT' ||
    apiErr.code === 'NETWORK' ||
    apiErr.code === 'DEVICE_BUSY' ||
    apiErr.code === 'ROLLBACK' ||
    apiErr.code === 'NOT_IMPLEMENTED'
  if (generic) return t(ERROR_CODE_KEYS[apiErr.code])
  if (apiErr.message) return apiErr.message
  return t(ERROR_CODE_KEYS[apiErr.code] || 'errors.unknown')
}

export function asApplyHandle(result: ConfigApplyResult): ApplyHandle {
  return {
    applyId: result.taskId || `task-${Date.now()}`,
    timeoutSec: result.rollbackSec || 60,
    phase: result.phase,
  }
}
