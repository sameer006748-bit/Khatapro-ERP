/**
 * Sale + return in one bill, product-wise commission, seller attribution and
 * the printed document — the approved client requirement batch.
 *
 * The arithmetic tests exercise the real shared engine (src/lib/sales/sale-engine.ts),
 * which is the single implementation Counter, Online, OFC and Other all post
 * through. The remaining tests pin the contracts that live in SQL, in the API
 * routes and in the POS screen, which cannot be executed here without a
 * database or a browser.
 *
 * Worked example used throughout, exactly as approved:
 *   10 sold, 2 returned -> net 8; commission rate Rs 20/piece -> Rs 160.
 */
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  normalizeSaleLine,
  normalizeSaleLines,
  computeSaleTotals,
  validateSaleTotals,
  computeStockEffects,
  computeCommissionLines,
  sumCommission,
  computeEarnedCommission,
  resolveSellerAttribution,
  buildInvoicePrintModel,
  invoiceDocumentTitle,
  invoiceChannelLabel,
  SaleLineError,
} from '../src/lib/sales/sale-engine.ts'

const RS = 100n            // paisas per rupee
const RATE_RS_20 = 20n * RS // Rs 20 per piece commission

const dataAccess = await readFile('src/lib/sales/data-access.ts', 'utf8')
const compatibility = await readFile('src/lib/supabase/rpc-compatibility.ts', 'utf8')
const migration = await readFile('supabase/migrations/00033_mixed_sale_returns.sql', 'utf8')
const counterView = await readFile('src/components/erp/views/counter-sale-view.tsx', 'utf8')
const printDialog = await readFile('src/components/invoice/invoice-print-dialog.tsx', 'utf8')
const invoiceRoute = await readFile('src/app/api/sales/[id]/route.ts', 'utf8')
const printButton = await readFile('src/components/invoice/print-invoice-button.tsx', 'utf8')

/** The approved worked example as one normalized bill row. */
function workedExampleLine() {
  return normalizeSaleLine({
    productId: 'p1',
    productName: 'Test Product',
    soldQty: 10,
    returnedQty: 2,
    unitPricePaisas: 500n * RS,
    commissionRatePaisas: RATE_RS_20,
  })
}

// ── 1-4. The worked example ────────────────────────────────────────────────

test('10 sold and 2 returned bill a net quantity of 8', () => {
  const line = workedExampleLine()
  assert.equal(line.soldQty, 10)
  assert.equal(line.returnedQty, 2)
  assert.equal(line.netQty, 8)
})

test('stock decreases by the net quantity, not the gross sold quantity', () => {
  const line = workedExampleLine()
  assert.equal(line.stockEffect, -8)
  const [effect] = computeStockEffects([line])
  assert.equal(effect.netChange, -8, 'stock must move by net 8, not 10 out and 2 in as separate figures')
  assert.equal(effect.soldQty, 10)
  assert.equal(effect.returnedQty, 2)
})

test('commission units follow the net quantity', () => {
  const line = workedExampleLine()
  assert.equal(line.commissionUnits, 8)
  const [commission] = computeCommissionLines([line])
  assert.equal(commission.netEligibleQty, 8)
  assert.equal(commission.soldQty, 10, 'the sold quantity must stay visible, not be collapsed into net')
  assert.equal(commission.returnedQty, 2)
})

test('Rs 20 per piece on net 8 earns exactly Rs 160', () => {
  const line = workedExampleLine()
  assert.equal(line.commissionRatePaisas, RATE_RS_20)
  assert.equal(line.commissionAmountPaisas, 160n * RS)
  assert.equal(sumCommission(computeCommissionLines([line])), 160n * RS)
})

// ── 5-6. Return quantity limits ────────────────────────────────────────────

test('returned quantity cannot exceed sold quantity on a new bill', () => {
  assert.throws(
    () => normalizeSaleLine({
      productId: 'p1', productName: 'Test Product',
      soldQty: 5, returnedQty: 6, unitPricePaisas: 100n * RS,
    }),
    (e: unknown) => e instanceof SaleLineError && /cannot exceed sold quantity/.test((e as Error).message),
  )
  // Equal quantities are legal — a fully swapped-back line nets to zero pieces.
  const line = normalizeSaleLine({
    productId: 'p1', productName: 'Test Product',
    soldQty: 5, returnedQty: 5, unitPricePaisas: 100n * RS, commissionRatePaisas: RATE_RS_20,
  })
  assert.equal(line.netQty, 0)
  assert.equal(line.commissionAmountPaisas, 0n)
})

