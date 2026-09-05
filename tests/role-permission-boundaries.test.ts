import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'

const read = async (path: string) => (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')

async function routeFiles(): Promise<string[]> {
  const entries = await readdir('src/app/api', { recursive: true })
  return entries
    .map((e) => String(e).replace(/\\/g, '/'))
    .filter((e) => e.endsWith('route.ts'))
    .sort()
}

// ---------------------------------------------------------------------------
// The four roles are separated on the server, not in the navigation. A deep
// link, a bookmark or a hand-typed fetch reaches the API directly, so every
// route that returns business data has to decide for itself. These tests pin
// that surface: nothing joins it unauthenticated by accident, and the roles
// that must not see business-wide money keep not seeing it.
// ---------------------------------------------------------------------------

/**
 * Deliberately public. Each entry is safe on its own terms: NextAuth owns its
 * own handler, registration closes itself once an Owner exists, bootstrap
 * status answers one boolean, supabase-status returns booleans and never keys,
 * test-biz-day is pure timezone arithmetic, and api/route.ts is a static string.
 */
const PUBLIC_ROUTES = new Set([
  'auth/[...nextauth]/route.ts',
  'auth/register/route.ts',
  'bootstrap-status/route.ts',
  'route.ts',
  'supabase-status/route.ts',
  'test-biz-day/route.ts',
])

test('every API route either is a declared public route or loads the session', async () => {
  for (const file of await routeFiles()) {
    if (PUBLIC_ROUTES.has(file)) continue
    const source = await read(`src/app/api/${file}`)
    assert.match(
      source,
      /loadSessionUser|requireAiSettingsOwner/,
      `${file} must resolve the caller before answering`,
    )
  }
})

test('registration closes itself once an Owner exists', async () => {
  const source = await read('src/app/api/auth/register/route.ts')
  assert.match(source, /const bootstrap = await noOwnerExists\(\)/)
  assert.match(source, /'REGISTRATION_CLOSED'/)
  assert.match(source, /status: 403/)
})

test('the public status routes never return a key', async () => {
  const status = await read('src/app/api/supabase-status/route.ts')
  assert.doesNotMatch(status, /SERVICE_ROLE_KEY!?\s*[,}]|json\([^)]*apiKey/)
  assert.match(status, /NEVER (returns|print)/i)
})

// Administration is Owner-only, and an Accountant is the role most likely to
// reach for it: they already live in Setup all day.
test('user, role and permission administration is Owner-only', async () => {
  for (const file of [
    'setup/users/route.ts',
    'setup/users/reset-password/route.ts',
    'setup/roles/route.ts',
    'setup/permissions/route.ts',
  ]) {
    const source = await read(`src/app/api/${file}`)
    assert.match(source, /requireOwner\(loaded\)/, `${file} must require an Owner`)
  }
})

// The chart of accounts is the account picker for every operational screen, so
// it stays readable business-wide; the balances in it are the whole ledger in
// one response and travel only to the roles whose screens already show money.
test('the chart of accounts hands out balances only to balance-permitted roles', async () => {
  const source = await read('src/app/api/setup/coa/route.ts')
  assert.match(source, /const canSeeBalances = hasPermission\(su, 'can_view_account_balances'\)/)
  assert.match(source, /\|\| hasPermission\(su, 'can_view_setup'\)/)
  assert.match(source, /\|\| hasPermission\(su, 'can_view_trial_balance'\)/)
  assert.match(source, /\.\.\.\(canSeeBalances \? \{ balancePaisas: a\.balanceCache\.toString\(\) \} : \{\}\)/)
  // The gate is worthless if some other field carries the same number out.
  const unguarded = source
    .split('\n')
    .filter((line) => /balanceCache|balancePaisas/.test(line) && !/canSeeBalances/.test(line))
  assert.deepEqual(unguarded, [], 'every balance field on this route must sit behind canSeeBalances')
})

