import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const dates = await readFile('src/lib/dates.ts', 'utf8')
const hook = await readFile('src/hooks/use-owner-dashboard.ts', 'utf8')
const page = await readFile('src/components/erp/views/owner-dashboard.tsx', 'utf8')
const route = await readFile('src/app/api/dashboard/owner/route.ts', 'utf8')
const summary = await readFile('src/lib/dashboard/owner-summary.ts', 'utf8')

test('Today, Last 3 Days, Last 7 Days, and This Month use Karachi business dates', () => {
  assert.match(page, /bizPresetDateRange\('today'\)/)
  assert.match(dates, /BUSINESS_TZ = 'Asia\/Karachi'/)
  for (const preset of ['last3', 'last7', 'month']) assert.ok(dates.includes(`preset === '${preset}'`))
})

test('Last 3 Days and Last 7 Days count calendar days including weekends', async () => {
  const { bizPresetDateRange } = await import('../src/lib/dates.ts')
  const monday = new Date(Date.UTC(2026, 6, 27))
  assert.deepEqual(bizPresetDateRange('last3', monday), { from: '2026-07-25', to: '2026-07-27' })
  assert.deepEqual(bizPresetDateRange('last7', monday), { from: '2026-07-21', to: '2026-07-27' })
})

test('custom range validates start/end before applying', () => {
  assert.match(page, /isBusinessDateRange\(nextRange\)/)
  assert.match(page, /End date must be on or after start date/)
  for (const label of ['Start date', 'End date', 'Apply', 'Reset']) assert.ok(page.includes(label))
})

test('one range reaches one owner API query key and is cancelled when stale', () => {
  assert.match(hook, /dashboardDateRangeQuery\(range\)/)
  assert.match(hook, /queryKey: \['owner-dashboard', range\.from, range\.to\]/)
  assert.match(hook, /queryFn: \(\{ signal \}\) => fetchOwnerDashboard\(range, signal\)/)
  assert.match(route, /resolveDashboardDateRange\(url\.searchParams, now\)/)
  assert.match(page, /data\.range\.from !== range\.from \|\| data\.range\.to !== range\.to/)
})

test('valid Karachi date labels are not shifted to the previous UTC date', async () => {
  const { isBusinessDateRange } = await import('../src/lib/dates.ts')
  assert.equal(
    new Date('2026-07-27T00:00:00+05:00').toISOString().slice(0, 10),
    '2026-07-26',
    'reproduces the old production validator mismatch',
  )
  assert.equal(isBusinessDateRange({ from: '2026-07-27', to: '2026-07-27' }), true)
})

test('dashboard emits exact YYYY-MM-DD queries for every preset and custom shape', async () => {
  const { bizPresetDateRange, dashboardDateRangeQuery } = await import('../src/lib/dates.ts')
  const now = new Date('2026-07-27T07:00:00.000Z')
  const cases = [
    ['Today', bizPresetDateRange('today', now), 'from=2026-07-27&to=2026-07-27'],
    ['Last 3 Days', bizPresetDateRange('last3', now), 'from=2026-07-25&to=2026-07-27'],
    ['Last 7 Days', bizPresetDateRange('last7', now), 'from=2026-07-21&to=2026-07-27'],
    ['This Month', bizPresetDateRange('month', now), 'from=2026-07-01&to=2026-07-27'],
    ['Custom single date', { from: '2026-07-12', to: '2026-07-12' }, 'from=2026-07-12&to=2026-07-12'],
    ['Custom range', { from: '2026-06-29', to: '2026-07-03' }, 'from=2026-06-29&to=2026-07-03'],
  ] as const
  for (const [label, range, expected] of cases) {
    assert.equal(dashboardDateRangeQuery(range), expected, label)
    assert.doesNotMatch(expected, /undefined|Invalid|%2F|%2C/)
  }
})