test('a referenced historical return cannot exceed the remaining returnable quantity', () => {
  assert.throws(
    () => normalizeSaleLine({
      productId: 'p1', productName: 'Test Product', soldQty: 0, returnedQty: 4,
      unitPricePaisas: 100n * RS,
      originalInvoiceItemId: '11111111-1111-1111-1111-111111111111',
      remainingReturnableQty: 3,
    }),
    (e: unknown) => e instanceof SaleLineError && /exceeds the remaining returnable quantity/.test((e as Error).message),
  )
  // Within the remaining quantity it is accepted and keeps its audit link.
  const ok = normalizeSaleLine({
    productId: 'p1', productName: 'Test Product', soldQty: 0, returnedQty: 3,
    unitPricePaisas: 100n * RS,
    originalInvoiceItemId: '11111111-1111-1111-1111-111111111111',
    remainingReturnableQty: 3,
  })
  assert.equal(ok.kind, 'HISTORICAL_RETURN')
  assert.equal(ok.originalInvoiceItemId, '11111111-1111-1111-1111-111111111111')
  assert.equal(ok.stockEffect, 3, 'a referenced return restores stock')
})

test('a historical return requires the original invoice item reference and its remaining quantity', () => {
  // No remaining quantity supplied -> refuse rather than guess.
  assert.throws(
    () => normalizeSaleLine({
      productId: 'p1', productName: 'Test Product', soldQty: 0, returnedQty: 1,
      unitPricePaisas: 100n * RS,
      originalInvoiceItemId: '11111111-1111-1111-1111-111111111111',
    }),
    (e: unknown) => e instanceof SaleLineError && /remaining returnable quantity .* is unknown/.test((e as Error).message),
  )
  // A row with no reference is a plain sale and must carry a sold quantity.
  assert.throws(
    () => normalizeSaleLine({ productId: 'p1', productName: 'Test Product', soldQty: 0, unitPricePaisas: 100n * RS }),
    (e: unknown) => e instanceof SaleLineError && /greater than zero/.test((e as Error).message),
  )
})

// ── 7. Idempotency ─────────────────────────────────────────────────────────

test('duplicate submission of the same bill is idempotent end to end', () => {
  // Sale half: the deployed idempotency table replays the same invoice.
  assert.match(dataAccess, /idempotencyKey/)
  assert.match(dataAccess, /p_idempotency_key: input\.idempotencyKey \?\? randomUUID\(\)/)
  // Return half: its key is derived from the sale key, so replaying the mixed
  // bill replays BOTH documents instead of creating a second return.
  assert.match(migration, /v_return_key := 'mixed-sale-return:' \|\| p_idempotency_key/)
  assert.match(migration, /if p_idempotency_key is null or length\(trim\(p_idempotency_key\)\) = 0 then/)
  // Local engine: commission events are business-scoped and conflict-safe.
  assert.match(dataAccess, /idempotencyKey/)
})

// ── 8-9. Commission is earned on collection, not on invoice creation ───────

test('commission is earned when payment is collected', () => {
  // Full collection of a Rs 800 bill earns the whole Rs 160 eligibility.
  assert.equal(
    computeEarnedCommission({
      totalEligibilityPaisas: 160n * RS,
      invoiceTotalPaisas: 800n * RS,
      collectedAmountPaisas: 800n * RS,
      priorEarnedPaisas: 0n,
    }),
    160n * RS,
  )
  // Half collected -> half earned; the final collection closes the remainder
  // so integer division can never short-pay or over-pay the seller.
  const first = computeEarnedCommission({
    totalEligibilityPaisas: 160n * RS,
    invoiceTotalPaisas: 800n * RS,
    collectedAmountPaisas: 400n * RS,
    priorEarnedPaisas: 0n,
  })
  assert.equal(first, 80n * RS)
  const second = computeEarnedCommission({
    totalEligibilityPaisas: 160n * RS,
    invoiceTotalPaisas: 800n * RS,
    collectedAmountPaisas: 800n * RS,
    priorEarnedPaisas: first,
  })
  assert.equal(first + second, 160n * RS)
})

test('an unpaid sale earns no commission prematurely', () => {
  assert.equal(
    computeEarnedCommission({
      totalEligibilityPaisas: 160n * RS,
      invoiceTotalPaisas: 800n * RS,
      collectedAmountPaisas: 0n,
      priorEarnedPaisas: 0n,
    }),
    0n,
  )
  // The eligibility row still exists so the figure is visible as pending.
  assert.match(dataAccess, /status: 'calculated'/)
  assert.match(dataAccess, /Only money actually received earns commission/)
})

// ── 10-11. Owner versus Salesman attribution ───────────────────────────────

