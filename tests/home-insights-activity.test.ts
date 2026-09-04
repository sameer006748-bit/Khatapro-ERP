import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { buildDashboardInsights } from '../src/lib/dashboard/insights.ts'
import { buildRecentDashboardActivity } from '../src/lib/dashboard/recent-activity.ts'

const page = await readFile('src/components/erp/views/owner-dashboard.tsx', 'utf8')
const summary = await readFile('src/lib/dashboard/owner-summary.ts', 'utf8')
const hook = await readFile('src/hooks/use-owner-dashboard.ts', 'utf8')
const route = await readFile('src/app/api/dashboard/owner/route.ts', 'utf8')
const insightSource = await readFile('src/lib/dashboard/insights.ts', 'utf8')

const clearInsightInput = {
  netCashMovement: 0,
  netCashMovementAvailable: true,
  salesComparison: null,
  netCashComparison: null,
  previousPeriodLabel: 'previous day',
  formatAmount: (paisas: number) => `Rs ${paisas / 100}`,
}

test('Business Insights are deterministic and hidden when no supported condition is true', () => {
  assert.deepEqual(buildDashboardInsights(clearInsightInput), [])
  assert.match(page, /insights\.length === 0/)
  assert.doesNotMatch(page, /AI-generated insight|trend chart/i)
})

test('Business Insights no longer restate the rows Needs Attention already owns', () => {
  const insights = buildDashboardInsights({
    ...clearInsightInput,
    netCashMovement: -5000,
  })

  assert.deepEqual(insights.map((item) => [item.id, item.destination]), [
    ['negative-cash', '/?page=accounts'],
  ])
  assert.deepEqual(buildDashboardInsights({ ...clearInsightInput, netCashMovement: -1, netCashMovementAvailable: false }), [])
  assert.doesNotMatch(insightSource, /id: 'negative-stock'|id: 'low-stock'|id: 'payment-account'/)
})

test('comparison wording appears only for a measured prior period', () => {
  // A comparison object with no period label, and a label with no comparison,
  // must both stay silent: interpreted wording needs both halves measured.
  assert.deepEqual(buildDashboardInsights({
    ...clearInsightInput,
    previousPeriodLabel: null,
    salesComparison: { previous: 1000, delta: 500, direction: 'up', percent: 50 },
  }), [])
  const [salesTrend] = buildDashboardInsights({
    ...clearInsightInput,
    salesComparison: { previous: 1000, delta: 500, direction: 'up', percent: 50 },
  })
  assert.equal(salesTrend.id, 'sales-trend')
  assert.match(salesTrend.title, /up 50% versus the previous day/)
  // A zero base carries no defensible percentage, so the wording states rupees.
  const [zeroBase] = buildDashboardInsights({
    ...clearInsightInput,
    salesComparison: { previous: 0, delta: 500, direction: 'up', percent: null },
  })
  assert.doesNotMatch(zeroBase.title, /%/)
  assert.match(summary, /previousRange/)
})

test('Recent Activity keeps only meaningful business events, in newest-first order', () => {
  const activities = buildRecentDashboardActivity([
    { id: 'technical', timestamp: '2026-08-02T12:00:00.000Z', action: 'AI_SETTINGS_KEY_SAVED', entity: 'settings', entityId: 'secret', details: {} },
    { id: 'sale', timestamp: '2026-08-02T10:00:00.000Z', action: 'POST_SALE', entity: 'invoice', entityId: 'uuid-not-shown', details: { invoice_no: 'INV-1024', total: '12500' } },
    { id: 'payment', timestamp: '2026-08-02T11:00:00.000Z', action: 'POST_RECEIPT_VOUCHER', entity: 'receipt', entityId: 'uuid-not-shown', details: JSON.stringify({ receipt_no: 'RCP-3', amount: '3000' }) },
    { id: 'replacement', timestamp: '2026-08-02T09:00:00.000Z', action: 'PURCHASE_REPLACEMENT', entity: 'purchase_replacement', entityId: 'REP-42', details: {} },
  ])

  assert.deepEqual(activities.map((item) => [item.id, item.title, item.reference]), [
    ['payment', 'Payment received', 'RCP-3'],
    ['sale', 'Sale posted', 'INV-1024'],
    ['replacement', 'Purchase replacement posted', 'REP-42'],
  ])
})

test('Recent Activity has clear empty and error states, and replaces overlapping history cards', () => {
  assert.deepEqual(buildRecentDashboardActivity([]), [])
  assert.match(page, /No recent activity/)
  assert.match(page, /Unable to load recent activity/)
  assert.match(page, /Recent Activity/)
  assert.doesNotMatch(page, /Recent invoices|Recent purchases|ActivityList/)
  assert.match(hook, /recentInvoices/)
  assert.match(hook, /recentPurchases/)
})

test('timeline activity remains business scoped and does not broaden audit permissions', () => {
  assert.match(summary, /\.eq\('business_id', bid\)/)
  assert.match(summary, /\.select\('id, timestamp, action, entity, entity_id, details'\)/)
  assert.match(route, /loaded\.roleName !== 'Owner\/Admin'/)
  assert.match(route, /requirePermission\(loaded, 'can_view_trial_balance'\)/)
})
