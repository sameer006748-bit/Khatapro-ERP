export const PERMANENT_API_ERROR_CODES = new Set([
  'ACCOUNTING_MIGRATION_REQUIRED',
  'SCHEMA_UNAVAILABLE',
  'FEATURE_UNAVAILABLE',
  '42P01',
  '42703',
  '42883',
  'PGRST202',
  'PGRST204',
  'PGRST205',
])

type ApiErrorBody = {
  error?: unknown
  code?: unknown
  reason?: unknown
  requestId?: unknown
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null

  constructor(status: number, body: ApiErrorBody | null) {
    const code = String(body?.code ?? body?.error ?? body?.reason ?? 'REQUEST_FAILED')
    super(status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : code)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.requestId = typeof body?.requestId === 'string' ? body.requestId : null
  }
}

async function responseBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    const value = await response.json()
    return value && typeof value === 'object' ? value as ApiErrorBody : null
  } catch {
    return null
  }
}

export async function apiFetchJson<T>(
  input: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    credentials: init.credentials ?? 'same-origin',
  })
  const body = await responseBody(response)
  if (!response.ok) throw new ApiRequestError(response.status, body)
  return body as T
}

export function shouldRetryApiRequest(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false
  if (error instanceof DOMException && error.name === 'AbortError') return false
  if (error instanceof ApiRequestError) {
    if (error.status >= 400 && error.status < 500) return false
    if (PERMANENT_API_ERROR_CODES.has(error.code.toUpperCase())) return false
    return error.status >= 500
  }
  if (error && typeof error === 'object') {
    const shaped = error as { name?: unknown; status?: unknown; code?: unknown }
    if (shaped.name === 'AbortError') return false
    const status = Number(shaped.status ?? 0)
    const code = String(shaped.code ?? '').toUpperCase()
    if (status >= 400 && status < 500) return false
    if (PERMANENT_API_ERROR_CODES.has(code)) return false
    return status === 0 || status >= 500
  }
  return true
}
