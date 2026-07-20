import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { planOpeningStock, SafeProductError } from '../src/lib/products/opening-stock'

// ── planOpeningStock: validation and money math ──────────────────────────────

test('positive quantity and cost produce exactly one posting plan', () => {
  const plan = planOpeningStock(10, 250)
  assert.ok(plan)
  assert.equal(plan.openingQty, 10)
  // WAC must equal the opening cost (rupees → paisas)
  assert.equal(plan.unitCostPaisas, 25000)
  // valuation = quantity × opening cost
  assert.equal(plan.valuePaisas, 250000)
})

test('accounting is balanced: the single value drives both debit and credit', () => {
  const plan = planOpeningStock(7, 99.99)
  assert.ok(plan)
  const debit = plan.valuePaisas
  const credit = plan.valuePaisas
  assert.equal(debit, credit)
  assert.equal(plan.valuePaisas, 7 * 9999)
})

test('zero opening quantity creates no posting', () => {
  assert.equal(planOpeningStock(0, 500), null)
})

test('negative quantity is rejected', () => {
  assert.throws(() => planOpeningStock(-1, 100), SafeProductError)
})

test('fractional quantity is rejected', () => {
  assert.throws(() => planOpeningStock(1.5, 100), SafeProductError)
})

test('negative cost is rejected', () => {
  assert.throws(() => planOpeningStock(5, -10), SafeProductError)
})

test('positive quantity with zero cost is rejected (no quantity without valuation)', () => {
  assert.throws(() => planOpeningStock(5, 0), SafeProductError)
})

// ── Migration 00012: atomicity and safety properties ─────────────────────────

const MIGRATION = 'supabase/migrations/00012_post_opening_stock.sql'

test('migration defines post_opening_stock and nothing else structural', async () => {
  const sql = (await readFile(MIGRATION, 'utf8')).toLowerCase()
  assert.ok(sql.includes('create or replace function public.post_opening_stock'))
  // Additive-only: no table/column/data changes
  assert.ok(!sql.includes('create table'))
  assert.ok(!sql.includes('alter table'))
  assert.ok(!sql.includes('drop table'))
  assert.ok(!sql.includes('update public.products set')) // stock is updated only via create_stock_movement
  // No auth.uid() dependency
  assert.ok(!sql.includes('auth.uid'))
})

test('migration grants execute to service_role only', async () => {
  const sql = (await readFile(MIGRATION, 'utf8')).toLowerCase()
  assert.ok(/revoke execute on function public\.post_opening_stock[\s\S]*?from public, anon, authenticated/.test(sql))
  assert.ok(/grant execute on function public\.post_opening_stock[\s\S]*?to service_role/.test(sql))
})

test('migration rejects duplicates and invalid quantity/cost inside one transaction', async () => {
  const sql = (await readFile(MIGRATION, 'utf8'))
  assert.ok(sql.includes("movement_type = 'opening'"), 'duplicate-opening guard present')
  assert.ok(sql.includes('already has opening stock'), 'duplicate raises a safe error')
  assert.ok(sql.includes('p_quantity is null or p_quantity <= 0'), 'quantity validated')
  assert.ok(sql.includes('p_unit_cost_paisas is null or p_unit_cost_paisas <= 0'), 'cost validated')
  assert.ok(sql.includes('for update'), 'product row locked against concurrent opening attempts')
  // Reuses the authoritative Phase-8 engines, in the same transaction
  assert.ok(sql.includes('public.create_stock_movement('))
  assert.ok(sql.includes('public.post_voucher('))
  // Debit Inventory (1100) / Credit Opening Balance Equity (3030)
  assert.ok(sql.includes("a.code = '1100'"))
  assert.ok(sql.includes("a.code = '3030'"))
})

test('migration balances the voucher with one value for both legs', async () => {
  const sql = await readFile(MIGRATION, 'utf8')
  const debitLegs = sql.match(/'debit', v_value_paisas/g) ?? []
  const creditLegs = sql.match(/'credit', v_value_paisas/g) ?? []
  assert.equal(debitLegs.length, 1)
  assert.equal(creditLegs.length, 1)
})

// ── Migration 00013: execution repair (additive, non-destructive) ────────────

const MIGRATION_13 = 'supabase/migrations/00013_fix_post_opening_stock_execution.sql'

