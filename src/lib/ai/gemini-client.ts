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
  runGeminiWithSingleRetry,
  type GeminiFailureCategory,
} from '@/lib/ai/gemini-client-core'
export { GeminiClientError } from '@/lib/ai/gemini-client-core'
export type { GeminiFailureCategory } from '@/lib/ai/gemini-client-core'

async function callGemini(
  apiKey: string,
  body: Record<string, unknown>,
  outputTokens: number,
  thinkingBudget?: number,
): Promise<string> {
  return callGeminiCore({
    apiKey: apiKey.trim(),
    url: `${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
    body,
    outputTokens,
    timeoutMs: AI_LIMITS.timeoutMs,
    thinkingBudget,
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
    }, AI_LIMITS.outputTokens),
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
}

export async function probeGeminiKey(
  apiKey: string,
  requestId: string = 'unavailable',
): Promise<GeminiProbeResult> {
  try {
    await callGemini(apiKey, {
      systemInstruction: { parts: [{ text: 'Reply with only OK.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Connection check.' }] }],
    }, 16, 0)
    return { status: 'connected', errorCategory: null }
  } catch (error) {
    if (error instanceof GeminiClientError) {
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
    return { status: 'failed', errorCategory: 'provider_unavailable' }
  }
}
