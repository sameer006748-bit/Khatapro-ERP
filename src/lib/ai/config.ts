import 'server-only'

export const AI_PROVIDER = 'gemini'
export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash'
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export const AI_LIMITS = {
  promptCharacters: 1200,
  responseCharacters: 1800,
  outputTokens: 450,
  timeoutMs: 12_000,
  requestsPerMinute: 8,
} as const