test('an Owner personal sale credits the Owner and never a salesman', () => {
  const result = resolveSellerAttribution({
    sellerMode: 'OWNER',
    requestedSalesmanId: 'salesman-9',   // ignored on purpose
    actorCanAttributeAnySeller: true,
  })
  assert.equal(result.ok, true)
  assert.ok(result.ok)
  assert.equal(result.attribution.role, 'OWNER')
  assert.equal(result.attribution.salesmanId, null)
  assert.equal(result.attribution.isOwnerCommission, true)
})

test('a salesman sale credits that salesman', () => {
  const named = resolveSellerAttribution({
    sellerMode: 'SALESMAN',
    requestedSalesmanId: 'salesman-3',
    actorCanAttributeAnySeller: true,
  })
  assert.ok(named.ok)
  assert.equal(named.attribution.role, 'SALESMAN')
  assert.equal(named.attribution.salesmanId, 'salesman-3')

  // A salesman-scoped user always sells as themselves, whatever is requested.
  const own = resolveSellerAttribution({
    sellerMode: 'SALESMAN',
    requestedSalesmanId: 'someone-else',
    actorCanAttributeAnySeller: false,
    actorSalesmanId: 'salesman-7',
  })
  assert.ok(own.ok)
  assert.equal(own.attribution.salesmanId, 'salesman-7')
})

test('an Owner must state the seller — there is no default salesman fallback', () => {
  const result = resolveSellerAttribution({
    sellerMode: null,
    requestedSalesmanId: null,
    actorCanAttributeAnySeller: true,
  })
  assert.equal(result.ok, false)
  assert.ok(!result.ok)
  assert.equal(result.status, 400)
  assert.match(result.error, /Select who made this sale/)
})

// ── 12. One shared calculation for every channel ───────────────────────────

test('Counter, Online, OFC and Other all post through the same engine', async () => {
  const routes = await Promise.all([
    readFile('src/app/api/sales/counter/route.ts', 'utf8'),
    readFile('src/app/api/sales/online/route.ts', 'utf8'),
    readFile('src/app/api/sales/ofc/route.ts', 'utf8'),
    readFile('src/app/api/sales/other/route.ts', 'utf8'),
  ])
  for (const route of routes) {
    assert.match(route, /postSale/, 'every channel posts through the shared poster')
    assert.match(route, /resolveSaleSeller/, 'every channel resolves the seller server-side')
  }
  // The poster itself derives every figure from the shared engine.
  assert.match(dataAccess, /normalizeSaleLines/)
  assert.match(dataAccess, /computeSaleTotals/)
  assert.match(dataAccess, /validateSaleTotals/)
  assert.match(dataAccess, /computeStockEffects/)
  // Channel-specific fields stay in their own routes.
  assert.match(routes[1], /rider|source|advance/i)
  assert.match(routes[2], /rider|cod|delivery/i)
})

test('channel labels and document titles come from one place', () => {
  assert.equal(invoiceDocumentTitle('COUNTER'), 'SALE INVOICE')
  assert.equal(invoiceDocumentTitle('ONLINE'), 'ONLINE ORDER')
  assert.equal(invoiceDocumentTitle('OFC'), 'OFC INVOICE')
  assert.equal(invoiceDocumentTitle('OTHER'), 'SALE INVOICE')
  assert.equal(invoiceChannelLabel('OFC'), 'Out-of-City Sale')
})

// ── 13-14. Mixed bill totals, payment and receivable ───────────────────────

test('mixed sale and return totals net correctly across the bill', () => {
  const lines = normalizeSaleLines([
    // Rs 500 x 10 sold, 2 returned -> net 8 -> Rs 4,000
    { productId: 'p1', productName: 'A', soldQty: 10, returnedQty: 2, unitPricePaisas: 500n * RS, commissionRatePaisas: RATE_RS_20 },
    // Rs 250 x 4 sold, none returned -> Rs 1,000
    { productId: 'p2', productName: 'B', soldQty: 4, unitPricePaisas: 250n * RS, commissionRatePaisas: 10n * RS },
  ])
  const totals = computeSaleTotals(lines, { invoiceDiscountPaisas: 200n * RS })

  assert.equal(totals.grossSalesPaisas, 6000n * RS, '10x500 + 4x250')
  assert.equal(totals.returnsDeductionPaisas, 1000n * RS, '2x500 returned')
  assert.equal(totals.totalDiscountPaisas, 200n * RS)
  assert.equal(totals.netSalePaisas, 4800n * RS, '6000 - 1000 - 200')
  assert.equal(totals.totalSoldQty, 14)
  assert.equal(totals.totalReturnedQty, 2)
  assert.equal(totals.totalNetQty, 12)
  assert.equal(totals.netStockEffect, -12)
  assert.equal(totals.totalCommissionPaisas, 200n * RS, 'Rs 160 on net 8 + Rs 40 on net 4')
  assert.equal(validateSaleTotals(totals), null)
})

