import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { buildDailySeries, buildMetricComparison, sparklinePoints } from '../src/lib/dashboard/trends.ts'
import { buildCashPosition } from '../src/lib/dashboard/cash-position.ts'
import { buildOperationalPulse, operationalPulseHasError } from '../src/lib/dashboard/operational-pulse.ts'
import {
  canOpenDashboardDestination,
  prefersFinanceFirstDashboard,
  resolveDashboardSections,
} from '../src/lib/dashboard/sections.ts'
import { describeAttentionOverflow } from '../src/lib/dashboard/attention.ts'
import { businessDaySpan, bizPreviousDateRange, businessDateLabels } from '../src/lib/dates.ts'

const page = await readFile('src/components/erp/views/owner-dashboard.tsx', 'utf8')
const hook = await readFile('src/hooks/use-owner-dashboard.ts', 'utf8')
const summary = await readFile('src/lib/dashboard/owner-summary.ts', 'utf8')
const shell = await readFile('src/components/erp/dashboard-shell.tsx', 'utf8')
const cashPositionSource = await readFile('src/lib/dashboard/cash-position.ts', 'utf8')
const pulseSource = await readFile('src/lib/dashboard/operational-pulse.ts', 'utf8')
const insightSource = await readFile('src/lib/dashboard/insights.ts', 'utf8')
const sectionSource = await readFile('src/lib/dashboard/sections.ts', 'utf8')

// ── §2 prior-period comparison ──────────────────────────────────────────────

test('a comparison exists only when both periods were actually measured', () => {
  assert.equal(buildMetricComparison({ current: 500, previous: null }), null)
  assert.equal(buildMetricComparison({ current: null, previous: 500 }), null)
  assert.equal(buildMetricComparison({ current: 500, previous: Number.NaN }), null)
  assert.deepEqual(buildMetricComparison({ current: 1500, previous: 1000 }), {
    previous: 1000, delta: 500, direction: 'up', percent: 50,
  })
})

test('no percentage is fabricated from a zero or negative base', () => {
  assert.equal(buildMetricComparison({ current: 500, previous: 0 })?.percent, null)
  assert.equal(buildMetricComparison({ current: 500, previous: -200 })?.percent, null)
  assert.equal(buildMetricComparison({ current: 0, previous: 0 })?.direction, 'flat')
})

test('the previous range is an equally long window immediately before the selection', () => {
  assert.deepEqual(bizPreviousDateRange({ from: '2026-08-10', to: '2026-08-16' }), {
    from: '2026-08-03', to: '2026-08-09',
  })
  assert.deepEqual(bizPreviousDateRange({ from: '2026-08-10', to: '2026-08-10' }), {
    from: '2026-08-09', to: '2026-08-09',
  })
  assert.equal(businessDaySpan({ from: '2026-08-10', to: '2026-08-16' }), 7)
})

// ── §2 sparklines ───────────────────────────────────────────────────────────

test('a sparkline is omitted whenever the payload cannot support one', () => {
  const labels = ['2026-08-01', '2026-08-02', '2026-08-03']
  assert.equal(buildDailySeries({ labels: null, points: [{ date: '2026-08-01', value: 5 }] }), null)
  assert.equal(buildDailySeries({ labels, points: null }), null)
  assert.equal(buildDailySeries({ labels: ['2026-08-01'], points: [{ date: '2026-08-01', value: 5 }] }), null)
  // A period with no movement says so in words; an all-zero line adds nothing.
  assert.equal(buildDailySeries({ labels, points: [{ date: '2026-08-02', value: 0 }] }), null)
  assert.equal(sparklinePoints([5], 96, 20), null)
})

test('a series buckets a dated source by business day and ignores unknown days', () => {
  const labels = ['2026-08-01', '2026-08-02', '2026-08-03']
  assert.deepEqual(buildDailySeries({
    labels,
    points: [
      { date: '2026-08-01', value: 100 },
      { date: '2026-08-01T18:00:00+05:00', value: 50 },
      { date: '2026-07-31', value: 9_999 },
      { date: null, value: 9_999 },
      { date: '2026-08-03', value: -25 },
    ],
  }), [150, 0, -25])
  assert.equal(businessDateLabels({ from: '2026-08-01', to: '2026-08-03' })?.length, 3)
  // A long custom range has no readable inline shape, so no labels are emitted.
  assert.equal(businessDateLabels({ from: '2025-01-01', to: '2026-01-01' }), null)
})