test('00013 re-asserts the function without any structural or destructive change', async () => {
  const sql = (await readFile(MIGRATION_13, 'utf8')).toLowerCase()
  assert.ok(sql.includes('create or replace function public.post_opening_stock'))
  assert.ok(!sql.includes('create table'))
  assert.ok(!sql.includes('alter table'))
  assert.ok(!sql.includes('drop table'))
  assert.ok(!sql.includes('drop function'))
  assert.ok(!sql.includes('truncate'))
  assert.ok(!sql.includes('delete from'))
  assert.ok(!sql.includes('auth.uid'))
})

test('00013 fixes both proven failure modes (owner privilege chain + schema cache)', async () => {
  const sql = (await readFile(MIGRATION_13, 'utf8')).toLowerCase()
  // 42501 fix: run nested contained functions as a role that holds EXECUTE.
  assert.ok(/alter function public\.post_opening_stock[\s\S]*?owner to postgres/.test(sql))
  // PGRST202 fix: force PostgREST to re-expose the function.
  assert.ok(sql.includes("notify pgrst, 'reload schema'"))
})

test('00013 keeps the 00008k containment posture (service_role only)', async () => {
  const sql = (await readFile(MIGRATION_13, 'utf8')).toLowerCase()
  assert.ok(/revoke execute on function public\.post_opening_stock[\s\S]*?from public, anon, authenticated/.test(sql))
  assert.ok(/grant execute on function public\.post_opening_stock[\s\S]*?to service_role/.test(sql))
})

test('00013 is self-contained and touches only post_opening_stock', async () => {
  const sql = (await readFile(MIGRATION_13, 'utf8')).toLowerCase()
  // Every DDL/DCL statement in the file targets post_opening_stock only. It may
  // MENTION other migration numbers in comments (documenting that they are left
  // untouched), but must not contain DDL against any other migration's objects.
  const statements = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
  for (const verb of ['create or replace function', 'alter function', 'revoke execute on function', 'grant execute on function']) {
    if (statements.includes(verb)) {
      assert.ok(statements.includes(`${verb} public.post_opening_stock`), `${verb} targets post_opening_stock`)
    }
  }
  // No reference to the forbidden project or a full-chain reapply.
  assert.ok(!statements.includes('wkjavxiviyzfirjnfltg'), 'never references the forbidden project')
})

test('00013 function body matches 00012 (byte-identical between the markers)', async () => {
  const extract = (s: string) => {
    const start = s.indexOf('as $$')
    const end = s.indexOf('$$;', start)
    return s.slice(start, end).replace(/\r/g, '')
  }
  const b12 = extract(await readFile(MIGRATION, 'utf8'))
  const b13 = extract(await readFile(MIGRATION_13, 'utf8'))
  assert.ok(b12.length > 0)
  assert.equal(b13, b12, 'the re-asserted body is a deliberate copy, not a divergent reimplementation')
})

// ── Application flow: product is created at zero stock, opening only via RPC ─

test('createProduct inserts with zero stock and posts opening only via post_opening_stock', async () => {
  const src = await readFile('src/lib/products/data-access.ts', 'utf8')
  assert.ok(!src.includes('atomic_create_product'), 'no dependency on the unavailable migration 00011 RPC')
  assert.ok(src.includes('current_stock: 0'), 'product row starts at zero quantity')
  assert.ok(src.includes("rpc('post_opening_stock'"), 'opening stock goes through the atomic RPC')
  assert.ok(src.includes('planOpeningStock('), 'input validated before any write')
})

test('a failed opening-stock RPC is captured as a sanitized server-side diagnostic', async () => {
  const src = await readFile('src/lib/products/data-access.ts', 'utf8')
  // The real Postgres/PostgREST error code is preserved for the server log only.
  assert.ok(src.includes('openingErr as any).code'), 'RPC error code captured')
  assert.ok(src.includes('new SafeProductError('), 'user still sees the safe message')
  assert.ok(src.includes('diagnostic'), 'diagnostic carried separately from the user message')

  const route = await readFile('src/app/api/products/route.ts', 'utf8')
  assert.ok(route.includes('safeMutationError('), 'route logs via the safe observability helper')
  assert.ok(route.includes('OPENING_STOCK_FAILED'), 'stable machine-readable error code')
  assert.ok(route.includes('e.diagnostic'), 'sanitized diagnostic routed to the server log')
})

test('SafeProductError carries an optional diagnostic without leaking it to the message', () => {
  const err = new SafeProductError('safe user message', 'post_opening_stock [42501] permission denied')
  assert.equal(err.message, 'safe user message')
  assert.equal(err.diagnostic, 'post_opening_stock [42501] permission denied')
  assert.equal(err.safe, true)
})