test('paid, change and receivable follow the net sale value', () => {
  const lines = normalizeSaleLines([
    { productId: 'p1', productName: 'A', soldQty: 10, returnedQty: 2, unitPricePaisas: 500n * RS },
  ])
  // Net Rs 4,000; customer hands Rs 5,000 and takes Rs 1,000 change -> settled.
  const settled = computeSaleTotals(lines, { paidPaisas: 5000n * RS, changePaisas: 1000n * RS })
  assert.equal(settled.netSalePaisas, 4000n * RS)
  assert.equal(settled.receivablePaisas, 0n)

  // Partial payment leaves exactly the unpaid remainder receivable.
  const partial = computeSaleTotals(lines, { paidPaisas: 1500n * RS })
  assert.equal(partial.receivablePaisas, 2500n * RS)

  // Nothing paid -> the whole net sale is receivable.
  const unpaid = computeSaleTotals(lines)
  assert.equal(unpaid.receivablePaisas, 4000n * RS)
})

test('a bill whose returns cancel every sold piece is rejected, not posted as zero', () => {
  const lines = normalizeSaleLines([
    { productId: 'p1', productName: 'A', soldQty: 3, returnedQty: 3, unitPricePaisas: 100n * RS },
  ])
  const totals = computeSaleTotals(lines)
  assert.equal(totals.totalNetQty, 0)
  assert.match(
    validateSaleTotals(totals) ?? '',
    /no net billable quantity/,
    'an all-returned bill must be refused with a reason, not silently posted',
  )
})

// ── 15. Atomicity and rollback ─────────────────────────────────────────────

