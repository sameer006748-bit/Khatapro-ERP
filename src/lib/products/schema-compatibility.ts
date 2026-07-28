/**
 * Compatibility for optional product fields introduced by unapplied feature
 * migrations. The base product record remains operational; absent optional
 * fields are represented as null rather than fabricated financial values.
 */
export type ProductOptionalColumns = {
  lowStockThreshold: boolean
  commissionRate: boolean
}

const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204'])

export const PRODUCT_OPTIONAL_COLUMNS_ALL: ProductOptionalColumns = {
  lowStockThreshold: true,
  commissionRate: true,
}

export function missingProductOptionalColumn(
  error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined,
): 'lowStockThreshold' | 'commissionRate' | null {
  const text = [error?.message, error?.details].filter(Boolean).join(' ').toLowerCase()
  const code = String(error?.code ?? '').toUpperCase()
  if (!MISSING_COLUMN_CODES.has(code) && !/column .* does not exist|column .* schema cache/.test(text)) return null
  if (/low_stock_threshold/.test(text)) return 'lowStockThreshold'
  if (/commission_rate/.test(text)) return 'commissionRate'
  return null
}

export function productColumnCandidates(
  cached: ProductOptionalColumns | null,
): ProductOptionalColumns[] {
  if (cached) return [cached]
  return [
    PRODUCT_OPTIONAL_COLUMNS_ALL,
    { lowStockThreshold: true, commissionRate: false },
    { lowStockThreshold: false, commissionRate: true },
    { lowStockThreshold: false, commissionRate: false },
  ]
}
