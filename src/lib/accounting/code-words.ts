/**
 * Readable account category / subcategory code words.
 *
 * Policy: docs/ACCOUNTING_CODES_AND_IDENTITIES.md §4-§7.
 * - Uppercase canonical storage and display.
 * - Letters, numbers and hyphens only (e.g. `CASH`, `BANK-MZN`, `EXP-COMM`).
 * - Trimmed; whitespace is never part of a code word.
 * - Unique within the business (enforced by the database partial unique index
 *   and re-checked here for a clear API error before the RPC call).
 * - Separate from the parent/child hierarchy: relational IDs remain the true
 *   foreign keys, so renaming a code word never breaks historical vouchers.
 * Import-safe from both client components and API routes.
 */

/** Canonical stored/display form: uppercase letters, digits, single hyphens. */
export const CODE_WORD_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)*$/

export const CODE_WORD_MIN_LENGTH = 2
export const CODE_WORD_MAX_LENGTH = 40

export type CodeWordResult =
  | { ok: true; code: string }
  | { ok: false; error: string }

export function normalizeCodeWord(raw: string | null | undefined): CodeWordResult {
  const trimmed = (raw ?? '').trim().toUpperCase()
  if (!trimmed) return { ok: false, error: 'Code word is required (e.g. EXP-COMM)' }
  if (trimmed.length < CODE_WORD_MIN_LENGTH || trimmed.length > CODE_WORD_MAX_LENGTH) {
    return { ok: false, error: `Code word must be ${CODE_WORD_MIN_LENGTH}-${CODE_WORD_MAX_LENGTH} characters` }
  }
  if (!CODE_WORD_PATTERN.test(trimmed)) {
    return { ok: false, error: 'Code word may only use letters, numbers and hyphens (e.g. EXP-COMM)' }
  }
  return { ok: true, code: trimmed }
}

/** Render a name together with its readable code word, e.g. `Sales Commission · EXP-COMM`. */
export function formatNameWithCodeWord(name: string, code: string | null | undefined): string {
  return code ? `${name} · ${code}` : name
}