test('point-in-time balances are never given a series or a comparison', () => {
  assert.match(summary, /totalReceivables: \{ series: null as number\[\] \| null, comparison: null \}/)
  assert.match(summary, /totalPayables: \{ series: null as number\[\] \| null, comparison: null \}/)
  // report_cash_flow reports no dates, so the legacy net-cash line is dropped.
  assert.match(summary, /const netCashPoints: SeriesPoint\[\] \| null = legacyReports \|\|/)
  assert.match(page, /if \(!points\) return null/)
})

// ── §3 Cash Position ────────────────────────────────────────────────────────

test('Cash Position groups active accounts only and never fabricates a total', () => {
  const position = buildCashPosition({
    state: 'available',
    normalizeType: (raw) => raw === 'Petty Cash' ? 'Cash' : raw === 'Easypaisa' ? 'Wallet' : raw,
    accounts: [
      { type: 'Cash', isActive: true, balancePaisas: '150000' },
      { type: 'Petty Cash', isActive: true, balancePaisas: '50000' },
      { type: 'Bank', isActive: true, balancePaisas: '900000' },
      { type: 'Easypaisa', isActive: true, balancePaisas: '2500' },
      { type: 'Bank', isActive: false, balancePaisas: '77777777' },
    ],
  })

  assert.deepEqual(position.groups, [
    { type: 'Cash', accountCount: 2, balancePaisas: '200000' },
    { type: 'Bank', accountCount: 1, balancePaisas: '900000' },
    { type: 'Wallet', accountCount: 1, balancePaisas: '2500' },
  ])
  assert.equal(position.accountCount, 4)
  assert.equal(position.totalPaisas, '1102500')
})

test('Cash Position distinguishes zero, unavailable and not tracked', () => {
  const zero = buildCashPosition({ state: 'available', accounts: [] })
  assert.deepEqual([zero.accountCount, zero.totalPaisas], [0, '0'])
  for (const state of ['not-tracked', 'error'] as const) {
    const absent = buildCashPosition({ state, accounts: null })
    assert.deepEqual([absent.state, absent.groups, absent.totalPaisas], [state, [], null])
  }
  assert.match(page, /No active payment accounts\./)
  assert.match(page, /Account balances are not tracked on this data source\./)
  assert.match(page, /Unable to load account balances/)
})

test('Cash Position reuses the existing Business Accounts source without new gates', () => {
  assert.match(summary, /accounts: paymentAccountsState !== 'available' \? null : \(paymentAccountsQ\?\.value \?\? \[\]\)/)
  assert.doesNotMatch(summary, /setup\/coa/)
  // No bank name, holder or account number reaches the dashboard payload.
  assert.doesNotMatch(cashPositionSource, /bankName|accountHolder|accountNumber/)
})

// ── §4 Operational Pulse ────────────────────────────────────────────────────

test('Operational Pulse shows counts only, and only measured ones', () => {
  const items = buildOperationalPulse({
    counts: { invoices: 12, collections: 4, expenses: 0, purchases: null, salesReturns: 1, purchaseReturns: 2 },
    states: {
      invoices: 'available', collections: 'available', expenses: 'available',
      purchases: 'not-tracked', salesReturns: 'error', purchaseReturns: 'available',
    },
  })

  assert.deepEqual(items.map((item) => [item.key, item.count]), [
    ['invoices', 12], ['collections', 4], ['expenses', 0], ['purchaseReturns', 2],
  ])
  assert.ok(items.every((item) => Number.isInteger(item.count)))
  assert.equal(operationalPulseHasError({ salesReturns: 'error' }), true)
  assert.equal(operationalPulseHasError({ salesReturns: 'not-tracked' }), false)
})

test('Operational Pulse repeats no money value and no event row', () => {
  assert.doesNotMatch(pulseSource, /formatWholeRupees|Paisas|amount/)
  assert.match(page, /How many documents were recorded in/)
  // Rider/COD has no verified production table, so no such count is defined.
  assert.doesNotMatch(pulseSource, /key: 'rider|key: 'cod/)
  assert.doesNotMatch(pulseSource, /timestamp|title:/)
})

// ── §5 duplication ──────────────────────────────────────────────────────────

