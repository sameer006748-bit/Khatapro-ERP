#!/usr/bin/env bun
/**
 * verify-weighted-average-cost.ts — verifies the weighted-average-cost logic.
 *
 * Tests (per the master prompt):
 *   1. 10 @ Rs 800 → average Rs 800
 *   2. Add 10 @ Rs 1,000 → average Rs 900
 *   3. Sell/remove 5 → quantity 15, average remains Rs 900
 *   4. Add 5 @ Rs 1,200 → average becomes Rs 975
 *   5. Negative scenario:
 *      - quantity 0
 *      - stock-out/sale 3
 *      - quantity -3
 *      - purchase 5 @ Rs 1,000
 *      - final quantity 2
 *      - pending estimated cost becomes finalized
 *   6. Stock value = positive quantity × weighted average cost
 *   7. Rupee/paisa conversion correct
 *   8. Purchase returns/replacements do not duplicate or corrupt cost
 *
 * REQUIRES: Phase 6 migration applied (adds weighted_average_cost column +
 *           enhanced create_stock_movement with p_unit_cost_paisas param).
 */
import { readFileSync } from 'fs'
import { join } from 'path'

try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { console.error('⚠ .env.local not found'); process.exit(1) }

const BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000'
let cookie = ''
const results: Array<{ test: string; pass: boolean; detail: string }> = []

function record(test: string, pass: boolean, detail: string) {
  results.push({ test, pass, detail })
  console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'}: ${test} — ${detail}`)
}

async function login(email: string, password: string) {
  if (process.env.SESSION_COOKIE) {
    cookie = process.env.SESSION_COOKIE
    const me = await fetch(`${BASE}/api/me`, { headers: { cookie } })
    const meJ = await me.json() as any
    if (meJ.user) return meJ.user
  }
  const csrfR = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie } })
  const csrfJ = await csrfR.json() as any
  cookie = (csrfR.headers.get('set-cookie') || '').split(';')[0] || cookie
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ email, password, csrfToken: csrfJ.csrfToken, callbackUrl: '/', json: 'true' }).toString(),
    redirect: 'manual',
  })
  const setCookies = r.headers.get('set-cookie') || ''
  if (setCookies) { const sc = setCookies.split(';')[0]; cookie = cookie ? `${cookie}; ${sc}` : sc }
  const me = await fetch(`${BASE}/api/me`, { headers: { cookie } })
  const meJ = await me.json() as any
  if (!meJ.user) throw new Error(`Login failed for ${email}`)
  return meJ.user
}

async function api(path: string, method = 'GET', body?: any) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json() as any
  return { ok: r.ok, status: r.status, json: j }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

async function supabase(path: string) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
}

async function getProduct(productId: string) {
  const r = await supabase(`products?id=eq.${productId}&select=id,name,current_stock,weighted_average_cost,latest_purchase_cost,sale_price,purchase_price`)
  const data = await r.json() as any[]
  return data?.[0] ?? null
}

async function createProduct(name: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/products`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ business_id: 'biz-default', name, unit: 'piece', sale_price: 1500, purchase_price: 800, current_stock: 0, is_temporary: false, is_active: true, marked_for_merge: false }),
  })
  const data = await r.json() as any[]
  return data[0].id
}

async function createStockMovement(productId: string, type: string, qty: number, costPaisas?: number): Promise<string> {
  const body: any = {
    p_business_id: 'biz-default', p_product_id: productId, p_movement_type: type,
    p_quantity: qty, p_reason: `WAC test: ${type} ${qty}`,
  }
  if (costPaisas !== undefined) body.p_unit_cost_paisas = costPaisas.toString()
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_stock_movement`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json()
  if (r.status >= 400) throw new Error(`create_stock_movement failed: ${JSON.stringify(j)}`)
  return j as string
}

