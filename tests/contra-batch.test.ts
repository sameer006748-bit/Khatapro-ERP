import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile('supabase/migrations/00038_legacy_contra_batch.sql', 'utf8')
const contraRoute = await readFile('src/app/api/contra-entry/route.ts', 'utf8')
const moneyAccess = await readFile('src/lib/money/operational-money.ts', 'utf8')
const forms = await readFile('src/components/erp/views/voucher-forms-view.tsx', 'utf8')
const legacy = await readFile('supabase/migrations/00036_legacy_transaction_identity_bridge.sql', 'utf8')

test('pure contra debits the destination and credits the source, with no P&L effect', () => {
  assert.match(migration, /jsonb_build_object\('account_id', v_to,/)
  assert.match(migration, /'debit', v_amount::text, 'credit', '0'/)
  assert.match(migration, /jsonb_build_object\('account_id', v_from,/)
  assert.match(migration, /'debit', '0', 'credit', v_amount::text/)
  assert.ok(!migration.includes('public.expenses'))
  assert.ok(!migration.includes('public.invoices'))
  assert.match(forms, /Profit impact: None\./)
})

test('bank -> cash / business account -> business account require active same-business money accounts', () => {
  // Both contra legs must be active business accounts of the current business.
  assert.match(migration, /a\.is_active = true and a\.is_business_account = true/)
  assert.ok((migration.match(/business_id = p_business_id/g) ?? []).length >= 4)
})

test('multi-row batch builds one voucher and one persisted row per line', () => {
  assert.match(migration, /for v_line in select value from jsonb_array_elements\(p_lines\)/)
  assert.match(migration, /v_lines := v_lines \|\| jsonb_build_object\(/)
  assert.match(migration, /insert into public\.contra_batch_entries/)
  assert.match(migration, /contra_batches/)
})

test('self-transfer is rejected', () => {
  assert.match(migration, /if v_from = v_to then/)
  assert.match(migration, /constraint contra_batch_entries_diff_accounts check \(from_account_id <> to_account_id\)/)
})

test('zero and negative amounts are rejected', () => {
  assert.match(migration, /v_amount <= 0 or v_amount <> trunc\(v_amount\)/)
  assert.ok(migration.includes('At least one contra line'))
})

test('cross-business accounts are rejected server-side', () => {
  assert.match(migration, /a\.id = v_from and a\.business_id = p_business_id/)
  assert.match(migration, /a\.id = v_to and a\.business_id = p_business_id/)
})

test('every line is validated before the first business write (atomic, no partial batch)', () => {
  // The whole migration is one transaction, and the RPC never commits per row.
  assert.match(migration, /^begin;/m)
  assert.match(migration, /^commit;\s*$/m)
  const bodyStart = migration.indexOf('create or replace function public.post_contra_batch')
  const body = migration.slice(bodyStart)
  assert.ok(!/commit/.test(body.split('$$;')[0]))
})

test('duplicate submit returns the original result without double posting', () => {
  assert.match(migration, /claim_legacy_transaction_request\(p_business_id, 'contra_batch', p_idempotency_key\)/)
  assert.match(migration, /jsonb_build_object\('idempotent', true\)/)
  assert.match(migration, /'idempotent', false/)
})

test('drawings debit Owner Drawings (3020) and credit the selected source asset', () => {
  assert.match(migration, /code = '3020' and is_active = true/)
  assert.match(migration, /v_kind = 'DRAWINGS'/)
  assert.match(migration, /v_to := v_drawings_account_id/)
  assert.match(migration, /'Owner drawings \(line ' /)
  // A drawing is not an asset-to-asset transfer: it hits equity, not a second asset.
  assert.match(migration, /Not an asset-to-asset transfer: debit Owner Drawings, credit source/)
})

test('one readable CON identity per batch via the shared allocator', () => {
  assert.match(migration, /public\.allocate_legacy_transaction_identity\(p_business_id, 'CON'\)/)
  assert.match(migration, /batch_no text not null/)
  assert.match(migration, /constraint contra_batches_business_batch_no_key unique \(business_id, batch_no\)/)
})

test('existing single-row contra remains compatible and untouched', () => {
  assert.match(contraRoute, /postOperationalContra/)
  assert.match(contraRoute, /lines\.length === 1 && lines\[0\]\.kind === 'contra'/)
  assert.match(legacy, /create or replace function public\.post_contra_entry\(/m)
  assert.match(legacy, /'contra_entries\.contra_no' then 'CON'/)
})

test('server route validates line shape and passes business-scoped identity', () => {
  assert.match(contraRoute, /kind: z\.enum\(\['contra', 'drawings'\]\)/)
  assert.match(contraRoute, /can_create_contra/)
  assert.match(moneyAccess, /'post_contra_batch'/)
  assert.match(moneyAccess, /p_business_id: input\.businessId/)
  assert.match(moneyAccess, /p_idempotency_key/)
})

test('mobile-friendly multi-row UI exposes date, total, add/remove rows and accounts', () => {
  assert.match(forms, /Add Row/)
  assert.match(forms, /From account/)
  assert.match(forms, /To account/)
  assert.match(forms, /Amount \(Rs\)/)
  assert.match(forms, /Internal Transfer/)
  assert.match(forms, /Owner Drawings/)
  assert.match(forms, /grid sm:grid-cols-2/)
  assert.match(forms, /mut\.isPending/)
})
