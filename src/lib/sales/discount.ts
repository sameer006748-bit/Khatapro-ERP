/**
 * Shared discount parsing helper.
 *
 * Accepts a paisa string (e.g. "50000" = Rs 500.00) and returns a BigInt.
 * Rejects:
 * - negative values
 * - decimal/rupee strings (e.g. "500.50")
 * - non-numeric strings
 * - undefined/null (returns 0n)
 *
 * @throws Error if the value is negative, decimal, or malformed
 */
export function parseDiscountPaisas(value: string | undefined | null): bigint {
  if (value === undefined || value === null || value === '') return 0n

  // Reject decimal strings — API contract is integer paisas
  if (value.includes('.')) {
    throw new Error('Discount must be an integer paisa string, not a decimal rupee string')
  }

  // Reject non-numeric
  if (!/^-?\d+$/.test(value)) {
    throw new Error('Discount must be a numeric paisa string')
  }

  const result = BigInt(value)

  // Reject negative
  if (result < 0n) {
    throw new Error('Discount cannot be negative')
  }

  return result
}

/**
 * Validates that discount does not exceed subtotal.
 * @throws Error if discount > subtotal
 */
export function validateDiscountNotExceedingSubtotal(discount: bigint, subtotal: bigint): void {
  if (discount > subtotal) {
    throw new Error(`Discount (${discount} paisas) cannot exceed subtotal (${subtotal} paisas)`)
  }
}
