export type LegacyTrialBalanceAccount = {
  id: string
  code: string
  name: string
  isActive: boolean
  category: { code: string; name: string; type: string }
}

export type LegacyTrialBalanceLine = {
  accountId: string
  debit: string | number | bigint
  credit: string | number | bigint
}

export type LegacyTrialBalanceRow = {
  account: {
    id: string
    code: string
    name: string
    category: { code: string; name: string; type: string }
  }
  totalDebit: bigint
  totalCredit: bigint
  balance: bigint
}

/**
 * Build a Trial Balance from the posted lines selected by the server reader.
 *
 * Active accounts remain visible even when they have no activity. Inactive
 * accounts remain visible when historical activity exists; deactivation stops
 * future posting, it must never erase a side of already-posted double entry.
 */
export function aggregateLegacyTrialBalance(
  accounts: LegacyTrialBalanceAccount[],
  lines: LegacyTrialBalanceLine[],
): LegacyTrialBalanceRow[] {
  const knownAccountIds = new Set(accounts.map((account) => account.id))
  const totals = new Map<string, { debit: bigint; credit: bigint }>()

  for (const line of lines) {
    if (!knownAccountIds.has(line.accountId)) {
      throw new Error(`Trial Balance line references an account outside the business: ${line.accountId}`)
    }
    const current = totals.get(line.accountId) ?? { debit: 0n, credit: 0n }
    current.debit += BigInt(line.debit ?? 0)
    current.credit += BigInt(line.credit ?? 0)
    totals.set(line.accountId, current)
  }

  return accounts
    .filter((account) => {
      const activity = totals.get(account.id)
      return account.isActive || Boolean(activity && (activity.debit !== 0n || activity.credit !== 0n))
    })
    .sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true }))
    .map((account) => {
      const activity = totals.get(account.id) ?? { debit: 0n, credit: 0n }
      return {
        account: {
          id: account.id,
          code: account.code,
          name: account.name,
          category: account.category,
        },
        totalDebit: activity.debit,
        totalCredit: activity.credit,
        balance: activity.debit - activity.credit,
      }
    })
}
