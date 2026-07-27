import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const schema = await readFile('supabase/migrations/00025_production_uuid_ledger.sql', 'utf8')
const seed = await readFile('supabase/migrations/00026_seed_ledger_system_chart.sql', 'utf8')
const posting = await readFile('supabase/migrations/00027_atomic_ledger_posting.sql', 'utf8')
const ownerMoney = await readFile('supabase/migrations/00028_owner_money_to_uuid_ledger.sql', 'utf8')
const subcategories = await readFile('supabase/migrations/00029_ledger_account_subcategories.sql', 'utf8')
const reports = await readFile('supabase/migrations/00030_uuid_ledger_reports.sql', 'utf8')
const workflows = await readFile('supabase/migrations/00031_verified_workflows_to_uuid_ledger.sql', 'utf8')
const reconciliation = await readFile('supabase/migrations/00032_uuid_ledger_reconciliation.sql', 'utf8')

test('canonical schema is UUID business-scoped and does not recreate legacy accounting tables', () => {
  for (const table of [
    'ledger_account_categories', 'ledger_accounts',
    'ledger_vouchers', 'ledger_voucher_lines',
  ]) {
    assert.match(schema, new RegExp(`create table public\\.${table}`))
  }
  assert.match(schema, /business_id uuid not null references public\.businesses\(id\)/)
  assert.doesNotMatch(schema, /create table (?:if not exists )?public\.(?:business|accounts|account_categories|vouchers|voucher_lines)\b/)
})

test('business-scoped foreign keys prevent cross-business voucher lines', () => {
  assert.match(schema, /foreign key \(business_id, voucher_id\)[\s\S]*ledger_vouchers\(business_id, id\)/)
  assert.match(schema, /foreign key \(business_id, account_id\)[\s\S]*ledger_accounts\(business_id, id\)/)
  assert.match(schema, /unique \(business_id, readable_number\)/)
  assert.match(schema, /unique \(business_id, idempotency_key\)/)
})

test('whole-paisa line structure and balanced voucher totals are constrained', () => {
  assert.match(schema, /numeric\(20,0\)/)
  assert.match(schema, /ledger_voucher_lines_one_side/)
  assert.match(schema, /debit_paisas > 0 and credit_paisas = 0/)
  assert.match(schema, /total_debit_paisas = total_credit_paisas/)
})

test('posted vouchers and lines are immutable and client mutation rights are absent', () => {
  assert.match(schema, /ledger_vouchers_immutable/)
  assert.match(schema, /ledger_voucher_lines_immutable/)
  assert.match(schema, /revoke all on public\.ledger_vouchers from public, anon, authenticated/)
  assert.match(schema, /post a reversing voucher/)
})

test('system chart seeds required stable accounts without seeding financial amounts', () => {
  for (const code of [
    '1010', '1020', '1030', '1100', '1200', '1300',
    '2010', '2020', '2030', '3010', '3020', '3030',
    '3031', '4000', '5000', '5090', '6000', '6010',
  ]) {
    assert.ok(seed.includes(`'${code}'`), `missing system account ${code}`)
  }
  assert.match(seed, /on conflict \(business_id, account_code\) do nothing/)
  assert.match(seed, /select public\.seed_ledger_system_chart\(b\.id\)/)
  assert.doesNotMatch(seed, /insert into public\.ledger_(?:vouchers|voucher_lines)/)
})

test('system accounts cannot be archived or moved across report classes', () => {
  assert.match(schema, /protect_system_ledger_account/)
  assert.match(schema, /cannot be reclassified or archived/)
  assert.match(seed, /Existing ledger accounts conflict with the required report classes/)
})

test('atomic posting validates accounts, balance, actor, idempotency, and source exact-once', () => {
  assert.match(posting, /Active same-business posting profile is required/)
  assert.match(posting, /Voucher must have at least 2 lines/)
  assert.match(posting, /Unbalanced voucher/)
  assert.match(posting, /cross-business ledger account/)
  assert.match(posting, /Idempotency key conflicts with a different voucher payload/)
  assert.match(posting, /Source transaction is already posted to the ledger/)
  assert.match(posting, /pg_advisory_xact_lock/)
})

