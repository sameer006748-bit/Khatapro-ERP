import 'server-only'
import { AI_LIMITS, GEMINI_API_BASE, GEMINI_MODEL } from '@/lib/ai/config'
import { buildSystemInstruction, clampAiResponse, type AiLanguage } from '@/lib/ai/safety-core'
import { callGeminiCore, GeminiClientError } from '@/lib/ai/gemini-client-core'
export { GeminiClientError } from '@/lib/ai/gemini-client-core'

async function callGemini(apiKey: string, body: Record<string, unknown>, outputTokens: number): Promise<string> {
  return callGeminiCore({
    apiKey,
    url: `${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
    body,
    outputTokens,
    timeoutMs: AI_LIMITS.timeoutMs,
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

export async function probeGeminiKey(apiKey: string): Promise<'connected' | 'invalid' | 'failed'> {
  try {
    await callGemini(apiKey, {
      systemInstruction: { parts: [{ text: 'Reply with only OK.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Connection check.' }] }],
    }, 16)
    return 'connected'
  } catch (error) {
    if (error instanceof GeminiClientError && error.code === 'invalid_key') return 'invalid'
    return 'failed'
  }
}
