import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  ApiRequestError,
  apiFetchJson,
  shouldRetryApiRequest,
} from '../src/lib/api-client.ts'
import {
  missingProductOptionalColumn,
  productColumnCandidates,
} from '../src/lib/products/schema-compatibility.ts'

const products = await readFile('src/lib/products/data-access.ts', 'utf8')
const providers = await readFile('src/components/providers.tsx', 'utf8')
const observability = await readFile('src/lib/observability.ts', 'utf8')
const phaseProbe = await readFile('src/lib/supabase/phase-probe.ts', 'utf8')
const accounting = await readFile('src/lib/accounting/availability.ts', 'utf8')
const accountingDataAccess = await readFile('src/lib/accounting/data-access.ts', 'utf8')
const ownerDashboard = await readFile('src/components/erp/views/owner-dashboard.tsx', 'utf8')
const ownerSummary = await readFile('src/lib/dashboard/owner-summary.ts', 'utf8')
const salesDataAccess = await readFile('src/lib/sales/data-access.ts', 'utf8')
const customersRoute = await readFile('src/app/api/customers/route.ts', 'utf8')
const riderRoute = await readFile('src/app/api/rider-dashboard/route.ts', 'utf8')
const riderDashboard = await readFile('src/components/erp/views/rider-dashboard.tsx', 'utf8')

test('missing relation, column, and RPC codes are permanent failures', () => {
  for (const code of ['42P01', '42703', 'PGRST204', '42883', 'PGRST202']) {
    assert.equal(
      shouldRetryApiRequest(0, new ApiRequestError(500, { code })),
      false,
      code,
    )
  }
})

test('the production products query negotiates both optional columns', () => {
  assert.equal(missingProductOptionalColumn({
    code: '42703',
    message: 'column products.commission_rate does not exist',
  }), 'commissionRate')
  assert.equal(missingProductOptionalColumn({
    code: 'PGRST204',
    message: "Could not find the 'low_stock_threshold' column of 'products' in the schema cache",
  }), 'lowStockThreshold')
  assert.deepEqual(productColumnCandidates(null).at(-1), {
    lowStockThreshold: false,
    commissionRate: false,
  })
  assert.match(products, /commissionRatePaisas: selected\.commissionRate/)
})

test('authenticated client requests preserve cookies and cancellation signals', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  let observed: RequestInit | undefined
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    observed = init
    return new Response(JSON.stringify({ rows: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  try {
    assert.deepEqual(await apiFetchJson('/api/products', { signal: controller.signal }), { rows: [] })
    assert.equal(observed?.credentials, 'same-origin')
    assert.equal(observed?.signal, controller.signal)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('401, 403, and typed accounting unavailability never retry', () => {
  for (const status of [400, 401, 403]) {
    assert.equal(shouldRetryApiRequest(0, new ApiRequestError(status, { error: 'FAIL' })), false)
  }
  assert.equal(
    shouldRetryApiRequest(0, new ApiRequestError(500, { reason: 'ACCOUNTING_MIGRATION_REQUIRED' })),
    false,
  )
})

test('transient network and 5xx failures retry at most once', () => {
  assert.equal(shouldRetryApiRequest(0, new TypeError('network')), true)
  assert.equal(shouldRetryApiRequest(1, new TypeError('network')), false)
  const serverError = new ApiRequestError(503, { error: 'REQUEST_FAILED' })
  assert.equal(shouldRetryApiRequest(0, serverError), true)
  assert.equal(shouldRetryApiRequest(1, serverError), false)
})

test('aborted stale requests never retry', () => {
  assert.equal(shouldRetryApiRequest(0, new DOMException('stale', 'AbortError')), false)
})

test('shared query policy delegates to the typed retry classifier', () => {
  assert.match(providers, /retry: shouldRetryApiRequest/)
  assert.match(providers, /retryDelay: 500/)
})

test('serverless runtime cannot enter the Prisma SQLite fallback', () => {
  assert.match(phaseProbe, /process\.env\.VERCEL/)
  assert.match(phaseProbe, /ServerlessDatabaseProhibitedError/)
})

test('legacy reads select only existing operational columns', () => {
  assert.match(products, /product: \{ select: \{ name: true \} \}/)
  assert.match(products, /commissionRatePaisas: null/)
  assert.doesNotMatch(products, /include: \{ product: true \}/)
  assert.match(salesDataAccess, /salesman: \{ select: \{ name: true \} \}/)
  assert.match(accountingDataAccess, /balanceCache: true/)
  assert.doesNotMatch(accountingDataAccess, /include: \{ accounts:/)
})

test('accounting-unavailable response and UI never fabricate financial values', () => {
  assert.match(accounting, /available: false/)
  assert.match(accounting, /reason: 'ACCOUNTING_MIGRATION_REQUIRED'/)
  assert.match(accounting, /Not available until accounting migration/)
  assert.match(accounting, /process\.env\.NODE_ENV === 'production'/)
  assert.doesNotMatch(ownerDashboard, /approxProfit \?\? \(todaySales - todayExpenses\)/)
  assert.match(ownerSummary, /dataSource: 'operational-fallback'/)
  assert.match(ownerSummary, /todayExpenses: null/)
  assert.match(ownerSummary, /approxProfit: null/)
})

test('secondary customers panel has an authenticated, scoped route', () => {
  assert.match(customersRoute, /withObservability\('\/api\/customers'/)
  assert.match(customersRoute, /UNAUTHORIZED/)
  assert.match(customersRoute, /FORBIDDEN/)
})

test('rider dashboard reports unavailable delivery capability without fabricated metrics', () => {
  assert.match(riderRoute, /DELIVERY_MIGRATION_REQUIRED/)
  assert.match(riderRoute, /summary: null/)
  assert.match(riderRoute, /recentOrders: \[\]/)
  assert.match(riderDashboard, /data\?\.available === false/)
  assert.match(riderDashboard, /\{data\.message\}/)
})

test('safe unknown 500 logs include request correlation and technical location only', () => {
  assert.match(observability, /requestId/)
  assert.match(observability, /sourceFile/)
  assert.match(observability, /stackLocation/)
  assert.match(observability, /dbCode: diag\.code/)
  assert.doesNotMatch(observability, /errorMessage:/)
  assert.doesNotMatch(observability, /cookies?: diag\./i)
  assert.doesNotMatch(observability, /password: diag\./i)
  assert.doesNotMatch(observability, /payload: diag\./i)
})
