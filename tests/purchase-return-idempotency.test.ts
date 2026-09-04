import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const migration = await readFile('supabase/migrations/00024_purchase_return_idempotency.sql', 'utf8')
const route = await readFile('src/app/api/purchases/[id]/return/route.ts', 'utf8')
const saleReturnRoute = await readFile('src/app/api/sales/[id]/return/route.ts', 'utf8')
const dataAccess = await readFile('src/lib/purchases/data-access.ts', 'utf8')

test('idempotency key is required and stored per business', () => {
  assert.match(migration, /Idempotency key is required/)
  assert.match(migration, /purchase_returns_business_idempotency_idx[\s\S]{0,80}business_id, idempotency_key/)
  assert.match(migration, /add column if not exists idempotency_key text/)
})

test('same key with the same payload returns the original result instead of reposting', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.post_purchase_return'))
  assert.match(fn, /select id, request_fingerprint into v_existing[\s\S]{0,120}where business_id = p_business_id and idempotency_key = p_idempotency_key/)
  assert.match(fn, /if found then[\s\S]{0,260}return v_existing\.id/)
})

test('same key with a changed payload is rejected, not silently reprocessed', () => {
  assert.match(migration, /Idempotency key conflicts with a different purchase return request/)
  const fn = migration.slice(migration.indexOf('create or replace function public.post_purchase_return'))
  assert.match(fn, /v_existing\.request_fingerprint <> v_fingerprint/)
})

test('stock decrement and vendor settlement still happen exactly once per accepted request', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.post_purchase_return'))
  assert.match(fn, /create_stock_movement\(/)
  const stockCalls = fn.match(/create_stock_movement\(/g) ?? []
  assert.equal(stockCalls.length, 1)
  assert.match(fn, /post_voucher\(/)
})

test('cumulative over-return protection remains enforced after the idempotency change', () => {
  assert.match(migration, /update public\.purchase_items\s*\n\s*set returned_quantity = coalesce\(returned_quantity, 0\) \+ v_qty/)
})

test('original purchase remains immutable: only status is derived, no purchase totals are rewritten', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.post_purchase_return'))
  assert.doesNotMatch(fn, /update public\.purchases\s*\n\s*set total\s*=/)
  assert.match(fn, /update public\.purchases\s*\n\s*set status = case/)
})

test('this mirrors the idempotencyKey contract Sale Return already requires', () => {
  assert.match(saleReturnRoute, /idempotencyKey: z\.string\(\)\.uuid\(\)/)
})

test('the route and data-access layer now require and forward an idempotency key', () => {
  assert.match(route, /idempotencyKey/)
  assert.match(dataAccess, /p_idempotency_key/)
})
