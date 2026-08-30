import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const migration = await readFile('supabase/migrations/00039_legacy_rider_delivery_outcomes.sql', 'utf8')
const dataAccess = await readFile('src/lib/delivery/data-access.ts', 'utf8')
const balancesRoute = await readFile('src/app/api/rider-cod/balances/route.ts', 'utf8')
const settleRoute = await readFile('src/app/api/rider-cod/settle/route.ts', 'utf8')
const deliveryView = await readFile('src/components/erp/views/delivery-view.tsx', 'utf8')

const executableSql = migration.replace(/--.*$/gm, '')
const outcome = migration.slice(
  migration.indexOf('create or replace function public.record_delivery_outcome'),
  migration.indexOf('create or replace function public.get_rider_cod_balances'),
)
const balances = migration.slice(
  migration.indexOf('create or replace function public.get_rider_cod_balances'),
  migration.indexOf('create or replace function public.settle_rider_cod'),
)
const settlement = migration.slice(migration.indexOf('create or replace function public.settle_rider_cod'))

test('00039 targets the verified singular legacy business schema without UUID-ledger dependencies', () => {
  assert.match(migration, /'public\.business', to_regclass\('public\.business'\)/)
  assert.doesNotMatch(executableSql, /public\.businesses\b/)
  for (const absent of ['ledger_accounts', 'rider_cash_ledger', 'delivery_line_progress', 'delivery_events']) {
    assert.ok(!executableSql.includes(absent), `executable migration must not depend on ${absent}`)
  }
})

test('00039 is additive and preserves the existing rider tables and base RPCs', () => {
  for (const table of ['riders', 'delivery_orders', 'rider_cod_submissions', 'rider_cod_submission_items']) {
    assert.match(migration, new RegExp(`'public\\.${table}', to_regclass\\('public\\.${table}'\\)`))
  }
  for (const fn of ['assign_rider_to_order', 'update_delivery_status', 'mark_order_delivered', 'mark_order_returned', 'create_cod_submission', 'confirm_cod_submission']) {
    assert.doesNotMatch(executableSql, new RegExp(`create or replace function public\\.${fn}\\(`))
  }
  assert.doesNotMatch(executableSql, /drop table|drop column|truncate/i)
})

test('00039 adds only the legacy delivery outcome and RDS settlement storage', () => {
  assert.match(migration, /add column if not exists delivery_fee_recognized boolean not null default false/i)
  assert.match(migration, /create table if not exists public\.delivery_line_outcomes/i)
  assert.match(migration, /create table if not exists public\.rider_cod_settlements/i)
  assert.match(migration, /create table if not exists public\.rider_cod_settlement_allocations/i)
  assert.match(migration, /'Partially Delivered'/)
})

