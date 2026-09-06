import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { aggregateLegacyTrialBalance } from '../src/lib/accounting/legacy-trial-balance.ts'
import { financialAnswerIsSupported } from '../src/lib/ai/financial-safety.ts'
import { paisasToRupees } from '../src/lib/ai/money-units.ts'
import { sumMoneyAccountBalances } from '../src/lib/reports/money-account-balance.ts'

test('Trial Balance preserves inactive accounts that contain posted history', () => {
  const rows = aggregateLegacyTrialBalance([
    { id: 'sales', code: '4010', name: 'Sales', isActive: true, category: { code: 'REV', name: 'Revenue', type: 'Income' } },
    { id: 'cash-old', code: '1060', name: 'CASH', isActive: false, category: { code: 'ASSET', name: 'Assets', type: 'Asset' } },
    { id: 'easy-old', code: '1040', name: 'Easypaisa', isActive: false, category: { code: 'ASSET', name: 'Assets', type: 'Asset' } },
    { id: 'unused-old', code: '1099', name: 'Unused', isActive: false, category: { code: 'ASSET', name: 'Assets', type: 'Asset' } },
  ], [
    { accountId: 'easy-old', debit: 225000, credit: 0 },
    { accountId: 'cash-old', debit: 2500, credit: 0 },
    { accountId: 'cash-old', debit: 15000, credit: 0 },
    { accountId: 'cash-old', debit: 8000, credit: 0 },
    { accountId: 'sales', debit: 0, credit: 250500 },
  ])

  assert.deepEqual(rows.map((row) => row.account.code), ['1040', '1060', '4010'])
  assert.equal(rows.find((row) => row.account.code === '1040')?.balance, 225000n)
  assert.equal(rows.find((row) => row.account.code === '1060')?.balance, 25500n)
  assert.equal(rows.reduce((sum, row) => sum + row.totalDebit, 0n), 250500n)
  assert.equal(rows.reduce((sum, row) => sum + row.totalCredit, 0n), 250500n)
})

test('legacy Trial Balance reader selects only posted in-period voucher lines and paginates', async () => {
  const source = await readFile(new URL('../src/lib/accounting/legacy-trial-balance-reader.ts', import.meta.url), 'utf8')
  assert.match(source, /vouchers!inner\(voucher_date, is_cancelled, business_id\)/)
  assert.match(source, /\.eq\('vouchers\.is_cancelled', false\)/)
  assert.match(source, /\.gte\('vouchers\.voucher_date', fromDate\)/)
  assert.match(source, /\.lte\('vouchers\.voucher_date', toDate\)/)
  assert.match(source, /\.range\(start, start \+ PAGE_SIZE - 1\)/)
})

test('AI money contract converts paisas once and rejects the former 100x answer', () => {
  assert.equal(paisasToRupees(2_000_000n), '20000.00')
  assert.equal(paisasToRupees(2_131_345n), '21313.45')
  assert.equal(paisasToRupees(15_010_000n), '150100.00')
  assert.equal(paisasToRupees(-88_000n), '-880.00')

  const allowed = [{ label: 'Sales billed', amountRupees: '20000.00', classification: 'period_activity' as const }]
  assert.equal(financialAnswerIsSupported('{"simpleAnswer":"Sales were PKR 20,000."}', allowed), true)
  assert.equal(financialAnswerIsSupported('{"simpleAnswer":"Sales were PKR 2,000,000."}', allowed), false)
  assert.equal(financialAnswerIsSupported('{"simpleAnswer":"Sales were 20,000.00."}', allowed), true)
  assert.equal(financialAnswerIsSupported('{"simpleAnswer":"Sales were 2,000,000."}', allowed), false)
})

test('AI context separates period activity from snapshots and uses explicit rupee fields', async () => {
  const [context, safety] = await Promise.all([
    readFile(new URL('../src/lib/ai/ai-context.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/ai/safety-core.ts', import.meta.url), 'utf8'),
  ])
  assert.match(context, /moneyUnit: 'PKR rupees; exact decimal strings with two fractional digits'/)
  assert.match(context, /periodActivity/)
  assert.match(context, /asOfSnapshot/)
  assert.match(context, /currentSnapshot/)
  assert.match(context, /current_database_state_not_selected_period_activity/)
  assert.match(context, /reportTrialBalance\(session\.businessId, fromDate, toDate\)/)
  assert.doesNotMatch(context, /currency: 'PKR paisas/)
  assert.match(safety, /never multiply or divide it by 100/)
})

test('Financial Reports cash balance includes every active configured money account', () => {
  const rows = [
    { account_code: '1010', balance: 1_432_000 },
    { account_code: '1020', balance: -1_070_000 },
    { account_code: '1030', balance: -400_000 },
    { account_code: '1061', balance: 393_000 },
  ]
  assert.equal(sumMoneyAccountBalances(rows, ['1010', '1020', '1030', '1040']), -38_000n)
  assert.equal(sumMoneyAccountBalances(rows, ['1010', '1020', '1030', '1061']), 355_000n)
})
