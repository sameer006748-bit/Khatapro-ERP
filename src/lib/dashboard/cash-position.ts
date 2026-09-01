/**
 * Cash Position — current balances of the business's own payment accounts.
 *
 * The only source is the existing Business Accounts infrastructure, read
 * through the same detection the rest of the app already uses. This module
 * never derives, estimates or back-fills a balance, and it never surfaces
 * bank names, account holders or account numbers on the dashboard.
 *
 * Account-type normalisation is passed in rather than imported, so the one
 * canonical mapping in `@/lib/accounting/business-account-types` stays the only
 * place that decides what "Easypaisa" or "Petty Cash" means.
 */

export type CashPositionState = 'available' | 'not-tracked' | 'error'

/** Display grouping only. An unrecognised type is folded into Other. */
export const CASH_POSITION_GROUPS = ['Cash', 'Bank', 'Wallet', 'Other'] as const

export type CashPositionGroupName = typeof CASH_POSITION_GROUPS[number]

export type CashPositionGroup = {
  type: CashPositionGroupName
  accountCount: number
  balancePaisas: string
}

export type CashPosition = {
  state: CashPositionState
  groups: CashPositionGroup[]
  /** Active accounts only; 0 with state 'available' means none are active. */
  accountCount: number
  /** null whenever balances were not measured — never a fabricated zero. */
  totalPaisas: string | null
}

export type CashPositionAccount = {
  type: string
  isActive: boolean
  balancePaisas: string | number | null
}

/** numeric(20,0) paisas arrive as a string or number; anything else is not a balance. */
function paisas(value: string | number | null | undefined): bigint {
  const match = /^(-?\d+)(?:\.0*)?$/.exec(String(value ?? '0').trim())
  return match ? BigInt(match[1]) : 0n
}

function groupName(value: string): CashPositionGroupName {
  return (CASH_POSITION_GROUPS as readonly string[]).includes(value)
    ? value as CashPositionGroupName
    : 'Other'
}

export function buildCashPosition(input: {
  state: CashPositionState
  accounts: CashPositionAccount[] | null
  /** The app's canonical type mapping; identity is used when omitted. */
  normalizeType?: (raw: string) => string
}): CashPosition {
  if (input.state !== 'available' || !input.accounts) {
    return { state: input.state, groups: [], accountCount: 0, totalPaisas: null }
  }

  const normalize = input.normalizeType ?? ((raw: string) => raw)
  const active = input.accounts.filter((account) => account.isActive)
  const totals = new Map<CashPositionGroupName, { count: number; balance: bigint }>()
  for (const account of active) {
    const type = groupName(normalize(String(account.type ?? '')))
    const bucket = totals.get(type) ?? { count: 0, balance: 0n }
    bucket.count += 1
    bucket.balance += paisas(account.balancePaisas)
    totals.set(type, bucket)
  }

  const groups = CASH_POSITION_GROUPS.flatMap((type) => {
    const bucket = totals.get(type)
    return bucket
      ? [{ type, accountCount: bucket.count, balancePaisas: bucket.balance.toString() }]
      : []
  })

  return {
    state: 'available',
    groups,
    accountCount: active.length,
    totalPaisas: groups.reduce((total, group) => total + BigInt(group.balancePaisas), 0n).toString(),
  }
}
