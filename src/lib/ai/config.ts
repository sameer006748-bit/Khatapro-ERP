import 'server-only'

export const AI_PROVIDER = 'gemini'
/**
 * Gemini 3.5 Flash is the economical stable Flash model on the Generative
 * Language API, and is the model Version 1 ships with. `GEMINI_MODEL` overrides
 * it per environment; note that changing generation also changes which thinking
 * parameter the provider accepts (see `probeThinkingBudget` in gemini-client).
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