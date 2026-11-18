import type { ApiErrorCode, ApiFailure, ApiResponse, ApiResult } from './types'

const DEFAULT_TIMEOUT_MS = 15_000

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  token?: string | null
  timeoutMs?: number
}

function failure(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
  messageKey?: string,
): ApiFailure {
  return { ok: false, code, message, details, messageKey, ts: Date.now() }
}

function success<T>(data: T): ApiResult<T> {
  return { ok: true, data, ts: Date.now() }
}

export async function requestJson<T>(
  url: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, token, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: 'same-origin',
    })
    clearTimeout(timer)

    if (res.status === 401) {
      return failure('UNAUTHORIZED', '会话无效或已过期，请重新登录', undefined, 'errors.unauthorized')
    }
    if (res.status === 403) {
      return failure('FORBIDDEN', '当前账号无权限执行此操作', undefined, 'errors.forbidden')
    }
    if (!res.ok) {
      let message = `设备接口异常 (${res.status})`
      try {
        const errBody = (await res.json()) as { message?: string; code?: string }
        if (errBody.message) message = errBody.message
        if (['VALIDATION', 'DEVICE_BUSY', 'NOT_IMPLEMENTED', 'TIMEOUT'].includes(errBody.code || '')) {
          return failure(errBody.code as ApiErrorCode, message, undefined)
        }
        if (errBody.code === 'TIMEOUT') {
          return failure('TIMEOUT', message, errBody, 'errors.timeout')
        }
      } catch {
        /* ignore */
      }
      return failure('INTERNAL', message, { status: res.status }, 'errors.httpStatus')
    }

    const payload = (await res.json()) as ApiResponse<T>
    if (typeof payload === 'object' && payload !== null && 'ok' in payload) {
      return payload
    }
    return success(payload as T)
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof DOMException && err.name === 'AbortError') {
      return failure('TIMEOUT', '请求超时，请检查设备连接', undefined, 'errors.timeout')
    }
    return failure('NETWORK', '无法连接设备管理接口', undefined, 'errors.network')
  }
}

export async function requestForm<T>(
  url: string,
  body: FormData,
  timeoutMs = 120_000,
): Promise<ApiResponse<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      body,
      signal: controller.signal,
      credentials: 'same-origin',
    })
    clearTimeout(timer)
    if (res.status === 401) {
      return failure('UNAUTHORIZED', '会话无效或已过期，请重新登录', undefined, 'errors.unauthorized')
    }
    if (res.status === 403) {
      return failure('FORBIDDEN', '当前账号无权限执行此操作', undefined, 'errors.forbidden')
    }
    if (!res.ok) {
      return failure('INTERNAL', `设备接口异常 (${res.status})`, { status: res.status }, 'errors.httpStatus')
    }
    const payload = (await res.json()) as T
    return success(payload)
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof DOMException && err.name === 'AbortError') {
      return failure('TIMEOUT', '请求超时，请检查设备连接', undefined, 'errors.timeout')
    }
    return failure('NETWORK', '无法连接设备管理接口', undefined, 'errors.network')
  }
}

export { failure, success }
