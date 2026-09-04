/**
 * The small, sale-facing projection of Business Accounts.
 *
 * Business Accounts and the full Chart of Accounts have different capability
 * paths in legacy production. Sale screens consume this projection so choosing
 * where money was received never depends on UUID-ledger availability.
 */

export type BusinessAccountSourceRow = {
  id: string
  name: string
  type?: string | null
  isActive: boolean
  ledger: {
    id: string
    code: string
    name?: string | null
  }
}

export type SalePaymentAccount = {
  /** Linked ledger account ID posted with the payment allocation. */
  id: string
  code: string
  name: string
  isActive: true
  type?: string
}

export function selectActivePaymentAccounts(
  rows: readonly BusinessAccountSourceRow[],
): SalePaymentAccount[] {
  return rows
    .filter((row) => row.isActive && row.ledger?.id && row.ledger.code)
    .map((row) => ({
      id: row.ledger.id,
      code: row.ledger.code,
      name: row.name || row.ledger.name || row.ledger.code,
      isActive: true,
      ...(row.type ? { type: row.type } : {}),
    }))
}

export type PaymentAccountGate = 'loading' | 'error' | 'setup-required' | 'ready'

/** Counter Sale must decide this before exposing bill construction controls. */
export function resolvePaymentAccountGate(input: {
  isPending: boolean
  isError: boolean
  isSuccess: boolean
  accountCount: number
}): PaymentAccountGate {
  if (input.isPending || !input.isSuccess) return input.isError ? 'error' : 'loading'
  return input.accountCount === 0 ? 'setup-required' : 'ready'
}