test('posting is server-only and reversals create a new voucher', () => {
  assert.match(posting, /revoke all on function public\.post_ledger_voucher[\s\S]*public, anon, authenticated/)
  assert.match(posting, /grant execute on function public\.post_ledger_voucher[\s\S]*to service_role/)
  assert.match(posting, /create or replace function public\.reverse_ledger_voucher/)
  assert.match(posting, /'ledger_reversal'/)
  assert.doesNotMatch(posting, /delete from public\.ledger_|update public\.ledger_vouchers/)
})

test('Contra, Capital, and Drawings post atomically with their true entries', () => {
  assert.match(ownerMoney, /'contra'[\s\S]*v_destination\.ledger_account_id[\s\S]*debit_paisas[\s\S]*v_source\.ledger_account_id[\s\S]*credit_paisas/)
  assert.match(ownerMoney, /'capital'[\s\S]*'3010'/)
  assert.match(ownerMoney, /'drawings'[\s\S]*'3020'/)
  assert.match(ownerMoney, /'business_money_transaction'/)
  assert.match(ownerMoney, /ledger_account_balance_paisas/)
  assert.match(ownerMoney, /id = p_source_account_id or ledger_account_id = p_source_account_id/)
  assert.match(ownerMoney, /v_transaction_id, p_business_id, v_kind, v_source\.id/)
  assert.doesNotMatch(ownerMoney, /'6000'|'4000'|'5000'/)
})

test('subcategories use a UUID ledger FK and protect report classes without changing money', () => {
  assert.match(subcategories, /add column if not exists account_id uuid/)
  assert.match(subcategories, /references public\.ledger_accounts\(business_id, id\)/)
  assert.match(subcategories, /Account cannot move between Balance Sheet and Profit and Loss report classes/)
  assert.doesNotMatch(subcategories, /update public\.ledger_(?:vouchers|voucher_lines)/)
})

test('all core financial reports read canonical ledger tables', () => {
  for (const fn of [
    'ledger_general_ledger', 'ledger_trial_balance', 'ledger_profit_loss',
    'ledger_balance_sheet', 'ledger_account_balances', 'ledger_day_book',
  ]) {
    assert.match(reports, new RegExp(`function public\\.${fn}`))
  }
  assert.match(reports, /account_code = '3031'/)
  assert.match(reports, /is_calculated boolean/)
  assert.doesNotMatch(reports, /public\.(?:accounts|account_categories|vouchers|voucher_lines)\b/)
})

test('verified workflow wrappers preserve atomic operational and ledger posting', () => {
  for (const fn of [
    'post_sale_phase2_ledger', 'post_sale_return_ledger',
    'receive_invoice_payment_ledger', 'record_delivery_outcome_ledger',
    'settle_rider_cod_ledger', 'post_opening_stock_ledger',
  ]) {
    assert.match(workflows, new RegExp(`function public\\.${fn}`))
  }
  assert.match(workflows, /Approved COD collection; no business cash receipt/)
  assert.match(workflows, /Actual COD settlement received/)
  assert.match(workflows, /Collection-earned commission/)
})

test('Opening Stock remains Inventory debit and Opening Balance Equity credit', () => {
  const opening = workflows.slice(workflows.indexOf('create or replace function public.post_opening_stock_ledger'))
  assert.match(opening, /'1100'[\s\S]*'debit_paisas', v_value/)
  assert.match(opening, /'3030'[\s\S]*'credit_paisas', v_value/)
  assert.match(opening, /'opening-stock:' \|\| p_idempotency_key/)
})

test('historical reconciliation is aggregate-only dry run and manual mode fails closed', () => {
  assert.match(reconciliation, /DRY_RUN_ONLY/)
  assert.match(reconciliation, /MANUAL_APPROVED_BACKFILL requires a separate future approval/)
  assert.match(reconciliation, /'containsCustomerPii', false/)
  assert.match(reconciliation, /'mutationPerformed', false/)
  assert.doesNotMatch(reconciliation, /customer_name|customer_phone|customer_address/)
})
