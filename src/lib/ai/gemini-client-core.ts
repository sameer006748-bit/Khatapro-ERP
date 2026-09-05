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

export type GeminiRetryValidation<T> =
  | { valid: true; value: T }
  | { valid: false; retryable: boolean; reason: string }

export async function runGeminiWithSingleRetry<T>(args: {
  call: (strict: boolean) => Promise<string>
  validate: (text: string, strict: boolean) => GeminiRetryValidation<T>
  onRetry?: (reason: string) => void
}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const strict = attempt === 1
    try {
      const text = await args.call(strict)
      const validation = args.validate(text, strict)
      if (validation.valid) return validation.value
      if (!validation.retryable) {
        throw new GeminiClientError('provider_unavailable', 200, 'UNSAFE_OUTPUT')
      }
      if (strict) {
        throw new GeminiClientError('truncated', 200, 'INCOMPLETE_AFTER_RETRY')
      }
      args.onRetry?.(validation.reason)
    } catch (error) {
      if (!(error instanceof GeminiClientError) || error.category !== 'truncated') throw error
      if (strict) throw error
      args.onRetry?.('truncated')
    }
  }

  throw new GeminiClientError('truncated', 200, 'INCOMPLETE_AFTER_RETRY')
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

/**
 * Thinking configuration pinned on every Gemini call.
 *
 * Gemini 1.x/2.x accept a numeric `thinkingBudget`. Gemini 3.x replaced it with
 * `thinkingLevel` and rejects the numeric field; the accepted tiers are
 * `minimal | low | medium | high`, and the floor differs by model — 3.5/3.6 and
 * 3-flash-preview accept `minimal`, while 3.7/3.8 accept only `low` and above.
 * `low` is therefore the one tier every Gemini 3 Flash model accepts.
 *
 * Pinning it matters: Gemini 3 Flash defaults to `medium` thinking, thinking
 * tokens are charged against `maxOutputTokens`, and an exhausted budget comes
 * back as a candidate with no text at all — a false "connection failed" for a
 * perfectly good key. Leaving thinking at its default is what made the
 * production connection test fail. Unknown model families still send no thinking
 * field at all, because a call must fail on the API key or the model ID, never
 * on a parameter that particular model dislikes.
 */
export type GeminiThinkingConfig =
  | { thinkingBudget: number }
  | { thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' }

export function resolveThinkingConfig(model: string): GeminiThinkingConfig | undefined {
  if (/^gemini-[12]\./.test(model)) return { thinkingBudget: 0 }
  if (/^gemini-3(\.|-)/.test(model)) return { thinkingLevel: 'low' }
  return undefined
}

export async function callGeminiCore(args: {
  apiKey: string
  url: string
  body: Record<string, unknown>
  outputTokens: number
  timeoutMs: number
  thinking?: GeminiThinkingConfig
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
          ...(args.thinking !== undefined ? { thinkingConfig: args.thinking } : {}),
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

    // Budget exhaustion is checked BEFORE emptiness. A thinking model that spends
    // its whole allowance reasoning returns MAX_TOKENS with no text at all; read
    // the other way round that looks like a provider fault, which is how a
    // working key was being reported as a connection failure.
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new GeminiClientError('truncated', 200, 'MAX_TOKENS')
    }
    if (!text) throw new GeminiClientError('provider_unavailable', 200, 'EMPTY_RESPONSE')

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
