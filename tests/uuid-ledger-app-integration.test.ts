import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const accounting = await readFile('src/lib/accounting/data-access.ts', 'utf8')
const posting = await readFile('src/lib/accounting/voucher-supabase.ts', 'utf8')
const reports = await readFile('src/lib/reports/data-access.ts', 'utf8')
const vouchers = await readFile('src/lib/vouchers/data-access.ts', 'utf8')
const sales = await readFile('src/lib/sales/data-access.ts', 'utf8')
const delivery = await readFile('src/lib/delivery/data-access.ts', 'utf8')
const products = await readFile('src/lib/products/data-access.ts', 'utf8')
const subcategories = await readFile('src/lib/money/persisted-account-subcategories.ts', 'utf8')
const compatibility = await readFile('src/lib/supabase/rpc-compatibility.ts', 'utf8')
const reportsView = await readFile('src/components/erp/views/reports-view.tsx', 'utf8')
const reportsRoute = await readFile('src/app/api/reports/route.ts', 'utf8')
const ownerDashboardRoute = await readFile('src/app/api/dashboard/owner/route.ts', 'utf8')
const ownerDashboardSummary = await readFile('src/lib/dashboard/owner-summary.ts', 'utf8')
const normalizedReports = reports.replace(/\r\n/g, '\n')

test('production chart and balances use canonical ledger tables and RPC', () => {
  assert.match(accounting, /probeTable\(_phase1Cache, 'ledger_accounts'\)/)
  assert.match(accounting, /\.from\('ledger_account_categories'\)/)
  assert.match(accounting, /\.from\('ledger_accounts'\)/)
  assert.match(accounting, /\.rpc\('ledger_account_balances'/)
})

test('production voucher posting calls the canonical service-only RPC with retry key', () => {
  assert.match(posting, /\.rpc\('post_ledger_voucher'/)
  assert.match(posting, /p_idempotency_key: idempotencyKey \?\? randomUUID\(\)/)
  assert.match(posting, /debit_paisas: l\.debit\.toString\(\)/)
  assert.match(posting, /p_reverses_voucher_id: null/)
})

test('General Ledger and Trial Balance consumers use canonical RPCs', () => {
  assert.match(posting, /\.rpc\('ledger_trial_balance'/)
  assert.match(posting, /\.rpc\('ledger_general_ledger'/)
  assert.match(posting, /running_balance_paisas/)
})

test('P&L and Balance Sheet have no active app-side accounting patches', () => {
  const profitLoss = normalizedReports.slice(
    normalizedReports.indexOf('export async function reportProfitLoss'),
    normalizedReports.indexOf('export async function reportBalanceSheet'),
  )
  const balanceSheet = normalizedReports.slice(
    normalizedReports.indexOf('export async function reportBalanceSheet'),
    normalizedReports.indexOf('/*\n * Historical app-side legacy-table fallbacks'),
  )
  assert.match(profitLoss, /ledger_profit_loss/)
  assert.doesNotMatch(profitLoss, /\.filter\(/)
  assert.match(balanceSheet, /ledger_balance_sheet/)
  assert.doesNotMatch(balanceSheet, /voucher_lines|Current Earnings fallback|correctBalances/)
  assert.match(reportsView, /section === 'COST_OF_GOODS_SOLD'/)
  assert.match(reportsView, /BigInt\(row\.amount/)
  assert.doesNotMatch(reportsView, /account_code === '5010'/)
  assert.match(reportsRoute, /section === 'COST_OF_GOODS_SOLD'/)
  assert.match(reportsRoute, /account_code === '1300'/)
  assert.doesNotMatch(reportsRoute, /account_code === '1310'|account_code === '5010'/)
  assert.match(ownerDashboardRoute, /buildOwnerDashboardPayload/)
  assert.match(ownerDashboardSummary, /getAccountByCode\(bid, '4000'\)/)
  assert.doesNotMatch(ownerDashboardSummary, /getAccountByCode\(bid, '4010'\)/)
})

test('financial report defaults use the Asia/Karachi business date', () => {
  assert.match(reportsView, /bizDateString\(new Date\(\)\)/)
  assert.match(reportsRoute, /const businessToday = bizDateString\(new Date\(\)\)/)
  assert.doesNotMatch(
    reportsView.slice(0, reportsView.indexOf('function exportCsv')),
    /toISOString\(\)\.slice\(0, 10\)/,
  )
})

test('manual payment, receipt, journal, Contra, and expense entry use one voucher source', () => {
  assert.match(vouchers, /async function postCanonicalVoucher/)
  assert.match(vouchers, /post_ledger_voucher/)
  assert.match(vouchers, /voucherType: 'PV'/)
  assert.match(vouchers, /voucherType: 'RV'/)
  assert.match(vouchers, /voucherType: 'JV'/)
  assert.match(vouchers, /voucherType: 'CT'/)
  assert.match(vouchers, /voucherType: 'EXP'/)
})

test('sale, return, collection, delivery, settlement, and opening stock use atomic wrappers', () => {
  // The sale RPC name is chosen by the compatibility boundary: the deployed
  // atomic wrapper today, and the mixed sale+return wrapper once migration
  // 00033 is applied. Both are atomic ledger wrappers; neither is a raw table
  // write, which is what this test exists to protect.
  assert.match(sales, /const rpcName = salePostingRpcName\(\)/)
  assert.match(sales, /admin\.rpc\(rpcName, payload\)/)
  assert.match(compatibility, /'post_sale_phase2_ledger'/)
  assert.match(compatibility, /'post_sale_with_returns_ledger'/)
  assert.match(sales, /\.rpc\('post_sale_return_ledger'/)
  assert.match(sales, /\.rpc\('receive_invoice_payment_ledger'/)
  assert.match(delivery, /\.rpc\('record_delivery_outcome'/)
  assert.match(delivery, /\.rpc\('settle_rider_cod'/)
  assert.match(products, /\.rpc\('post_opening_stock_ledger'/)
})

test('Account Subcategories transport canonical UUID account IDs', () => {
  assert.match(subcategories, /accountId: string/)
  assert.match(subcategories, /p_account_id: input\.accountId/)
  assert.doesNotMatch(subcategories, /p_account_ref/)
})

test('money mutation screens retain one idempotency key across retries', async () => {
  const files = await Promise.all([
    readFile('src/components/erp/views/voucher-forms-view.tsx', 'utf8'),
    readFile('src/components/erp/views/journal-voucher-view.tsx', 'utf8'),
    readFile('src/components/erp/views/expense-batch-view.tsx', 'utf8'),
    readFile('src/components/erp/views/invoice-detail-view.tsx', 'utf8'),
    readFile('src/components/erp/views/delivery-view.tsx', 'utf8'),
  ])
  const source = files.join('\n')
  assert.match(source, /useState\(\(\) => crypto\.randomUUID\(\)\)/)
  assert.match(source, /idempotencyKey/)
  assert.doesNotMatch(source, /idempotencyKey:\s*crypto\.randomUUID\(\)/)
})
