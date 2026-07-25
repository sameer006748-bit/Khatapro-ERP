import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const migration = await readFile('supabase/migrations/00019_rider_partial_delivery.sql', 'utf8')
const route = await readFile('src/app/api/delivery-orders/[id]/delivered/route.ts', 'utf8')
const returnedRoute = await readFile('src/app/api/delivery-orders/[id]/returned/route.ts', 'utf8')
const dataAccess = await readFile('src/lib/delivery/data-access.ts', 'utf8')

test('quantity progress enforces ordered, delivered, returned, and remaining bounds', () => {
  assert.match(migration, /delivery_line_progress_total_check[\s\S]{0,100}delivered_qty \+ returned_qty <= ordered_qty/i)
  assert.match(migration, /Delivered quantity exceeds remaining quantity/)
  assert.match(migration, /Returned quantity exceeds remaining quantity/)
  assert.match(migration, /sum\(ordered_qty - delivered_qty - returned_qty\)/)
})

test('full, partial, returned and failed outcomes are explicit', () => {
  for (const status of ['Delivered', 'Partially Delivered', 'Returned / Failed']) {
    assert.ok(migration.includes(status))
  }
  assert.match(migration, /v_total_remaining = 0 and v_total_returned = 0/)
  assert.match(migration, /v_total_remaining = 0 and v_total_delivered = 0/)
})

test('rider, actor and business are server-controlled and cross-business safe', () => {
  assert.match(migration, /p_actor_id is null/)
  assert.match(migration, /pr\.business_id = p_business_id/)
  assert.match(migration, /r\.business_id = p_business_id[\s\S]{0,120}r\.profile_id = v_profile\.id/)
  assert.match(migration, /v_invoice\.rider_id is distinct from v_rider\.id/)
  const deliveredSchema = route.slice(route.indexOf('const Schema'), route.indexOf('export async function'))
  const returnedSchema = returnedRoute.slice(returnedRoute.indexOf('const Schema'), returnedRoute.indexOf('export async function'))
  assert.doesNotMatch(deliveredSchema, /businessId/)
  assert.doesNotMatch(returnedSchema, /businessId/)
})

test('duplicate outcome is idempotent and changed payload conflicts', () => {
  assert.match(migration, /request_fingerprint/)
  assert.match(migration, /Idempotency key conflicts with a different delivery outcome/)
  assert.match(migration, /return v_existing\.result \|\| jsonb_build_object\('idempotent', true\)/)
  assert.match(migration, /unique \(business_id, idempotency_key\)/)
})

test('COD is capped by delivered value and is not receipted or commissioned at delivery', () => {
  const outcome = migration.slice(migration.indexOf('create or replace function public.record_delivery_outcome'))
  assert.match(outcome, /ii\.unit_price \* dlp\.delivered_qty/)
  assert.match(outcome, /COD collection exceeds the actually delivered collectible amount/)
  assert.match(outcome, /insert into public\.rider_cash_ledger/)
  assert.doesNotMatch(outcome, /insert into public\.payments/)
  assert.doesNotMatch(outcome, /phase2_allocate_collection_commission/)
  assert.doesNotMatch(outcome, /set paid\s*=/)
})

test('operational returns use the authoritative linked Sale Return and restore stock once', () => {
  assert.match(migration, /public\.post_sale_return\(/)
  assert.match(migration, /'delivery-return:' \|\| p_idempotency_key/)
  assert.doesNotMatch(migration, /update public\.products set stock/)
  assert.match(migration, /Financially settled delivery cannot be returned or failed/)
})

test('delivery routes accept per-line outcomes and data access calls the atomic RPC', () => {
  assert.match(route, /invoiceItemId/)
  assert.match(route, /deliveredQty/)
  assert.match(route, /returnedQty/)
  assert.match(returnedRoute, /invoiceItemId/)
  assert.match(dataAccess, /record_delivery_outcome/)
  assert.match(dataAccess, /p_actor_id/)
})

test('audited outcome has readable identity, actor and timestamp', () => {
  assert.match(migration, /outcome_no text not null/)
  assert.match(migration, /actor_id uuid not null/)
  assert.match(migration, /occurred_at timestamptz not null default now\(\)/)
  assert.match(migration, /allocate_readable_identity\(p_business_id, 'DO'\)/)
})