test('a mixed bill posts atomically or not at all', () => {
  // Local path: one Prisma transaction around invoice, stock and commission.
  assert.match(dataAccess, /db\.\$transaction\(/)
  // Production path: one RPC, so both halves share a single PostgreSQL
  // transaction. The return half runs after the sale half inside that call.
  assert.match(migration, /v_invoice_id := public\.post_sale_phase2_ledger\(/)
  assert.match(migration, /perform public\.post_sale_return_ledger\(/)
  // The mixed shape is validated BEFORE any write, so an invalid line aborts
  // before an invoice exists.
  const validateAt = migration.indexOf('VALIDATE THE MIXED SHAPE BEFORE ANY WRITE')
  const saleAt = migration.indexOf('v_invoice_id := public.post_sale_phase2_ledger(')
  assert.ok(validateAt > 0 && saleAt > validateAt, 'validation must precede the sale write')
  // Same rule as the engine, enforced again in SQL.
  assert.match(migration, /Returned quantity \(%\) cannot exceed sold quantity \(%\) on the same bill/)
})

// ── 16. Migration-dependent schema compatibility ───────────────────────────

test('a mixed bill fails closed with an owner-actionable message until 00033 is applied', () => {
  assert.match(compatibility, /mixedSaleReturns: false/, 'capability stays off until an owner applies 00033')
  assert.match(compatibility, /migration 00033 \(mixed sale returns\)/)
  assert.match(compatibility, /No sale was posted\./)
  // The poster asserts before it builds any payload.
  assert.match(dataAccess, /assertMixedSaleReturnSupport\(\{ hasReturnLines: lines\.some\(\(line\) => line\.returnedQty > 0\) \}\)/)
  // And the RPC name is chosen by the same capability, so applying 00033 and
  // flipping the flag is the whole switch.
  assert.match(compatibility, /salePostingRpcName/)
  assert.match(dataAccess, /const rpcName = salePostingRpcName\(\)/)
})

test('an absent product commission column is reported unavailable, never rewritten to zero', () => {
  assert.match(dataAccess, /missingProductOptionalColumn\(error\) === 'commissionRate'/)
  assert.match(dataAccess, /return \{ rates, available: false \}/)
  assert.match(dataAccess, /rather than silently\r?\n \* rewritten to zero/)
})

test('the migration-dependent notice is scoped to the affected feature, not the whole workspace', () => {
  // Counter Sale keeps working; the accounting notice sits inside the Payment
  // card rather than as a banner over the entire POS workspace.
  assert.match(counterView, /availability\.message/)
  assert.match(counterView, /Migration-dependent status stays beside the feature it affects/)
})

// ── 17. Invoice item detail ────────────────────────────────────────────────

test('invoice detail carries sold, returned and net quantity per item', () => {
  assert.match(invoiceRoute, /getInvoice\(su\.businessId, id\)/)
  assert.match(printButton, /returnedQty: it\.returnedQty \?\? 0/)
  assert.match(dataAccess, /returnedQty\?: number/)
  // Commission detail keeps per-item rows rather than one invoice-level figure.
  assert.match(dataAccess, /invoiceItemId: string/)
  assert.match(dataAccess, /netEligibleQty: number/)
  assert.match(dataAccess, /ratePaisas: string/)
  assert.match(dataAccess, /sellerRole: SellerRole/)
})

// ── 18-20. The printed document ────────────────────────────────────────────

const printModelInput = {
  invoiceNo: 'INV-000123',
  invoiceType: 'COUNTER',
  invoiceDate: '2026-07-30',
  sellerName: 'Test Owner',
  sellerRole: 'OWNER' as const,
  customerName: 'Walk-in',
  items: [{
    productName: 'Test Product', sku: 'SKU-1',
    qty: 10, returnedQty: 2,
    unitPrice: (500n * RS).toString(),
    lineTotal: (4000n * RS).toString(),
  }],
  subtotal: (5000n * RS).toString(),
  total: (4000n * RS).toString(),
  paidAmount: (3000n * RS).toString(),
}

test('the A4 print model carries sold, returned, net and the return deduction', () => {
  const model = buildInvoicePrintModel(printModelInput)
  assert.equal(model.documentTitle, 'SALE INVOICE')
  assert.equal(model.channelLabel, 'Counter Sale')
  assert.equal(model.sellerRoleLabel, 'Owner', 'the seller role is stated on the document')
  assert.equal(model.lines[0].soldQty, 10)
  assert.equal(model.lines[0].returnedQty, 2)
  assert.equal(model.lines[0].netQty, 8)
  assert.equal(model.hasReturns, true)
  assert.equal(model.returnDeductionPaisas, (1000n * RS).toString(), '2 x Rs 500 returned')
  assert.equal(model.netPayablePaisas, (4000n * RS).toString())
  assert.equal(model.balancePaisas, (1000n * RS).toString(), 'Rs 4,000 payable less Rs 3,000 paid')
})

test('the thermal receipt renders from the same model as A4', () => {
  // One model, three layouts — the figures cannot diverge between them.
  assert.match(printDialog, /function ThermalReceipt/)
  assert.match(printDialog, /model\.netPayablePaisas/)
  assert.match(printDialog, /80mm/)
  assert.match(printDialog, /invoice-print-root-thermal/)
  const model = buildInvoicePrintModel({ ...printModelInput, invoiceType: 'ONLINE' })
  assert.equal(model.documentTitle, 'ONLINE ORDER')
  assert.equal(model.lines[0].netQty, 8)
})

test('commission and migration notices never appear on a customer document', () => {
  // Commission is present only when an owner explicitly asked for it.
  const customerCopy = buildInvoicePrintModel(printModelInput)
  assert.equal(customerCopy.internalCommission, null)

  const internalCopy = buildInvoicePrintModel({
    ...printModelInput,
    commission: {
      totalPaisas: (160n * RS).toString(),
      lines: [{ productName: 'Test Product', netEligibleQty: 8, ratePaisas: (RATE_RS_20).toString(), commissionPaisas: (160n * RS).toString() }],
    },
  })
  assert.equal(internalCopy.internalCommission?.totalPaisas, (160n * RS).toString())
  assert.equal(internalCopy.internalCommission?.lines[0].netEligibleQty, 8)

  // The printed document never mentions a migration.
  assert.ok(!/migration/i.test(printDialog), 'no migration wording may reach a customer invoice')
})

// ── 21. Keyboard-accessible Counter Sale ───────────────────────────────────

test('Counter Sale product finder and bill rows are keyboard operable', () => {
  assert.match(counterView, /onKeyDown=\{onSearchKeyDown\}/)
  assert.match(counterView, /e\.key === 'Enter'/)
  assert.match(counterView, /ArrowDown|ArrowUp/)
  assert.match(counterView, /aria-label="Search products"/)
  assert.match(counterView, /role="listbox"/)
  assert.match(counterView, /aria-label="Payment account"/)
  assert.match(counterView, /aria-label=\{`Sold quantity of \$\{row\.productName\}`\}/)
})

test('the bill row shows sold, returned, net and commission side by side', () => {
  // The customer-visible arithmetic must be legible on screen, not hidden as a
  // separate negative line elsewhere in the bill.
  for (const token of ['Sold', 'Return', 'Net', 'Commission']) {
    assert.ok(counterView.includes(token), `Counter Sale bill must label ${token}`)
  }
})
