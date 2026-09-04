import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const accountingAccess = await source('src/lib/accounting/data-access.ts')
const coaRoute = await source('src/app/api/setup/coa/route.ts')
const expenseRoute = await source('src/app/api/expense-batch/route.ts')
const expenseView = await source('src/components/erp/views/expense-batch-view.tsx')
const accountsView = await source('src/components/erp/views/accounts-view.tsx')
const voucherAccess = await source('src/lib/vouchers/data-access.ts')
const dayBookRoute = await source('src/app/api/day-book/route.ts')
const dayBookView = await source('src/components/erp/views/day-book-view.tsx')
const trialRoute = await source('src/app/api/trial-balance/route.ts')
const ledgerRoute = await source('src/app/api/ledger/[accountId]/route.ts')
const ledgerAccess = await source('src/lib/accounting/voucher-supabase.ts')
const ledgerView = await source('src/components/erp/views/ledger-drilldown-view.tsx')
const reportsAccess = await source('src/lib/reports/data-access.ts')
const reportsRoute = await source('src/app/api/reports/route.ts')
const reportsView = await source('src/components/erp/views/reports-view.tsx')

test('configured legacy production loads its business-scoped Chart of Accounts', () => {
  assert.match(accountingAccess, /usesLegacyTransactionSchema/)
  assert.match(accountingAccess, /\.from\('account_categories'\)[\s\S]*\.eq\('business_id', businessId\)/)
  assert.match(accountingAccess, /\.from\('accounts'\)[\s\S]*\.eq\('business_id', businessId\)/)
  assert.match(coaRoute, /operational-fallback' && !isSupabaseConfigured/)
})

test('Expense Batch accepts legacy text identities but enforces account roles server-side', () => {
  // Legacy detection is read once and reused: categories only exist in the
  // legacy accounting schema, and the UUID id checks hang off the same answer.
  assert.match(expenseRoute, /usesLegacyAccounting = isSupabaseConfigured\(\) && await usesLegacyTransactionSchema\(\)/)
  assert.match(expenseRoute, /usesUuidLedger = isSupabaseConfigured\(\) && !usesLegacyAccounting/)
  assert.match(expenseRoute, /paymentAccount\.isBusinessAccount/)
  assert.match(expenseRoute, /paymentAccount\.category\.type !== 'Asset'/)
  assert.match(expenseRoute, /account\.category\.type !== 'Expense'/)
  assert.match(expenseRoute, /requirePermission\(loaded, 'can_create_expense_batch'\)/)
  assert.match(expenseView, /No eligible payment accounts configured/)
  assert.match(expenseView, /No eligible expense accounts configured/)
})

test('Accounts and Balances distinguishes tracked zeroes from missing and unavailable values', () => {
  assert.match(accountsView, /row \? BigInt\(row\.balance\) : null/)
  assert.match(accountsView, /bal === null \? 'Not tracked'/)
  assert.match(accountsView, /'Unavailable'/)
  assert.match(accountsView, /No business accounts configured/)
  assert.match(accountsView, /!usableAccountingData/)
})

test('Day Book dispatches to the verified legacy report and preserves scope and permissions', () => {
  assert.match(voucherAccess, /legacy \? 'day_book' : 'ledger_day_book'/)
  assert.match(dayBookRoute, /dayBook\(loaded\.businessId, filters\)/)
  assert.match(dayBookRoute, /can_view_day_book/)
  assert.match(dayBookRoute, /can_view_vouchers/)
  assert.match(dayBookView, /No transactions yet/)
  assert.match(dayBookView, /row\.lines\.map/)
})

test('Trial Balance list and drill-down use matching legacy report contracts', () => {
  assert.match(trialRoute, /trialBalanceViaLegacySupabase\(su\.businessId\)/)
  assert.match(ledgerAccess, /rpc\('account_ledger'/)
  assert.match(ledgerAccess, /accountLedgerViaLegacySupabase/)
  assert.match(ledgerRoute, /getAccountById\(su\.businessId, accountId\)/)
  assert.match(ledgerRoute, /accountLedgerSmart\(su\.businessId, accountId\)/)
  assert.match(ledgerRoute, /requirePermission\(loaded, 'can_view_ledgers'\)/)
})

test('Financial reports use the verified legacy report source without bypassing report scope or dates', () => {
  assert.match(reportsAccess, /usesLegacyTransactionSchema/)
  assert.match(reportsAccess, /financialReportRpc<any\[]>\('ledger_profit_loss', 'report_profit_loss'/)
  assert.match(reportsAccess, /financialReportRpc<any\[]>\('ledger_balance_sheet', 'report_balance_sheet'/)
  assert.match(reportsAccess, /financialReportRpc<any\[]>\('ledger_trial_balance', 'trial_balance'/)
  assert.match(reportsAccess, /p_from_date: fromDate/)
  assert.match(reportsAccess, /p_to_date: toDate/)
  assert.match(reportsRoute, /legacyReportsSupported/)
  assert.match(reportsRoute, /reportTrialBalance\(bid, fromDate, toDate\)/)
  assert.match(reportsRoute, /hasPermission\(loaded, requiredPerm\)/)
  assert.match(reportsRoute, /const bid = loaded\.businessId/)
  assert.match(reportsView, /No revenue in this period\./)
  assert.match(reportsView, /Unable to load financial report\./)
  assert.match(reportsView, /Financial report is not available for this business\./)
})

test('ledger drill-down renders real empty and retry states without exposing request details', () => {
  assert.match(ledgerView, /apiFetchJson/)
  assert.match(ledgerView, /No ledger entries yet/)
  assert.match(ledgerView, /Unable to load account activity/)
  assert.match(ledgerView, /q\.refetch\(\)/)
  assert.doesNotMatch(ledgerView, /requestId/)
})
