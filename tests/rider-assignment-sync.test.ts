import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const migration = await readFile('supabase/migrations/00022_rider_assignment_sync.sql', 'utf8')
const phase19 = await readFile('supabase/migrations/00019_rider_partial_delivery.sql', 'utf8')
const phase3 = await readFile('supabase/migrations/00017_phase3_rider_cod_settlement.sql', 'utf8')

test('assignment sync keeps delivery_orders.rider_id authoritative', () => {
  assert.match(migration, /create or replace function public\.assign_rider_to_order/)
  assert.match(migration, /update public\.delivery_orders\s*\n\s*set rider_id = p_rider_id/)
})

test('assignment sync writes the same rider onto the linked invoice', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.assign_rider_to_order'))
  assert.match(fn, /update public\.invoices\s*\n\s*set rider_id = p_rider_id::uuid\s*\n\s*where business_id = p_business_id and id = v_order\.invoice_id/)
})

test('sync runs on every assignment call, so reassignment updates invoices.rider_id too', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.assign_rider_to_order'))
  assert.doesNotMatch(fn, /if v_old_rider_id is null then[\s\S]{0,120}update public\.invoices/)
  assert.match(fn, /v_old_rider_id := v_order\.rider_id;[\s\S]*update public\.invoices/)
})

test('legacy behavior (order lookup, status guard, rider validity, audit log) is unchanged', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.assign_rider_to_order'))
  assert.match(fn, /Delivery order not found/)
  assert.match(fn, /Cannot assign rider: order status is/)
  assert.match(fn, /Invalid or inactive rider/)
  assert.match(fn, /insert into public\.delivery_status_events/)
  assert.match(fn, /insert into public\.audit_logs/)
})

test('the invoices.rider_id column the sync targets is the same one Phase 3 and Phase 19 authorize against', () => {
  assert.match(phase3, /v_invoice\.rider_id is distinct from v_rider\.id/)
  assert.match(phase19, /v_invoice\.rider_id is distinct from v_rider\.id/)
})

test('migration is additive only: no drop or alter of delivery_orders/invoices columns', () => {
  assert.doesNotMatch(migration, /drop column|drop table/i)
  assert.doesNotMatch(migration, /alter table public\.(delivery_orders|invoices)/)
})
