import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateLegacyBalanceSheet } from '../src/lib/accounting/legacy-balance-sheet.ts'
import type { LegacyTrialBalanceRow } from '../src/lib/accounting/legacy-trial-balance.ts'

/** Trial Balance rows carry the natural sign: balance = debit - credit. */
function tbRow(code: string, name: string, type: string, balance: bigint): LegacyTrialBalanceRow {
  return {
    account: { id: `acc-${code}`, code, name, category: { code: type.toUpperCase(), name: type, type } },
    totalDebit: balance > 0n ? balance : 0n,
    totalCredit: balance < 0n ? -balance : 0n,
    balance,
  }
}

/**
 * The live production chart for biz-default as of 2026-09-07, including the two
 * deactivated asset accounts (1040 Easypaisa, 1060 CASH) that still hold posted
 * history. The deployed `report_balance_sheet` RPC dropped both, which is what
 * made Financial Reports show Difference -Rs 2,505.00.
 */
const PRODUCTION_TRIAL_BALANCE: LegacyTrialBalanceRow[] = [
  tbRow('1010', 'Cash', 'Asset', 1_432_000n),
  tbRow('1020', 'Petty Cash', 'Asset', -1_070_000n),
  tbRow('1030', 'Bank', 'Asset', -400_000n),
  tbRow('1040', 'Easypaisa', 'Asset', 225_000n),
  tbRow('1050', 'CASH', 'Asset', 0n),
  tbRow('1060', 'CASH', 'Asset', 25_500n),
  tbRow('1061', 'UBL', 'Asset', 393_000n),
  tbRow('1100', 'Inventory', 'Asset', 14_893_345n),
  tbRow('1200', 'Customers Receivable', 'Asset', 1_342_500n),
  tbRow('1300', 'Salesman - Ali', 'Asset', 0n),
  tbRow('1310', 'Rider COD Receivable', 'Asset', 215_000n),
  tbRow('2010', 'Vendors Payable', 'Liability', -15_010_000n),
  tbRow('2020', 'Rider Payable', 'Liability', -15_000n),
  tbRow('2030', 'Short Term Loan', 'Liability', 0n),
  tbRow('3010', 'Owner Capital', 'Equity', 100_000n),
  tbRow('3020', 'Owner Drawings', 'Equity', 0n),
  tbRow('4010', 'Sales', 'Income', -3_418_500n),
  tbRow('5010', 'Purchases / COGS', 'Expense', 1_216_655n),
  tbRow('5020', 'Expenses', 'Expense', 70_500n),
]

const sectionTotal = (rows: { section: string; balance: string }[], section: string) =>
  rows.filter((row) => row.section === section).reduce((sum, row) => sum + BigInt(row.balance), 0n)

test('Balance Sheet keeps inactive accounts with posted history and balances', () => {
  const rows = aggregateLegacyBalanceSheet(PRODUCTION_TRIAL_BALANCE)

  const assets = sectionTotal(rows, 'ASSET')
  const liabilities = sectionTotal(rows, 'LIABILITY')
  const equity = sectionTotal(rows, 'EQUITY')

  // Matches the live Trial Balance: Assets Rs 170,563.45.
  assert.equal(assets, 17_056_345n)
  assert.equal(liabilities, 15_025_000n)
  assert.equal(equity, 2_031_345n)
  assert.equal(assets - liabilities - equity, 0n)

  // The exact Rs 2,505.00 that the RPC dropped.
  const dropped = rows.filter((row) => row.account_code === '1040' || row.account_code === '1060')
  assert.equal(dropped.length, 2)
  assert.equal(dropped.reduce((sum, row) => sum + BigInt(row.balance), 0n), 250_500n)
})

test('Balance Sheet presents liabilities and equity credit-positive, assets debit-positive', () => {
  const rows = aggregateLegacyBalanceSheet(PRODUCTION_TRIAL_BALANCE)
  const byCode = (code: string) => rows.find((row) => row.account_code === code)

  assert.equal(byCode('1010')?.balance, '1432000')
  assert.equal(byCode('1020')?.balance, '-1070000') // abnormal debit account stays negative
  assert.equal(byCode('2010')?.section, 'LIABILITY')
  assert.equal(byCode('2010')?.balance, '15010000')
  assert.equal(byCode('3010')?.section, 'EQUITY')
  assert.equal(byCode('3010')?.balance, '-100000')
})

test('Balance Sheet closes Income and Expense into a single calculated Current Earnings row', () => {
  const rows = aggregateLegacyBalanceSheet(PRODUCTION_TRIAL_BALANCE)

  assert.equal(rows.filter((row) => row.category_type === 'Income').length, 0)
  assert.equal(rows.filter((row) => row.category_type === 'Expense').length, 0)

  const calculated = rows.filter((row) => row.is_calculated)
  assert.equal(calculated.length, 1)
  assert.equal(calculated[0].account_code, '3031')
  assert.equal(calculated[0].section, 'EQUITY')
  assert.equal(calculated[0].account_id, null)
  // Revenue 34,185.00 - COGS 12,166.55 - expenses 705.00 = 21,313.45.
  assert.equal(calculated[0].balance, '2131345')
})

test('Balance Sheet omits accounts that net to zero and orders by section then code', () => {
  const rows = aggregateLegacyBalanceSheet(PRODUCTION_TRIAL_BALANCE)

  for (const zeroCode of ['1050', '1300', '2030', '3020']) {
    assert.equal(rows.some((row) => row.account_code === zeroCode), false, `${zeroCode} should be omitted`)
  }
  assert.deepEqual(rows.map((row) => row.account_code), [
    '1010', '1020', '1030', '1040', '1060', '1061', '1100', '1200', '1310',
    '2010', '2020',
    '3010', '3031',
  ])
  assert.deepEqual([...new Set(rows.map((row) => row.section))], ['ASSET', 'LIABILITY', 'EQUITY'])
})

test('Balance Sheet always emits Current Earnings, even with no posted activity', () => {
  const rows = aggregateLegacyBalanceSheet([tbRow('1010', 'Cash', 'Asset', 0n)])
  assert.deepEqual(rows.map((row) => row.account_code), ['3031'])
  assert.equal(rows[0].balance, '0')
  assert.equal(rows[0].is_calculated, true)
})