test('API defaults missing dates and expands either single date to one inclusive day', async () => {
  const { resolveDashboardDateRange } = await import('../src/lib/dates.ts')
  const now = new Date('2026-07-27T07:00:00.000Z')
  assert.deepEqual(resolveDashboardDateRange(new URLSearchParams(), now), {
    from: '2026-07-27', to: '2026-07-27',
  })
  assert.deepEqual(resolveDashboardDateRange(new URLSearchParams('from=2026-07-12'), now), {
    from: '2026-07-12', to: '2026-07-12',
  })
  assert.deepEqual(resolveDashboardDateRange(new URLSearchParams('to=2026-07-13'), now), {
    from: '2026-07-13', to: '2026-07-13',
  })
  assert.deepEqual(resolveDashboardDateRange(new URLSearchParams('from=&to='), now), {
    from: '2026-07-27', to: '2026-07-27',
  })
})

test('only malformed, impossible, or reversed date ranges are rejected', async () => {
  const { dashboardDateRangeQuery, resolveDashboardDateRange } = await import('../src/lib/dates.ts')
  for (const query of [
    'from=07%2F27%2F2026&to=07%2F27%2F2026',
    'from=Invalid+Date&to=2026-07-27',
    'from=2026-02-30&to=2026-03-01',
    'from=2026-07-28&to=2026-07-27',
  ]) assert.equal(resolveDashboardDateRange(new URLSearchParams(query)), null, query)
  assert.throws(() => dashboardDateRangeQuery({ from: '', to: '2026-07-27' }))
})

test('all operational period metrics use the same validated range', () => {
  for (const expression of [
    "gte('invoice_date', range.from).lte('invoice_date', range.to)",
    "gte('expense_date', range.from).lte('expense_date', range.to)",
    "gte('purchase_date', range.from).lte('purchase_date', range.to)",
    "gte('created_at', boundary(range.from))",
  ]) assert.ok(summary.includes(expression), expression)
})

test('current balances are separate from period movements', () => {
  for (const label of ['Current Cash', 'Current Bank', 'Current Receivables', 'Current Payables']) {
    assert.ok(page.includes(label), label)
  }
  assert.match(summary, /receivablesMovement/)
  assert.match(summary, /payablesMovement/)
  assert.match(summary, /let cashBalance: number \| null = null/)
})

test('all sale types include Other Sale', () => {
  for (const type of ['COUNTER', 'ONLINE', 'OFC']) assert.ok(summary.includes(`invoiceType === '${type}'`))
  assert.match(summary, /: saleTypes\.other/)
  assert.match(page, /salesByType\.other\.count/)
})

test('collections use actual payments and never delivery state', () => {
  assert.match(summary, /\.from\('payments'\)/)
  assert.match(summary, /direction\)\.toLowerCase\(\) === 'received'/)
  assert.doesNotMatch(summary, /\.from\('delivery_orders'\)/)
})

test('returns are period scoped and optional', () => {
  assert.match(summary, /\.from\('sale_return_documents'\)/)
  assert.match(summary, /\.from\('purchase_returns'\)/)
  assert.match(summary, /salesReturns = salesReturnQ\.available/)
  assert.match(summary, /purchaseReturns = purchaseReturnQ\.available/)
})

test('cash/bank movement and current balances remain structurally distinct', () => {
  for (const label of ['Cash Inflow', 'Cash Outflow', 'Current Cash', 'Bank Inflow', 'Bank Outflow', 'Current Bank']) {
    assert.ok(page.includes(label), label)
  }
  assert.match(summary, /cashMovement/)
  assert.match(summary, /cashBalance/)
})

test('Approximate Profit requires Sales, Returns, COGS, and Expenses', () => {
  assert.match(summary, /sales - salesReturns - cogs - expenses/)
  assert.match(summary, /: null/)
  assert.match(page, /Not available without reliable COGS/)
})

test('authorization and empty-state presentation remain intact', () => {
  assert.match(route, /loaded\.roleName !== 'Owner\/Admin'/)
  assert.match(route, /requirePermission\(loaded, 'can_view_trial_balance'\)/)
  assert.match(page, /No sales, purchases, expenses or collections were recorded for/)
})

test('active range is visible and mobile presets remain scrollable', () => {
  assert.match(page, /overflow-x-auto/)
  assert.match(page, /Active range:/)
})

test('no stale Yesterday or This Week labels remain', () => {
  assert.doesNotMatch(page, /Yesterday/)
  assert.doesNotMatch(page, /This Week/)
})
