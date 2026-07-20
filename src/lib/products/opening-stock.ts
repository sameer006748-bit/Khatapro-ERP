/**
 * Opening-stock planning for new products.
 *
 * The accounting itself (WAC, stock movement, Inventory Asset debit /
 * Opening Balance Equity credit voucher) is performed atomically by the
 * post_opening_stock() Postgres RPC. This module only validates input and
 * converts rupees → paisas so the client never duplicates ledger math.
 */

/** Error whose message is safe to show to the end user. */
export class SafeProductError extends Error {
  readonly safe = true
  constructor(message: string) {
    super(message)
    this.name = 'SafeProductError'
  }
}

export type OpeningStockPlan = {
  openingQty: number
  unitCostPaisas: number
  /** qty × unit cost — equals both the Inventory debit and the OBE credit. */
  valuePaisas: number
}

/**
 * Returns the posting plan for a new product's opening stock, or null when
 * there is nothing to post (zero opening quantity). Throws SafeProductError
 * on invalid quantity or cost.
 */
export function planOpeningStock(
  openingStock: number,
  purchasePriceRupees: number,
): OpeningStockPlan | null {
  if (!Number.isInteger(openingStock)) {
    throw new SafeProductError('Opening stock must be a whole number.')
  }
  if (openingStock < 0) {
    throw new SafeProductError('Opening stock cannot be negative.')
  }
  if (!Number.isFinite(purchasePriceRupees) || purchasePriceRupees < 0) {
    throw new SafeProductError('Purchase price cannot be negative.')
  }
  if (openingStock === 0) return null
  const unitCostPaisas = Math.round(purchasePriceRupees * 100)
  if (unitCostPaisas <= 0) {
    throw new SafeProductError(
      'Purchase price is required when opening stock is set, so inventory value and accounting stay correct.',
    )
  }
  return {
    openingQty: openingStock,
    unitCostPaisas,
    valuePaisas: openingStock * unitCostPaisas,
  }
}
