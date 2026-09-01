import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  classifyPostgrestCompatibilityError,
  detectLedgerCapability,
  isolateDashboardMetric,
  resetDashboardCapabilityCacheForTests,
  shouldRetryDashboardRequest,
} from '../src/lib/dashboard/compatibility.ts'

const summary = await readFile('src/lib/dashboard/owner-summary.ts', 'utf8')
const compatibility = await readFile('src/lib/dashboard/compatibility.ts', 'utf8')
const route = await readFile('src/app/api/dashboard/owner/route.ts', 'utf8')
const hook = await readFile('src/hooks/use-owner-dashboard.ts', 'utf8')
const page = await readFile('src/components/erp/views/owner-dashboard.tsx', 'utf8')

function client(tableError: any = null, rpcError: any = null) {
  return {
    from: () => ({ select: () => ({ limit: async () => ({ error: tableError }) }) }),
    rpc: async () => ({ error: rpcError }),
  }
}

test('ledger available selects the UUID ledger path', async () => {
  resetDashboardCapabilityCacheForTests()
  assert.deepEqual(await detectLedgerCapability(client() as any, 'business', '2026-07-27'), {
    path: 'uuid-ledger',
    reason: 'available',
  })
})

test('missing ledger table selects operational fallback and does not probe the RPC', async () => {
  resetDashboardCapabilityCacheForTests()
  let rpcCalls = 0
  const fake = client({ code: 'PGRST205', message: "Could not find the table 'ledger_accounts' in the schema cache" })
  fake.rpc = async () => { rpcCalls += 1; return { error: null } }
  assert.equal((await detectLedgerCapability(fake as any, 'business', '2026-07-27')).path, 'operational-fallback')
  assert.equal(rpcCalls, 0)
})

test('missing ledger RPC selects operational fallback', async () => {
  resetDashboardCapabilityCacheForTests()
  const result = await detectLedgerCapability(client(null, {
    code: 'PGRST202',
    message: "Could not find the function public.ledger_profit_loss in the schema cache",
  }) as any, 'business', '2026-07-27')
  assert.deepEqual(result, { path: 'operational-fallback', reason: 'missing-rpc' })
})

test('real authentication and business-scope errors are never compatibility fallback', async () => {
  for (const error of [
    { code: 'PGRST301', message: 'JWT expired' },
    { code: '42501', message: 'business scope denied' },
  ]) {
    resetDashboardCapabilityCacheForTests()
    await assert.rejects(() => detectLedgerCapability(client(error) as any, 'business', '2026-07-27'))
    assert.equal(classifyPostgrestCompatibilityError(error), 'auth-scope')
  }
})

test('capability result is runtime cached and concurrent probes are bounded', async () => {
  resetDashboardCapabilityCacheForTests()
  let tableCalls = 0
  let rpcCalls = 0
  const fake = {
    from: () => ({ select: () => ({ limit: async () => {
      tableCalls += 1
      return { error: null }
    } }) }),
    rpc: async () => {
      rpcCalls += 1
      return { error: null }
    },
  }
  await Promise.all([
    detectLedgerCapability(fake as any, 'a', '2026-07-27'),
    detectLedgerCapability(fake as any, 'b', '2026-07-27'),
  ])
  assert.equal(tableCalls, 1)
  assert.equal(rpcCalls, 1)
})

test('dashboard route uses the compatibility summary and isolates metric failures', () => {
  assert.match(route, /buildOwnerDashboardPayload/)
  assert.match(summary, /capability\.path === 'uuid-ledger'/)
  assert.match(summary, /capability\.path === 'uuid-ledger'[\s\S]*else/)
  assert.match(summary, /async function isolated/)
  assert.match(compatibility, /if \(isAuthOrScopeError\(shaped\)\) throw error/)
  assert.match(summary, /Promise\.all/)
})

test('one metric failure does not break an independent successful card', async () => {
  const [failed, successful] = await Promise.all([
    isolateDashboardMetric(async () => { throw { code: 'PGRST204', message: 'optional column unavailable' } }),
    isolateDashboardMetric(async () => 12500),
  ])
  assert.deepEqual({ value: failed.value, available: failed.available }, { value: null, available: false })
  assert.deepEqual({ value: successful.value, available: successful.available }, { value: 12500, available: true })
})

test('operational Received uses actual payments and excludes rider delivery events', () => {
  assert.match(summary, /\.from\('payments'\)/)
  assert.match(summary, /String\(row\.direction\)\.toLowerCase\(\) === 'received'/)
  assert.doesNotMatch(summary, /\.from\('delivery_orders'\)/)
  assert.match(summary, /Rider delivery tables are intentionally absent/)
})

test('Counter, Online, OFC, and every other sale type are represented in the visible breakdown', () => {
  assert.match(summary, /invoiceType === 'COUNTER'/)
  assert.match(summary, /invoiceType === 'ONLINE'/)
  assert.match(summary, /invoiceType === 'OFC'/)
  assert.match(summary, /: saleTypes\.other/)
  assert.match(page, /data\.salesByType\.other/)
})

test('unsupported metrics remain null and are represented as not tracked rather than fabricated as zero', () => {
  assert.match(summary, /let cashBalance: number \| null = null/)
  assert.match(summary, /let cogs: number \| null = null/)
  assert.match(summary, /approxProfit[\s\S]*: null/)
  assert.match(summary, /metricStates: metricStates\(availability, unavailable\)/)
  assert.match(page, /Not tracked/)
  assert.match(page, /Unable to load/)
})

test('retry is bounded and stale date-range requests are aborted', () => {
  assert.equal(shouldRetryDashboardRequest(0, 500), true)
  assert.equal(shouldRetryDashboardRequest(1, 500), false)
  assert.equal(shouldRetryDashboardRequest(0, 401), false)
  assert.equal(shouldRetryDashboardRequest(0, 403), false)
  assert.match(hook, /queryFn: \(\{ signal \}\) => fetchOwnerDashboard\(range, signal\)/)
  assert.match(hook, /\{ cache: 'no-store', signal \}/)
})

test('Today, a custom single date, and a custom range share the selected Karachi range', () => {
  assert.match(summary, /boundary\(range\.from\)/)
  assert.match(summary, /boundary\(range\.to, true\)/)
  assert.match(hook, /dashboardDateRangeQuery\(range\)/)
  assert.match(hook, /queryKey: \['owner-dashboard', range\.from, range\.to\]/)
})

test('legacy dashboard metrics use verified report and payment-account contracts', () => {
  for (const source of [
    'reportSalesSummary', 'reportCashFlow', 'reportCustomerOutstanding',
    'reportVendorOutstanding', 'reportSalesDetail', 'listLegacyBusinessAccounts',
  ]) assert.ok(summary.includes(source), source)
  assert.match(summary, /const legacyReports = capability\.path === 'operational-fallback'/)
  assert.match(summary, /reportSalesSummary\(bid, range\.from, range\.to\)/)
  assert.match(summary, /reportCashFlow\(bid, range\.from, range\.to\)/)
  assert.match(summary, /reportCustomerOutstanding\(bid\)/)
  assert.match(summary, /reportVendorOutstanding\(bid\)/)
  assert.match(summary, /total_debit \?\? 0\) - BigInt\(row\.total_credit \?\? 0\)/)
  assert.match(summary, /listLegacyBusinessAccounts\(bid, input\.profileId\)/)
  assert.match(summary, /account\.isActive/)
  assert.match(route, /profileId: loaded\.profileId/)
})
