const TECHNICAL_ERROR = /(?:\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b|unexpected server response|networkerror|json|sql|fetch failed)/i

/** Keep transport and internal error codes out of client-facing feedback. */
export function userFacingError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const normalized = message.trim()
  return normalized && !TECHNICAL_ERROR.test(normalized) ? normalized : fallback
}
