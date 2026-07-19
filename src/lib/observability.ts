import 'server-only'

/**
 * Minimal server-only API observability: request timing, a request/trace ID,
 * and slow-request warnings. Emits structured JSON logs with only safe,
 * non-sensitive fields — never payloads, PII, SQL, amounts, or stack traces.
 */

const REQUEST_ID_HEADER = 'x-request-id'
const MAX_REQUEST_ID_LEN = 128
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

function newRequestId(): string {
  return globalThis.crypto.randomUUID()
}

function resolveRequestId(req?: Request): string {
  const incoming = req?.headers?.get(REQUEST_ID_HEADER)
  if (incoming && SAFE_REQUEST_ID.test(incoming) && incoming.length <= MAX_REQUEST_ID_LEN) {
    return incoming
  }
  return newRequestId()
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

type RouteHandler = (...args: any[]) => Promise<Response> | Response

/**
 * Wrap a read-only route handler with timing, a request/trace ID, and slow
 * warnings. Preserves the handler's exact response body, status, headers, and
 * error behavior. Adds the X-Request-Id response header. On a thrown error it
 * still records duration + request ID, then re-throws so the framework handles
 * the response unchanged.
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
    } catch (err) {
      const durationMs = now() - start
      log(requestId, route, method, 500, durationMs, 'internal')
      throw err
    }
  }
}
