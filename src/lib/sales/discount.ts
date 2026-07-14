/**
 * Discount parsing and validation for Phase 9.1 sale discount support.
 *
 * The discount field comes from the client as a decimal rupee string (e.g. "5" or "5.50").
 * This module safely converts it to integer paisas (e.g. 500 or 550).
 */
import { parseMoney } from '@/lib/format'

/**
 * Parse a client-supplied discount string into BigInt paisas.
 *
 * - Accepts a decimal rupee amount (e.g. "5" or "5.50").
 * - Rejects NaN, Infinity, and values that cannot be safely represented as integer paisas.
 * - Returns 0n for undefined/null/empty-string (no discount).
 * - Throws on negative values.
 */
export function parseDiscountPaisas(rupeeString?: string): bigint {
  if (rupeeString === undefined || rupeeString === null || rupeeString.trim() === '') {
    return 0n
  }

  const v = parseMoney(rupeeString)
  if (v === null) {
    throw new Error(`Invalid discount amount: "${rupeeString}". Enter a valid rupee amount.`)
  }
  if (v < 0n) {
    throw new Error('Discount cannot be negative.')
  }
  return v
}