test('no section restates another section, and totals stay visible without a second card', () => {
  assert.equal(describeAttentionOverflow({
    negativeStockProducts: [{ id: 'a', name: 'A', currentStock: -1 }],
    lowStockProducts: [{ id: 'b', name: 'B', currentStock: 1, lowStockThreshold: 5 }],
    negativeStockCount: 3, lowStockCount: 4,
  }), '2 more with negative stock and 3 more below their stock threshold are not listed here.')
  assert.equal(describeAttentionOverflow({
    negativeStockProducts: [], lowStockProducts: [], negativeStockCount: 0, lowStockCount: 0,
  }), null)
  assert.doesNotMatch(insightSource, /Review Stock|Open Business Accounts/)
  assert.doesNotMatch(page, /Recent invoices|Recent purchases/)
})

// ── §6 role-based order and visibility ──────────────────────────────────────

const OWNER = [
  'can_view_trial_balance', 'can_manage_setup', 'can_view_setup', 'can_view_sales',
  'can_view_purchases', 'can_view_products', 'can_view_account_balances', 'can_view_audit_log',
  'can_view_day_book', 'can_view_delivery_orders', 'can_create_expense_batch',
]
const ACCOUNTANT = [
  'can_view_trial_balance', 'can_view_setup', 'can_view_sales', 'can_view_purchases',
  'can_view_products', 'can_view_account_balances', 'can_view_audit_log',
]

test('role order comes from permissions, not from a role name', () => {
  assert.equal(prefersFinanceFirstDashboard(OWNER), false)
  assert.equal(prefersFinanceFirstDashboard(ACCOUNTANT), true)
  assert.deepEqual(resolveDashboardSections(OWNER), [
    'hero', 'attention', 'insights', 'cash-position', 'pulse', 'breakdown', 'activity',
  ])
  assert.deepEqual(resolveDashboardSections(ACCOUNTANT), [
    'hero', 'cash-position', 'insights', 'attention', 'pulse', 'breakdown', 'activity',
  ])
  const sections = sectionSource
  assert.doesNotMatch(sections, /roleName|'Owner\/Admin'|'Accountant'/)
})

test('a section or drill-down is hidden when the viewer lacks the underlying page', () => {
  assert.deepEqual(resolveDashboardSections(['can_view_sales']), ['hero', 'attention', 'insights', 'pulse', 'breakdown'])
  assert.deepEqual(resolveDashboardSections([]), ['hero', 'attention', 'insights', 'pulse'])
  assert.equal(canOpenDashboardDestination(ACCOUNTANT, '/?page=business-accounts'), true)
  assert.equal(canOpenDashboardDestination(ACCOUNTANT, '/?page=expense-batch'), false)
  assert.equal(canOpenDashboardDestination([], '/?page=inventory'), false)
  // No owner bypass anywhere: a permission is a permission.
  assert.equal(canOpenDashboardDestination(OWNER, '/?page=delivery'), true)
})

test('both business-wide roles render the one shared command center', () => {
  assert.match(shell, /user\.roleName === 'Owner\/Admin' \|\| user\.roleName === 'Accountant'\) return <OwnerDashboard/)
  assert.doesNotMatch(shell, /AccountantDashboard/)
  assert.match(page, /resolveDashboardSections\(permissions\)\.map/)
})

// ── §7 performance and refresh behaviour ────────────────────────────────────

test('Phase 2 adds no unbounded work and preserves Phase 1B refresh behaviour', () => {
  assert.match(hook, /placeholderData: keepPreviousData/)
  assert.match(hook, /staleTime: 30_000/)
  assert.match(page, /isLoading && !data/)
  assert.doesNotMatch(page, /scrollTo\(|scrollIntoView\(/)
  // Prior-period reads live inside the one existing batch, never in a loop.
  assert.match(summary, /prevSalesQ, prevCashQ, prevPaymentQ, prevExpenseQ\] = await Promise\.all\(\[/)
  // Three fixed batches and no more: the metric batch, the ledger accounts, and
  // the two tables a collection can come from. None of them sits in a loop.
  assert.equal(summary.match(/await Promise\.all\(\[/g)?.length, 3)
  assert.match(summary, /const \[allocated, received\] = await Promise\.all\(\[/)
  assert.doesNotMatch(page, /refetchInterval|setInterval\(/)
})
