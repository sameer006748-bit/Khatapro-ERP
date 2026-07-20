export const GEMINI_FAILURE_CATEGORIES = [
  'invalid_api_key',
  'permission_denied',
  'model_not_found',
  'quota_exceeded',
  'rate_limited',
  'timeout',
  'malformed_request',
  'provider_unavailable',
  'truncated',
] as const

export type GeminiFailureCategory = typeof GEMINI_FAILURE_CATEGORIES[number]

export class GeminiClientError extends Error {
  category: GeminiFailureCategory
  httpStatus: number | null
  googleErrorCode: string

  constructor(
    category: GeminiFailureCategory,
    httpStatus: number | null,
    googleErrorCode: string,
  ) {
    super(category)
    this.category = category
    this.httpStatus = httpStatus
    this.googleErrorCode = googleErrorCode
  }
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
    safetyRatings?: Array<Record<string, unknown>>
    tokenCount?: number
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

type GeminiErrorResponse = {
  error?: {
    status?: unknown
    details?: Array<{ reason?: unknown }>
  }
}

const SAFE_GOOGLE_CODE = /^[A-Z0-9_]{1,64}$/

function safeGoogleCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && SAFE_GOOGLE_CODE.test(value)
    ? value
    : fallback
}

function errorReasons(payload: GeminiErrorResponse | null): string[] {
  const reasons = payload?.error?.details
    ?.map((detail) => safeGoogleCode(detail.reason, ''))
    .filter(Boolean)
  return reasons ?? []
}

export function classifyGeminiFailure(
  httpStatus: number,
  googleErrorCode: string,
  reasons: string[],
  hasRetryAfter: boolean,
): GeminiFailureCategory {
  if (reasons.some((reason) => reason === 'API_KEY_INVALID' || reason === 'API_KEY_EXPIRED')) {
    return 'invalid_api_key'
  }
  if (httpStatus === 401) return 'invalid_api_key'
  if (httpStatus === 403 || googleErrorCode === 'PERMISSION_DENIED' || googleErrorCode === 'FAILED_PRECONDITION') {
    return 'permission_denied'
  }
  if (httpStatus === 404 || googleErrorCode === 'NOT_FOUND') return 'model_not_found'
  if (httpStatus === 429 || googleErrorCode === 'RESOURCE_EXHAUSTED') {
    return hasRetryAfter ? 'rate_limited' : 'quota_exceeded'
  }
  if (httpStatus === 408 || httpStatus === 504 || googleErrorCode === 'DEADLINE_EXCEEDED') {
    return 'timeout'
  }
  if (httpStatus === 400) return 'malformed_request'
  return 'provider_unavailable'
}

export async function callGeminiCore(args: {
  apiKey: string
  url: string
  body: Record<string, unknown>
  outputTokens: number
  timeoutMs: number
  thinkingBudget?: number
  fetchImpl?: typeof fetch
}): Promise<string> {
  const apiKey = args.apiKey.trim()
  if (!apiKey) {
    throw new GeminiClientError('invalid_api_key', null, 'EMPTY_API_KEY')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs)

  try {
    const response = await (args.fetchImpl ?? fetch)(args.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        ...args.body,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: args.outputTokens,
          ...(args.thinkingBudget !== undefined
            ? { thinkingConfig: { thinkingBudget: args.thinkingBudget } }
            : {}),
        },
      }),
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      let errorPayload: GeminiErrorResponse | null = null
      try {
        errorPayload = await response.json() as GeminiErrorResponse
      } catch {
        // Provider bodies are intentionally discarded when they are not JSON.
      }
      const googleErrorCode = safeGoogleCode(
        errorPayload?.error?.status,
        `HTTP_${response.status}`,
      )
      throw new GeminiClientError(
        classifyGeminiFailure(
          response.status,
          googleErrorCode,
          errorReasons(errorPayload),
          response.headers.has('retry-after'),
        ),
        response.status,
        googleErrorCode,
      )
    }

    const payload = await response.json() as GeminiResponse
    const candidate = payload.candidates?.[0]
    const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('').trim()
    if (!text) throw new GeminiClientError('provider_unavailable', 200, 'EMPTY_RESPONSE')

    // Detect truncation from finishReason
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new GeminiClientError('truncated', 200, 'MAX_TOKENS')
    }

    return text
  } catch (error) {
    if (error instanceof GeminiClientError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GeminiClientError('timeout', null, 'CLIENT_TIMEOUT')
    }
    throw new GeminiClientError('provider_unavailable', null, 'NETWORK_ERROR')
  } finally {
    clearTimeout(timeout)
  }
}
