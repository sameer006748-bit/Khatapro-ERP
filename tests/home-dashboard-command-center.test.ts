import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { buildDashboardAttention, sortDashboardAttention, type DashboardAttentionItem } from '../src/lib/dashboard/attention.ts'

const page = await readFile('src/components/erp/views/owner-dashboard.tsx', 'utf8')
const hook = await readFile('src/hooks/use-owner-dashboard.ts', 'utf8')

const baseInput = {
  negativeStockProducts: [],
  lowStockProducts: [],
  paymentAccounts: { activeCount: 1, state: 'available' as const },
}

test('attention severity sorts Critical above Due Soon and Watch', () => {
  const items: DashboardAttentionItem[] = [
    { id: 'watch', kind: 'low-stock', title: 'Watch', detail: '', severity: 'watch', urgency: 1, destination: '/watch', actionLabel: 'Review' },
    { id: 'due', kind: 'low-stock', title: 'Due', detail: '', severity: 'due-soon', urgency: 1, destination: '/due', actionLabel: 'Review' },
    { id: 'critical', kind: 'negative-stock', title: 'Critical', detail: '', severity: 'critical', urgency: 1, destination: '/critical', actionLabel: 'Review' },
  ]

  assert.deepEqual(sortDashboardAttention(items).map((item) => item.id), ['critical', 'due', 'watch'])
})

test('attention is empty when no supported actionable condition exists', () => {
  assert.deepEqual(buildDashboardAttention(baseInput), [])
})

test('attention uses only real payload conditions and known destinations', () => {
  const items = buildDashboardAttention({
    negativeStockProducts: [{ id: 'negative', name: 'Broken stock', currentStock: -3 }],
    lowStockProducts: [{ id: 'low', name: 'Low stock', currentStock: 1, lowStockThreshold: 5 }],
    paymentAccounts: { activeCount: 0, state: 'available' },
  })

  assert.deepEqual(items.map((item) => [item.id, item.severity, item.destination, item.actionLabel]), [
    ['payment-accounts', 'critical', '/?page=business-accounts', 'Open Business Accounts'],
    ['negative-negative', 'critical', '/?page=inventory', 'Review Stock'],
    ['low-low', 'watch', '/?page=inventory', 'Review Stock'],
  ])
  assert.deepEqual(buildDashboardAttention({ ...baseInput, paymentAccounts: { activeCount: 0, state: 'not-tracked' } }), [])
})

test('only supported hero KPIs expose existing drill-down destinations', () => {
  for (const [label, destination] of [
    ['Sales', '/?page=sales-list'],
    ['Net Cash Movement', '/?page=accounts'],
    ['Receivables', '/?page=accounts'],
    ['Payables', '/?page=purchases'],
  ]) {
    assert.match(page, new RegExp(`label: '${label}'[\\s\\S]*destination: '${destination.replace(/[/?]/g, '\\$&')}'`))
  }
  // Shell state is written with the history primitive, not router.push: every
  // screen here is the same route, and router.push discards a same-route
  // navigation silently when it cannot resolve it. The gate in front is what
  // matters on this line - an unreachable destination gets no handler at all.
  // See tests/shell-navigation-primitive.test.ts for the full audit.
  assert.match(page, /onOpen=\{canOpen\(destination\) \? \(\) => navigateShell\(destination\) : undefined\}/)
})

test('dashboard refresh retains existing content and exposes keyboard-accessible actions', () => {
  assert.match(hook, /placeholderData: keepPreviousData/)
  assert.match(page, /isLoading && !data/)
  assert.match(page, /focus-visible:ring-2/)
  assert.match(page, /type="button"/)
  assert.doesNotMatch(page, /scrollTo\(|scrollIntoView\(/)
})
