import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const migration = await readFile('supabase/migrations/00017_phase3_rider_cod_settlement.sql', 'utf8')
const inspect = await readFile('supabase/migrations/00017_phase3_rider_cod_settlement_inspect.sql', 'utf8')

test('COD delivery records rider-held cash without receipt, paid update, or commission', () => {
  const delivery = migration.slice(migration.indexOf('create or replace function public.complete_cod_delivery'), migration.indexOf('create or replace function public.return_rider_delivery'))
  assert.match(delivery, /insert into public\.rider_cash_ledger/i)
  assert.match(delivery, /event_type, amount[\s\S]{0,200}'collection'/i)
  assert.doesNotMatch(delivery, /insert into public\.payments/i)
  assert.doesNotMatch(delivery, /phase2_allocate_collection_commission/i)
  assert.doesNotMatch(delivery, /set paid\s*=/i)
})

test('delivery validates active rider, assignment, text invoice, collection cap, and idempotency conflict', () => {
  assert.match(migration, /complete_cod_delivery\(\n  p_business_id uuid,\n  p_invoice_id text,\n  p_cash_collected numeric,\n  p_idempotency_key text/i)
  assert.match(migration, /r\.profile_id = v_profile\.id/)
  assert.match(migration, /v_invoice\.rider_id is distinct from v_rider\.id/)
  assert.match(migration, /p_cash_collected > v_outstanding/)
  assert.match(migration, /Idempotency key conflicts with a different delivery request/)
})

test('settlement is oldest-first, supports partial allocations, and cannot exceed held COD', () => {
  const settlement = migration.slice(migration.indexOf('create or replace function public.settle_rider_cod'), migration.indexOf('create or replace function public.get_rider_cod_balances'))
  assert.match(settlement, /order by c\.delivered_at nulls last, c\.created_at, c\.id/i)
  assert.match(settlement, /v_allocate := least\(v_remaining, greatest\(v_entry\.amount - v_entry\.settled, 0\)\)/)
  assert.match(settlement, /if p_amount > v_available then raise exception 'Settlement exceeds rider held COD'/)
  assert.match(settlement, /for update of c/i)
  assert.match(settlement, /for update;/i)
})

test('settlement creates Received payments once, updates invoice/customer once, and earns Phase 2 commission only then', () => {
  const settlement = migration.slice(migration.indexOf('create or replace function public.settle_rider_cod'), migration.indexOf('create or replace function public.get_rider_cod_balances'))
  assert.match(settlement, /insert into public\.payments[\s\S]{0,300}'Received'/i)
  assert.match(settlement, /update public\.invoices set paid = paid \+ v_allocate/i)
  assert.match(settlement, /update public\.customers set credit = greatest\(coalesce\(credit, 0\) - v_allocate, 0\)/i)
  assert.match(settlement, /phase2_allocate_collection_commission\(p_business_id, v_entry\.invoice_id, v_payment_id\)/)
  assert.match(settlement, /phase3:payment:/)
})

test('riders cannot settle, cross-business access is checked, and balances are business-scoped', () => {
  assert.match(migration, /if v_profile\.role = 'Rider' then raise exception 'Rider cannot settle own cash'/)
  assert.match(migration, /pr\.business_id = p_business_id/)
  assert.match(migration, /get_rider_cod_balances\(/)
  assert.match(migration, /Rider can only view own COD balance/)
})

test('delivery return remains non-financial and rejects settled delivery', () => {
  const returned = migration.slice(migration.indexOf('create or replace function public.return_rider_delivery'), migration.indexOf('create or replace function public.settle_rider_cod'))
  assert.match(returned, /Settled delivery cannot be returned/)
  assert.doesNotMatch(returned, /insert into public\.payments/i)
  assert.doesNotMatch(returned, /phase2_allocate_collection_commission/i)
  assert.doesNotMatch(returned, /sale_return_documents/i)
})

test('RPCs are SECURITY DEFINER, execute is not public/anon, and inspection checks the posture', () => {
  for (const name of ['mark_cod_out_for_delivery', 'complete_cod_delivery', 'return_rider_delivery', 'settle_rider_cod', 'get_rider_cod_balances']) {
    assert.match(migration, new RegExp(`function public\\.${name}[\\s\\S]{0,500}security definer[\\s\\S]{0,100}set search_path = public`, 'i'))
  }
  assert.match(migration, /revoke all on function public\.complete_cod_delivery\(uuid, text, numeric, text\) from public, anon/i)
  assert.match(migration, /grant execute on function public\.settle_rider_cod\(uuid, uuid, numeric, text, text, text\) to authenticated, service_role/i)
  assert.match(inspect, /public_execute/)
  assert.match(inspect, /anon_execute/)
})

test('only supported production tables are referenced and stale COD mutations are removed', () => {
  for (const absent of ['public.accounts', 'public.roles', 'public.permissions', 'public.role_permissions', 'public.salesmen', 'public.vouchers']) {
    assert.ok(!migration.includes(absent), `must not reference ${absent}`)
  }
  for (const stale of ['mark_order_delivered', 'mark_order_returned', 'create_cod_submission', 'confirm_cod_submission']) assert.ok(inspect.includes(stale))
})

test('migrations 00009 through 00016 remain unchanged', () => {
  const changed = execFileSync('git', ['diff', '--name-only', '985eed321e6945dc69614c77f63e05a4b240ecf8'], { encoding: 'utf8' })
  assert.doesNotMatch(changed, /supabase\/migrations\/000(?:09|10|11|12|13|14|15|16)/)
})
