import 'server-only'
import { NextResponse } from 'next/server'

/**
 * Minimal server-only API observability: request timing, a request/trace ID,
 * and slow-request warnings. Emits structured JSON logs with only safe,
 * non-sensitive fields — never payloads, PII, SQL, amounts, or stack traces.
 */

const REQUEST_ID_HEADER = 'x-request-id'
const MAX_REQUEST_ID_LEN = 128
const requestIds = new WeakMap<Request, string>()
// Allow only safe token chars so a caller-supplied ID can't inject into logs.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/

const SLOW_MS = 500
const CRITICAL_MS = 1000

type Severity = 'normal' | 'slow' | 'critical' | 'error'
type ErrorCategory =
  | 'unauthorized'
  | 'forbidden'
  | 'validation'
  | 'database'
  | 'internal'

function environment(): string {
  return process.env.NODE_ENV || 'development'
}

function isDev(): boolean {
  return environment() !== 'production'
}

/**
 * Whether to log a normal (fast, successful) request. Off by default in every
 * environment; opt in with OBSERVABILITY_LOG_NORMAL=true. Dev additionally logs
 * normal requests unless explicitly disabled.
 */
function shouldLogNormal(): boolean {
  const flag = process.env.OBSERVABILITY_LOG_NORMAL
  if (flag === 'true') return true
  if (flag === 'false') return false
  return isDev()
}

export function newRequestId(): string {
  return globalThis.crypto.randomUUID()
}

export function resolveRequestId(req?: Request): string {
  if (req) {
    const existing = requestIds.get(req)
    if (existing) return existing
  }
  const incoming = req?.headers?.get(REQUEST_ID_HEADER)
  if (incoming && SAFE_REQUEST_ID.test(incoming) && incoming.length <= MAX_REQUEST_ID_LEN) {
    if (req) requestIds.set(req, incoming)
    return incoming
  }
  const requestId = newRequestId()
  if (req) requestIds.set(req, requestId)
  return requestId
}

function now(): number {
  try {
    return performance.now()
  } catch {
    return 0
  }
}

function severityFor(status: number, durationMs: number): Severity {
  if (status >= 500) return 'error'
  if (durationMs >= CRITICAL_MS) return 'critical'
  if (durationMs >= SLOW_MS) return 'slow'
  return 'normal'
}

function categoryForStatus(status: number): ErrorCategory | null {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 400 || status === 404 || status === 422) return 'validation'
  if (status >= 500) return 'internal'
  return null
}

function emit(fields: Record<string, unknown>): void {
  const severity = fields.severity as Severity
  const line = JSON.stringify({ event: 'api_request', ...fields })
  if (severity === 'error' || severity === 'critical') {
    console.error(line)
  } else if (severity === 'slow') {
    console.warn(line)
  } else {
    console.log(line)
  }
}

function log(
  requestId: string,
  route: string,
  method: string,
  status: number,
  durationMs: number,
  category: ErrorCategory | null,
): void {
  const severity = severityFor(status, durationMs)
  if (severity === 'normal' && !shouldLogNormal()) return
  emit({
    requestId,
    route,
    method,
    status,
    durationMs: Math.round(durationMs),
    severity,
    environment: environment(),
    ...(category ? { errorCategory: category } : {}),
  })
}

/**
 * Build a safe JSON error response. Logs only a stable error code and request
 * metadata (never the raw exception, payloads, PII, amounts, IDs, SQL, or stack
 * traces), and returns a safe user-facing message plus the request ID.
 *
 * Mirrors the verified Counter Sale error path so every core mutation fails the
 * same safe way.
 */
export function safeApiError(opts: {
  route: string
  requestId: string
  errorCode: string
  userMessage: string
  error: unknown
  method?: string
  status?: number
  durationMs?: number
}): NextResponse {
  // Intentionally do not serialize the raw exception. Provider/database
  // messages can contain SQL, payload fragments, identifiers, or values.
  void opts.error

  emit({
    requestId: opts.requestId,
    route: opts.route,
    method: opts.method ?? 'GET',
    status: opts.status ?? 500,
    ...(opts.durationMs !== undefined ? { durationMs: Math.round(opts.durationMs) } : {}),
    severity: 'error',
    environment: environment(),
    errorCategory: 'internal',
    errorCode: opts.errorCode,
  })

  return NextResponse.json(
    { error: opts.errorCode, message: opts.userMessage, requestId: opts.requestId },
    { status: opts.status ?? 500, headers: { 'X-Request-Id': opts.requestId } },
  )
}

export function safeMutationError(opts: {
  route: string
  requestId: string
  errorCode: string
  userMessage: string
  error: unknown
  status?: number
  durationMs?: number
}): NextResponse {
  return safeApiError({ ...opts, method: 'POST' })
}

type RouteHandler = (...args: any[]) => Promise<Response> | Response

/**
 * Wrap a read-only route handler with timing, a request/trace ID, and slow
 * warnings. Preserves the handler's exact response body, status, headers, and
 * error behavior. Adds the X-Request-Id response header. A thrown provider or
 * database error is converted to one generic response so framework output can
 * never expose the internal message.
 */
export function withObservability(route: string, handler: RouteHandler): RouteHandler {
  return async (...args: any[]): Promise<Response> => {
    const req = args[0] instanceof Request ? (args[0] as Request) : undefined
    const requestId = resolveRequestId(req)
    const method = req?.method || 'GET'
    const start = now()

    try {
      const res = await handler(...args)
      const durationMs = now() - start
      log(requestId, route, method, res.status, durationMs, categoryForStatus(res.status))
      try {
        res.headers.set('X-Request-Id', requestId)
      } catch {
        /* immutable headers — return unchanged */
      }
      return res
    } catch {
      const durationMs = now() - start
      log(requestId, route, method, 500, durationMs, 'internal')
      return NextResponse.json(
        {
          error: 'REQUEST_FAILED',
          message: 'The request could not be completed.',
          requestId,
        },
        { status: 500, headers: { 'X-Request-Id': requestId } },
      )
    }
  }
}
