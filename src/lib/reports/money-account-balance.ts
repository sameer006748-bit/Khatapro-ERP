export type BalanceSheetMoneyRow = { account_code: string; balance?: string | number | bigint | null }

export function sumMoneyAccountBalances(
  rows: BalanceSheetMoneyRow[],
  accountCodes: Iterable<string>,
): bigint {
  const included = new Set(accountCodes)
  return rows.reduce(
    (total, row) => included.has(row.account_code) ? total + BigInt(row.balance ?? 0) : total,
    0n,
  )
}
