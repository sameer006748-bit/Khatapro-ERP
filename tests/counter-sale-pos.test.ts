import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { computeSaleTotals, normalizeSaleLine } from '../src/lib/sales/sale-engine.ts'

const counter = await readFile('src/components/erp/views/counter-sale-view.tsx', 'utf8')
const paymentPanel = await readFile('src/components/erp/sales/payment-panel.tsx', 'utf8')

test('Counter POS preserves fast product keyboard navigation', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
    assert.match(counter, new RegExp(`e\\.key === '${key}'`))
  }
  assert.match(counter, /searchRef\.current\?\.focus\(\)/)
})

test('default bill row is compact and advanced accounting details expand on demand', () => {
  assert.match(counter, />Product</)
  assert.match(counter, />Qty</)
  assert.match(counter, />Total</)
  assert.match(counter, /aria-expanded=\{isExpanded\}/)
  for (const detail of [
    'Returned quantity', 'Rate override', 'Net quantity',
    'Commission per piece', 'Commission total', 'Stock impact', 'Remove item',
  ]) assert.match(counter, new RegExp(detail))
  assert.match(counter, /overflow-x-hidden/)
})

test('default cart rows reserve visible space for the selected product identity', () => {
  const billRows = counter.slice(counter.indexOf('function BillRows'), counter.indexOf('function Detail'))
  assert.match(billRows, /table-fixed/)
  assert.match(billRows, /w-\[124px\].*>Qty</)
  assert.match(billRows, /w-\[84px\].*>Total</)
  assert.match(billRows, /line-clamp-2 break-words font-medium leading-tight text-foreground/)
  assert.match(billRows, /\{row\.productName\}/)
})

test('active bill keeps normal bills readable and scrolls only genuinely long item lists', () => {
  const billRows = counter.slice(counter.indexOf('function BillRows'), counter.indexOf('function Detail'))
  assert.doesNotMatch(counter, /lg:h-\[calc\(100dvh-9\.5rem\)\]/)
  assert.match(billRows, /data-testid="active-bill-items"/)
  assert.match(billRows, /const shouldScrollItems = rows\.length > 6/)
  assert.match(billRows, /shouldScrollItems \? 'min-w-0 lg:max-h-\[420px\] lg:overflow-y-auto' : 'min-w-0'/)
  assert.match(billRows, /data-testid="active-bill-item-row"/)
  assert.match(billRows, /line-clamp-2 break-words font-medium leading-tight text-foreground/)
  assert.match(billRows, /title=\{row\.productName\}/)
  assert.match(billRows, /Quantity of \$\{row\.productName\}/)
  assert.match(billRows, /formatWholeRupees\(line\.lineTotalPaisas\)/)
  assert.match(billRows, /aria-expanded=\{isExpanded\}/)
  assert.match(billRows, /sm:grid-cols-2 2xl:grid-cols-4/)
  assert.match(counter, /<PaymentPanel/)
  assert.match(counter, /> Post Sale</)
})

test('same-bill Sold 10 / Returned 2 remains Net 8 with unchanged commission arithmetic', () => {
  const line = normalizeSaleLine({
    productId: 'product-1', productName: 'Fabric', soldQty: 10, returnedQty: 2,
    unitPricePaisas: 1_500_00n, commissionRatePaisas: 20_00n, isTemporary: false,
  })
  const totals = computeSaleTotals([line])
  assert.equal(line.netQty, 8)
  assert.equal(line.stockEffect, -8)
  assert.equal(totals.netSalePaisas, 12_000_00n)
  assert.equal(totals.totalCommissionPaisas, 160_00n)
})

test('payment stays explicit, always expanded (embedded), editable, and split-capable', () => {
  // Payment panel is embedded in the compact layout; no longer collapsible.
  assert.doesNotMatch(counter, /collapsible/)
  assert.match(counter, /onPayFull/)
  assert.match(paymentPanel, /Amount not entered/)
  assert.match(paymentPanel, /> Edit/)
  assert.match(paymentPanel, /Split Payment/)
  assert.match(paymentPanel, /Pay Full/)
})

test('seller and optional customer attribution remain in the compact bill header', () => {
  assert.match(counter, /Sold by/)
  assert.match(counter, />\s*Owner\s*</)
  assert.match(counter, />\s*Salesman\s*</)
  assert.match(counter, /Customer \(optional\)/)
  assert.match(counter, /sellerRole === 'OWNER'/)
  assert.match(counter, /salesmanId: sellerRole === 'SALESMAN'/)
})

test('totals and Post Sale remain in the fixed bill footer with a disabled reason', () => {
  assert.match(counter, /shrink-0 border-t border-primary/)
  assert.match(counter, />Net sale</)
  assert.match(counter, /> Post Sale</)
  assert.match(counter, /disabledReason/)
})

test('counter uses natural Active Bill flow and caps only a genuinely long item list', () => {
  const billRows = counter.slice(counter.indexOf('function BillRows'), counter.indexOf('function Detail'))
  // Bottom spacing keeps the footer clear of the fixed Ask KhataPro AI launcher.
  assert.match(counter, /lg:mb-20/)
  // A normal bill has no viewport cap or leftover-height wrapper that can collapse rows.
  assert.doesNotMatch(counter, /lg:max-h-\[min\(820px,calc\(100dvh-8rem\)\)\]/)
  assert.doesNotMatch(counter, /lg:flex-1 lg:basis-0 lg:overflow-y-auto/)
  assert.doesNotMatch(counter, /lg:min-h-\[96px\]/)
  assert.doesNotMatch(counter, /lg:h-\[calc\(100dvh-9\.5rem\)\]/)
  // 1–6 items render in document flow; only 7+ use the capped internal list.
  assert.match(billRows, /const shouldScrollItems = rows\.length > 6/)
  assert.match(billRows, /lg:max-h-\[420px\] lg:overflow-y-auto/)
  assert.ok(counter.indexOf('<BillRows') < counter.indexOf('<PaymentPanel'))
  assert.ok(counter.indexOf('<PaymentPanel') < counter.indexOf('<BillSummary'))
})
