import 'server-only'

export const AI_PROVIDER = 'gemini'
/**
 * Gemini 3.5 Flash is the economical stable Flash model on the Generative
 * Language API (v1beta, `:generateContent`), and is the model Version 1 ships
 * with. `GEMINI_MODEL` overrides it per environment; note that changing
 * generation also changes which thinking parameter the provider accepts — 1.x/2.x
 * take a numeric `thinkingBudget`, 3.x takes `thinkingLevel` and rejects the
 * numeric field. `resolveThinkingConfig` in gemini-client-core picks per model,
 * and every call goes through it because 3.x otherwise defaults to `medium`
 * thinking and spends `outputTokens` on reasoning it never returns.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash'
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export const AI_LIMITS = {
  promptCharacters: 1200,
  responseCharacters: 2400,
  outputTokens: 800,
  timeoutMs: 15_000,
  requestsPerMinute: 8,
} as const