test('returned quantities remain authoritative on invoice_items and flow through post_sales_return', () => {
  assert.match(outcome, /v_remaining := v_line\.qty - v_line\.returned_qty - v_prior_delivered/)
  assert.match(outcome, /v_sale_return := public\.post_sales_return\(\s*p_business_id, p_invoice_id,[\s\S]*v_return_items, 'CREDIT', null,[\s\S]*p_actor_id, p_idempotency_key \|\| ':return'/)
  assert.doesNotMatch(outcome, /update public\.products|insert into public\.stock_movements/i)
  assert.match(dataAccess, /\.select\('id, product_name, unit_price, qty, returned_qty'\)/)
  assert.match(dataAccess, /\.from\('delivery_line_outcomes'\)/)
})

test('delivery quantities are whole, nonnegative, unique, and cannot exceed remaining', () => {
  assert.match(outcome, /Outcome quantities must be whole numbers/)
  assert.match(outcome, /Outcome quantities cannot be negative/)
  assert.match(outcome, /An invoice item cannot appear twice in one outcome/)
  assert.match(outcome, /if v_delivered \+ v_returned > v_remaining then/)
  assert.match(outcome, /Delivered \+ returned \(%\) exceeds remaining quantity/)
})

test('delivery accounting recognizes the fee once and never posts Sales revenue again', () => {
  assert.match(outcome, /if v_total_delivered > 0 and not v_order\.delivery_fee_recognized then/)
  assert.match(outcome, /delivery_fee_recognized = delivery_fee_recognized or \(v_fee_this_event > 0\)/)
  assert.match(outcome, /p_cash_collected <> v_collectible/)
  assert.match(outcome, /code = '1310'/)
  assert.match(outcome, /code = '1200'/)
  assert.doesNotMatch(outcome.replace(/--.*$/gm, ''), /code = '4010'/)
})

test('delivery outcomes and rider settlements allocate readable DO and RDS identities', () => {
  assert.match(outcome, /allocate_legacy_transaction_identity\(p_business_id, 'DO'\)/)
  assert.match(settlement, /allocate_legacy_transaction_identity\(p_business_id, 'RDS'\)/)
})

test('COD balances subtract preserved confirmed submissions and new RDS settlements', () => {
  assert.match(balances, /from public\.rider_cod_submissions s/)
  assert.match(balances, /s\.confirmed_cash_amount \+ s\.rider_fee_deduction/)
  assert.match(balances, /from public\.rider_cod_settlements s/)
  assert.match(balances, /coalesce\(c\.collected_cod, 0\)[\s\S]*coalesce\(ls\.settled_cod, 0\)[\s\S]*coalesce\(rs\.settled_cod, 0\)/)
  assert.match(balances, /count\(\*\) filter \(where doo\.cod_collected_amount[\s\S]*coalesce\(los\.amount, 0\) \+ coalesce\(ros\.amount, 0\)\)/)
  assert.match(balances, /min\(doo\.delivered_at::date\) filter \(where doo\.cod_collected_amount/)
})

test('settlement is serialized, bounded by outstanding COD, and allocated oldest-first', () => {
  assert.match(settlement, /from public\.riders[\s\S]{0,120}for update/)
  assert.match(settlement, /if p_amount > v_outstanding then/)
  assert.match(settlement, /exceeds outstanding COD/)
  assert.match(settlement, /order by doo\.delivered_at nulls last, doo\.created_at/)
  assert.match(settlement, /least\(v_remaining, v_settled_so_far\)/)
  assert.match(settlement, /rider_cod_submission_items/)
})

test('settlement posts a balanced money-account debit and 1310 credit for valid modes only', () => {
  assert.match(settlement, /not in \('CASH','BANK','ONLINE'\)/)
  assert.match(settlement, /'account_id', v_money_acct, 'debit', p_amount::text, 'credit', '0'/)
  assert.match(settlement, /'account_id', v_rider_cod_acct, 'debit', '0', 'credit', p_amount::text/)
  assert.match(settlement, /public\.post_voucher\(/)
})

test('outcome and settlement idempotency replays exact requests and rejects changed payloads', () => {
  for (const fn of [outcome, settlement]) {
    assert.match(fn, /claim_legacy_transaction_request/)
    assert.match(fn, /request_fingerprint/)
    assert.match(fn, /jsonb_build_object\('idempotent', true\)/)
    assert.match(fn, /idempotency key was already used for a different/i)
  }
})

test('new RPCs are SECURITY DEFINER with a safe search path and service-role-only execute', () => {
  for (const name of ['record_delivery_outcome', 'get_rider_cod_balances', 'settle_rider_cod']) {
    assert.match(migration, new RegExp(`function public\\.${name}\\([\\s\\S]{0,500}security definer[\\s\\S]{0,100}set search_path = public`, 'i'))
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]{0,180}from public, anon, authenticated`, 'i'))
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]{0,180}to service_role`, 'i'))
  }
})

test('business and rider scope are enforced in SQL and server routes', () => {
  assert.match(outcome, /invoice_id = p_invoice_id and business_id = p_business_id/)
  assert.match(outcome, /id = v_order\.rider_id and business_id = p_business_id/)
  assert.match(settlement, /id = p_rider_id and business_id = p_business_id/)
  assert.match(settleRoute, /loaded\.roleName === 'Rider'/)
  assert.match(settleRoute, /hasPermission\(loaded, 'can_confirm_cod_submission'\)/)
  assert.match(balancesRoute, /getRiderByUserId\(loaded\.businessId, loaded\.userId\)/)
  assert.match(balancesRoute, /riderCodBalances\(loaded\.businessId, riderId\)/)
})

test('Rider UI stays simple, exposes partial quantities, and gates settlement actions', () => {
  assert.match(deliveryView, /if \(isRider\) return <RiderHome user=\{user\} \/>/)
  assert.match(deliveryView, /Delivered \/ Partial/)
  assert.match(deliveryView, /Returned \/ Partial/)
  assert.match(deliveryView, /remaining \{item\.remainingQty\}/)
  assert.match(deliveryView, /COD to collect/)
  assert.match(deliveryView, /Cash collected must equal the COD to collect/)
  assert.match(deliveryView, /user\.roleName !== 'Rider' && user\.permissions\.includes\('can_confirm_cod_submission'\)/)
  assert.match(deliveryView, /const \[idempotencyKey\] = useState\(\(\) => crypto\.randomUUID\(\)\)/)
})
