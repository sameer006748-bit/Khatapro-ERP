import 'server-only'
import { AI_LIMITS, GEMINI_API_BASE, GEMINI_MODEL } from '@/lib/ai/config'
import {
  buildSystemInstruction,
  serializeStructuredAnswer,
  validateAiAnswer,
  type AiLanguage,
  type AiMode,
  type AiScreen,
} from '@/lib/ai/safety-core'
import {
  callGeminiCore,
  GeminiClientError,
  resolveThinkingConfig,
  runGeminiWithSingleRetry,
  type GeminiFailureCategory,
  type GeminiThinkingConfig,
} from '@/lib/ai/gemini-client-core'
export { GeminiClientError } from '@/lib/ai/gemini-client-core'
export type { GeminiFailureCategory } from '@/lib/ai/gemini-client-core'

async function callGemini(
  apiKey: string,
  body: Record<string, unknown>,
  outputTokens: number,
  thinking?: GeminiThinkingConfig,
): Promise<string> {
  return callGeminiCore({
    apiKey: apiKey.trim(),
    url: `${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
    body,
    outputTokens,
    timeoutMs: AI_LIMITS.timeoutMs,
    thinking,
  })
}

export async function generateGeminiAnswer(args: {
  apiKey: string
  language: AiLanguage
  prompt: string
  context: Record<string, unknown>
  screen: AiScreen
  mode: AiMode
  requestId: string
}): Promise<string> {
  const contents = [{
    role: 'user',
    parts: [{ text: JSON.stringify({ question: args.prompt, authorizedContext: args.context }) }],
  }]

  return runGeminiWithSingleRetry({
    call: (strict) => callGemini(args.apiKey, {
      systemInstruction: {
        parts: [{
          text: buildSystemInstruction(args.language, {
            strict,
            screen: args.screen,
            mode: args.mode,
          }),
        }],
      },
      contents,
    }, AI_LIMITS.outputTokens, resolveThinkingConfig(GEMINI_MODEL)),
    validate: (text, strict) => {
      const result = validateAiAnswer(text, strict)
      return result.valid
        ? { valid: true, value: serializeStructuredAnswer(result.answer) }
        : result
    },
    onRetry: (reason) => {
      console.warn(JSON.stringify({
        event: 'ai_answer_retry',
        requestId: args.requestId,
        category: reason,
        attempt: 2,
      }))
    },
  })
}

export type GeminiProbeResult = {
  status: 'connected' | 'invalid' | 'failed'
  errorCategory: GeminiFailureCategory | null
  /** The model the probe actually called, so a failure names the model it used. */
  model: string
}

// Headroom for the probe. Thinking tokens are charged against this budget even
// though they are never returned, so the ceiling has to clear the pinned
// thinking tier plus the two-token answer, not just the answer.
const PROBE_OUTPUT_TOKENS = 1024

export async function probeGeminiKey(
  apiKey: string,
  requestId: string = 'unavailable',
): Promise<GeminiProbeResult> {
  try {
    await callGemini(apiKey, {
      systemInstruction: { parts: [{ text: 'Reply with only OK.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Connection check.' }] }],
    }, PROBE_OUTPUT_TOKENS, resolveThinkingConfig(GEMINI_MODEL))
    return { status: 'connected', errorCategory: null, model: GEMINI_MODEL }
  } catch (error) {
    if (error instanceof GeminiClientError) {
      // A truncated reply is still proof of connection: the request was
      // authenticated, the model ID resolved, and the model produced tokens. It
      // only means the reply outgrew the probe's budget, which says nothing about
      // the credential the Owner is testing, so reporting it as a connection
      // failure would be wrong.
      if (error.category === 'truncated') {
        console.warn(JSON.stringify({
          event: 'gemini_connection_test_truncated',
          requestId,
          googleErrorCode: error.googleErrorCode,
          severity: 'warning',
        }))
        return { status: 'connected', errorCategory: null, model: GEMINI_MODEL }
      }
      console.error(JSON.stringify({
        event: 'gemini_connection_test_failed',
        requestId,
        httpStatus: error.httpStatus,
        googleErrorCode: error.googleErrorCode,
        category: error.category,
        severity: 'error',
      }))
      return {
        status: error.category === 'invalid_api_key' ? 'invalid' : 'failed',
        errorCategory: error.category,
        model: GEMINI_MODEL,
      }
    }
    console.error(JSON.stringify({
      event: 'gemini_connection_test_failed',
      requestId,
      httpStatus: null,
      googleErrorCode: 'UNEXPECTED_CLIENT_ERROR',
      category: 'provider_unavailable',
      severity: 'error',
    }))
    return { status: 'failed', errorCategory: 'provider_unavailable', model: GEMINI_MODEL }
  }
}