// A Salesman's own sales are theirs; the business's sales are not.
test('own-sales roles are scoped to their own salesman record', async () => {
  for (const file of ['sales/[id]/route.ts', 'sales/[id]/commission/route.ts']) {
    const source = await read(`src/app/api/${file}`)
    assert.match(source, /const canViewOwn = hasPermission\(su, 'can_view_own_sales'\)/, file)
  }
  const report = await read('src/app/api/reports/salesman/route.ts')
  assert.match(report, /if \(!hasPermission\(loaded, 'can_view_own_sales'\)\) \{/)
})

// The salesman picker is needed by every sale form, so the list stays open; a
// colleague's commission rate is not part of picking who made the sale.
test('the salesman picker hands out commission rates only to sales-wide roles', async () => {
  const route = await read('src/app/api/salesmen/route.ts')
  assert.match(route, /const canSeeRates = hasPermission\(su, 'can_view_sales'\)/)
  assert.match(route, /\|\| hasPermission\(su, 'can_manage_setup'\)/)
  assert.match(route, /\.\.\.\(canSeeRates \? \{ commissionPct: r\.commissionPct \} : \{\}\)/)

  // A screen that read the rate from this route would break for a Salesman
  // instead of being refused, so no screen may depend on it.
  const views = (await readdir('src/components/erp/views')).filter((f) => f.endsWith('.tsx'))
  for (const file of views) {
    const source = await read(`src/components/erp/views/${file}`)
    assert.doesNotMatch(source, /commissionPct/, `${file} must not read commissionPct`)
  }
})

// A Rider carries a phone through a market. Their deep links must resolve to
// their own orders and their own cash, and to nothing else in the business.
test('riders read only their own delivery orders', async () => {
  // The list narrows the query to the caller's own rider row, and refuses
  // rather than falling back to the whole business when no row is linked.
  const list = await read('src/app/api/delivery-orders/route.ts')
  assert.match(list, /if \(loaded\.roleName === 'Rider'\) \{/)
  assert.match(list, /const rider = await getRiderForSession\(loaded\)/)
  assert.match(list, /if \(!rider\) return NextResponse\.json\(\{ error: 'RIDER_LINK_REQUIRED' \}/)
  assert.match(list, /riderId = rider\.id/)

  // A hand-typed order id is the deep link that matters here: ownership is
  // re-checked against the loaded order, not just against the role.
  const detail = await read('src/app/api/delivery-orders/[id]/route.ts')
  assert.match(detail, /if \(loaded\.roleName === 'Rider'\) \{/)
  assert.match(detail, /const rider = await getRiderForSession\(loaded\)/)
  assert.match(detail, /if \(!rider \|\| order\.riderId !== rider\.id\) \{/)
  assert.match(detail, /'FORBIDDEN' \}, \{ status: 403 \}/)
})

test('riders cannot confirm their own cash settlement', async () => {
  const settle = await read('src/app/api/rider-cod/settle/route.ts')
  assert.match(
    settle,
    /loaded\.roleName === 'Rider' \|\| !hasPermission\(loaded, 'can_confirm_cod_submission'\)/,
  )
  assert.match(settle, /'FORBIDDEN' \}, \{ status: 403 \}/)
  const balances = await read('src/app/api/rider-cod/balances/route.ts')
  assert.match(balances, /if \(loaded\.roleName === 'Rider'\) \{/)
})

// The gates above read permissions the seed hands out. If a later seed edit
// gave a Salesman or a Rider one of the money permissions, every check above
// would still pass while the boundary quietly moved.
test('the seeded roles keep Salesman and Rider away from business-wide money', async () => {
  const seed = await read('supabase/migrations/00003_seed.sql')
  const sensitive = ['can_view_account_balances', 'can_view_trial_balance', 'can_view_setup', 'can_manage_setup']
  for (const role of ['Salesman', 'Rider']) {
    const start = seed.indexOf(`and r.name = '${role}'`)
    assert.ok(start > 0, `${role} grants are declared in the seed`)
    const grants = seed.slice(start, seed.indexOf('on conflict', start))
    for (const code of sensitive) {
      assert.doesNotMatch(grants, new RegExp(code), `${role} must not hold ${code}`)
    }
  }
})
