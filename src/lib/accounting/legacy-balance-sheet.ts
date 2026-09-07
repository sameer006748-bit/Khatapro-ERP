import type { LegacyTrialBalanceRow } from './legacy-trial-balance'

export type LegacyBalanceSheetRow = {
  section: 'ASSET' | 'LIABILITY' | 'EQUITY'
  account_id: string | null
  account_code: string
  account_name: string
  category_type: string
  balance: string
  is_calculated: boolean
}

const SECTION_BY_TYPE: Record<string, LegacyBalanceSheetRow['section']> = {
  asset: 'ASSET',
  liability: 'LIABILITY',
  equity: 'EQUITY',
}

/** Accounts whose natural balance is a credit are presented credit-positive. */
const CREDIT_POSITIVE_SECTIONS = new Set<LegacyBalanceSheetRow['section']>(['LIABILITY', 'EQUITY'])

export const CURRENT_EARNINGS_CODE = '3031'
export const CURRENT_EARNINGS_NAME = 'Current Earnings'

function sectionOf(categoryType: string): LegacyBalanceSheetRow['section'] | null {
  return SECTION_BY_TYPE[categoryType.trim().toLowerCase()] ?? null
}

/**
 * Build a Balance Sheet from the same posted lines the Trial Balance reads.
 *
 * The deployed `report_balance_sheet` RPC filters accounts on `is_active`, so a
 * deactivated account that still carries posted history silently loses its side
 * of the double entry and the statement stops balancing. Presence here is
 * decided by the balance, never by the active flag: deactivation stops future
 * posting, it must never erase history. Accounts that net to zero stay hidden
 * so the statement keeps listing only live positions.
 *
 * Income and Expense never appear as accounts; they roll into the calculated
 * Current Earnings equity row, which is what makes Assets = Liabilities + Equity.
 */
export function aggregateLegacyBalanceSheet(rows: LegacyTrialBalanceRow[]): LegacyBalanceSheetRow[] {
  const statement: LegacyBalanceSheetRow[] = []
  let currentEarnings = 0n

  for (const row of rows) {
    const categoryType = row.account.category.type
    const section = sectionOf(categoryType)

    if (!section) {
      // Income and Expense close into equity rather than standing on their own.
      currentEarnings -= row.balance
      continue
    }

    const balance = CREDIT_POSITIVE_SECTIONS.has(section) ? -row.balance : row.balance
    if (balance === 0n) continue

    statement.push({
      section,
      account_id: row.account.id,
      account_code: row.account.code,
      account_name: row.account.name,
      category_type: categoryType,
      balance: balance.toString(),
      is_calculated: false,
    })
  }

  statement.push({
    section: 'EQUITY',
    account_id: null,
    account_code: CURRENT_EARNINGS_CODE,
    account_name: CURRENT_EARNINGS_NAME,
    category_type: 'Equity',
    balance: currentEarnings.toString(),
    is_calculated: true,
  })

  const sectionOrder: LegacyBalanceSheetRow['section'][] = ['ASSET', 'LIABILITY', 'EQUITY']
  return statement.sort((left, right) => {
    const bySection = sectionOrder.indexOf(left.section) - sectionOrder.indexOf(right.section)
    if (bySection !== 0) return bySection
    return left.account_code.localeCompare(right.account_code, undefined, { numeric: true })
  })
}
