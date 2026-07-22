import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const migration = await readFile('supabase/migrations/00016_phase2_returns_commission.sql', 'utf8')
const returnRoute = await readFile('src/app/api/sales/[id]/return/route.ts', 'utf8')
const paymentRoute = await readFile('src/app/api/sales/[id]/payment/route.ts', 'utf8')
const detailView = await readFile('src/components/erp/views/invoice-detail-view.tsx', 'utf8')

test('linked return locks source invoice and item rows before mutable work', () => {
  assert.match(migration, /from public\.invoices[\s\S]{0,160}for update/i)
  assert.match(migration, /from public\.invoice_items ii[\s\S]{0,360}for update/i)
  assert.match(migration, /original_invoice_item_id = ii\.id/)
  assert.match(migration, /v_requested \+ v_line\.prior_returned > v_line\.qty/)
})

test('linked returns use invoice-item UUID identity, idempotency, and exact-once stock', () => {
  assert.match(migration, /\(v_item->>'invoice_item_id'\)::uuid/)
  assert.match(migration, /sale_return_documents[\s\S]{0,240}idempotency_key/i)
  assert.match(migration, /update public\.products set stock = stock \+ v_requested/i)
  assert.match(migration, /post_sale_return\(\n  p_business_id uuid, p_original_invoice_id text, p_items jsonb/i)
  assert.match(returnRoute, /invoiceItemId: z\.string\(\)\.uuid\(\)/)
})

test('return money, refund mode, customer balances, and statuses are production based', () => {
  assert.match(migration, /debit = greatest\(coalesce\(debit, 0\) - v_return_total, 0\)/)
  assert.match(migration, /credit = coalesce\(credit, 0\) \+ greatest\(v_return_total - coalesce\(debit, 0\), 0\)/)
  assert.match(migration, /if v_cash_refund and v_return_total > 0 then/i)
  assert.match(migration, /'Paid', upper\(p_refund_mode\)/)
  assert.match(migration, /'Partially Returned'/)
  assert.match(migration, /'Returned'/)
  assert.doesNotMatch(migration, /public\.(accounts|vouchers|voucher_lines)/i)
})

test('collection commission is snapshot, proportional, rounded, and owner reporting-only', () => {
  assert.match(migration, /phase2_capture_commission_eligibility/)
  assert.match(migration, /commission_rate/)
  assert.match(migration, /v_owner_only/)
  assert.match(migration, /floor\(v_item\.eligible_amount \* least\(v_invoice\.paid, v_invoice\.total\) \/ v_invoice\.total\)/)
  assert.match(migration, /greatest\(least\(v_target - v_prior, v_item\.eligible_amount - v_prior\), 0\)/)
  assert.match(migration, /return_adjustment/)
  assert.match(migration, /receive_invoice_payment\(/)
  assert.match(paymentRoute, /BigInt\(parsed\.data\.amount\)/)
})

test('cross-business and unauthorized mutation paths are denied and PUBLIC/anon are revoked', () => {
  assert.match(migration, /phase2_assert_actor/)
  assert.match(migration, /pr\.business_id = p_business_id/)
  assert.match(migration, /pr\.id = auth\.uid\(\)/)
  assert.match(migration, /pr\.status = 'Active'/)
  assert.match(migration, /assert_can_write_business\(p_business_id, array\[p_permission\]\)/)
  assert.match(migration, /auth_has_any\(array\[p_permission\]\)/)
  assert.match(migration, /revoke all on function public\.post_sale_return[\s\S]*from public, anon/i)
  assert.match(migration, /revoke all on function public\.receive_invoice_payment[\s\S]*from public, anon/i)
  assert.match(migration, /grant execute on function public\.post_sale_return[\s\S]*to authenticated, service_role/i)
})

test('authorization uses only the verified profiles role, permission, and seller model', () => {
  for (const absent of ['public.permissions', 'public.role_permissions', 'public.roles', 'public.salesmen']) {
    assert.ok(!migration.includes(absent), `must not reference absent ${absent}`)
  }
  assert.match(migration, /v_profile\.role <> 'Owner'/)
  assert.match(migration, /v_profile\.perms/)
  assert.match(migration, /v_seller_profile_id := coalesce\(auth\.uid\(\), p_created_by\)/)
  assert.match(migration, /pr\.id = v_seller_profile_id/)
  assert.match(migration, /pr\.role = 'Owner'/)
  assert.match(migration, /v_owner_only/)
  assert.match(migration, /v_seller_profile_id, p_customer_id/)
})

test('Phase 2 preconditions contain only verified production tables', () => {
  const preconditions = migration.slice(migration.indexOf('from (values'), migration.indexOf(') required(required_name'))
  const expected = ['businesses', 'profiles', 'products', 'invoices', 'invoice_items', 'customers', 'payments', 'sale_return_documents', 'sale_return_lines', 'commission_events', 'identity_sequences']
  for (const table of expected) assert.ok(preconditions.includes(`public.${table}`), `must require ${table}`)
  assert.equal((preconditions.match(/to_regclass\('public\./g) ?? []).length, expected.length)
})

test('the authorization repair does not change migrations 00009 through 00015', () => {
  const changed = execFileSync('git', ['diff', '--name-only', '62855c80183554677e9a754d268852b67bee115e'], { encoding: 'utf8' })
  assert.doesNotMatch(changed, /supabase\/migrations\/000(?:09|10|11|12|13|14|15)/)
})

test('only proven stale UUID overloads are removed after text-safe replacements', () => {
  const createAt = migration.indexOf('create or replace function public.post_sale_return')
  const dropAt = migration.indexOf("drop function if exists public.process_return(uuid, jsonb, text)")
  assert.ok(createAt >= 0 && dropAt > createAt)
  for (const signature of ['process_return(uuid, jsonb, text)', 'mark_invoice_paid(uuid)', 'receive_payment(uuid, uuid, numeric, text)']) assert.ok(migration.includes(signature))
  assert.match(migration, /proname = 'record_sale'[\s\S]{0,240}~\* '\(\^\|, \)uuid'/)
})

test('the UI provides a linked-return preview and invoice-specific collection action', () => {
  for (const text of ['Sold', 'Returned', 'Remaining', 'Customer credit', 'returnNo', 'Collect payment']) assert.ok(detailView.includes(text))
  assert.ok(detailView.includes('/payment'))
})

test('Phase 2 financial mutation callers avoid floating-point arithmetic', () => {
  for (const source of [returnRoute, paymentRoute]) {
    assert.doesNotMatch(source, /parseFloat|Math\.round|Number\([^.]|toFixed/)
  }
})
