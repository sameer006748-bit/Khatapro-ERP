import 'server-only'
import { AI_LIMITS, GEMINI_API_BASE, GEMINI_MODEL } from '@/lib/ai/config'
import { buildSystemInstruction, clampAiResponse, type AiLanguage } from '@/lib/ai/safety-core'
import {
  callGeminiCore,
  GeminiClientError,
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
}): Promise<string> {
  const text = await callGemini(args.apiKey, {
    systemInstruction: { parts: [{ text: buildSystemInstruction(args.language) }] },
    contents: [{
      role: 'user',
      parts: [{ text: JSON.stringify({ question: args.prompt, authorizedContext: args.context }) }],
    }],
  }, AI_LIMITS.outputTokens)

  return clampAiResponse(text, AI_LIMITS.responseCharacters)
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