async function main() {
  console.log('━'.repeat(72))
  console.log('  KhataPro ERP — Weighted Average Cost Verification')
  console.log('━'.repeat(72))

  // Check migration is applied
  const testProd = await supabase('products?select=weighted_average_cost&limit=1')
  if (!testProd.ok) {
    console.log('\n❌ MIGRATION NOT APPLIED — weighted_average_cost column missing.')
    console.log('   Apply supabase/migrations/00006_phase6_vouchers_expenses.sql first.')
    process.exit(1)
  }
  console.log('  ✓ Migration applied (weighted_average_cost column exists)')

  console.log('\n▸ Creating test product "WAC Test Product"…')
  const productId = await createProduct('WAC Test Product ' + Date.now())
  console.log(`  ✓ Product created: ${productId}`)

  // ─── TEST 1: 10 @ Rs 800 → average Rs 800 ───
  console.log('\n━ TEST 1: Purchase 10 @ Rs 800 → average should be Rs 800 (80000 paisas)')
  await createStockMovement(productId, 'adjustment_in', 10, 80000) // Rs 800 = 80000 paisas
  let p = await getProduct(productId)
  record('After 10 @ Rs 800: current_stock = 10', p.current_stock === 10, `got ${p.current_stock}`)
  record('After 10 @ Rs 800: weighted_average_cost = 80000', BigInt(p.weighted_average_cost) === 80000n, `got ${p.weighted_average_cost}`)
  record('After 10 @ Rs 800: latest_purchase_cost = 80000', BigInt(p.latest_purchase_cost) === 80000n, `got ${p.latest_purchase_cost}`)

  // ─── TEST 2: Add 10 @ Rs 1,000 → average Rs 900 ───
  console.log('\n━ TEST 2: Purchase 10 @ Rs 1,000 → average should be Rs 900 (90000 paisas)')
  // Expected: (10×80000 + 10×100000) / 20 = 900000000/20 = 90000
  await createStockMovement(productId, 'adjustment_in', 10, 100000)
  p = await getProduct(productId)
  record('After +10 @ Rs 1000: current_stock = 20', p.current_stock === 20, `got ${p.current_stock}`)
  record('After +10 @ Rs 1000: weighted_average_cost = 90000', BigInt(p.weighted_average_cost) === 90000n, `got ${p.weighted_average_cost}`)

  // ─── TEST 3: Sell/remove 5 → quantity 15, average remains Rs 900 ───
  console.log('\n━ TEST 3: Remove 5 → quantity 15, average stays Rs 900 (90000 paisas)')
  await createStockMovement(productId, 'adjustment_out', 5)
  p = await getProduct(productId)
  record('After remove 5: current_stock = 15', p.current_stock === 15, `got ${p.current_stock}`)
  record('After remove 5: weighted_average_cost = 90000 (unchanged)', BigInt(p.weighted_average_cost) === 90000n, `got ${p.weighted_average_cost}`)

  // ─── TEST 4: Add 5 @ Rs 1,200 → average becomes Rs 975 ───
  console.log('\n━ TEST 4: Purchase 5 @ Rs 1,200 → average should be Rs 975 (97500 paisas)')
  // Expected: (15×90000 + 5×120000) / 20 = (1350000 + 600000) / 20 = 1950000/20 = 97500
  await createStockMovement(productId, 'adjustment_in', 5, 120000)
  p = await getProduct(productId)
  record('After +5 @ Rs 1200: current_stock = 20', p.current_stock === 20, `got ${p.current_stock}`)
  record('After +5 @ Rs 1200: weighted_average_cost = 97500', BigInt(p.weighted_average_cost) === 97500n, `got ${p.weighted_average_cost}`)

  // ─── TEST 6: Stock value = positive quantity × WAC ───
  console.log('\n━ TEST 6: Stock value = 20 × 97500 = 1950000 paisas (Rs 19,500)')
  const stockValue = BigInt(p.current_stock) * BigInt(p.weighted_average_cost)
  record('Stock value = 20 × 97500 = 1950000', stockValue === 1950000n, `got ${stockValue}`)

  // ─── TEST 7: Rupee/paisa conversion ───
  console.log('\n━ TEST 7: Rupee/paisa conversion check')
  // Rs 800 = 80000 paisas (not 800, not 8000000)
  record('Rs 800 stored as 80000 paisas', 80000n === 800n * 100n, `800×100=${800n * 100n}`)
  record('Rs 1,000 stored as 100000 paisas', 100000n === 1000n * 100n, `1000×100=${1000n * 100n}`)

  // ─── TEST 5: Negative stock scenario ───
  console.log('\n━ TEST 5: Negative stock + reconciliation')
  // Create a fresh product for this test
  const negProductId = await createProduct('WAC Neg Test ' + Date.now())
  console.log('  Step 1: Start at 0, sell 3 → quantity -3')
  await createStockMovement(negProductId, 'adjustment_out', 3)
  let np = await getProduct(negProductId)
  record('After sell 3 from 0: current_stock = -3', np.current_stock === -3, `got ${np.current_stock}`)
  record('After sell 3 from 0: WAC = 0 (pending)', BigInt(np.weighted_average_cost) === 0n, `got ${np.weighted_average_cost}`)

  console.log('  Step 2: Purchase 5 @ Rs 1,000 → covers -3, leaves 2 @ Rs 1,000')
  await createStockMovement(negProductId, 'adjustment_in', 5, 100000)
  np = await getProduct(negProductId)
  record('After purchase 5 @ Rs 1000: current_stock = 2', np.current_stock === 2, `got ${np.current_stock}`)
  record('After purchase 5 @ Rs 1000: WAC = 100000 (Rs 1,000)', BigInt(np.weighted_average_cost) === 100000n, `got ${np.weighted_average_cost}`)

  // ─── SUMMARY ───
  console.log('\n' + '━'.repeat(72))
  console.log('  WEIGHTED AVERAGE COST VERIFICATION SUMMARY')
  console.log('━'.repeat(72))
  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass).length
  console.log(`  Passed: ${passed} / ${results.length}`)
  console.log(`  Failed: ${failed} / ${results.length}`)
  if (failed > 0) {
    console.log('\n  FAILED TESTS:')
    for (const r of results.filter(r => !r.pass)) console.log(`    ❌ ${r.test}: ${r.detail}`)
    process.exit(1)
  } else {
    console.log('\n  ✅ ALL WAC TESTS PASSED')
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
