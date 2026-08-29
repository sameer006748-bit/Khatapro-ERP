import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  computeHistoricalReturnCommissionAdjustment,
  computeStockEffects,
  normalizeSaleLine,
  SaleLineError,
} from '../src/lib/sales/sale-engine.ts'

const RS = 100n
const originalItemId = '11111111-1111-1111-1111-111111111111'
const dataAccess = await readFile('src/lib/sales/data-access.ts', 'utf8')
const route = await readFile('src/app/api/sales/[id]/return/route.ts', 'utf8')
const migration = await readFile('supabase/migrations/00037_legacy_historical_sales_returns.sql', 'utf8')
const detailView = await readFile('src/components/erp/views/invoice-detail-view.tsx', 'utf8')
const salesList = await readFile('src/components/erp/views/sales-list-view.tsx', 'utf8')

test('sold 10 then historical return 2 posts sold 0, returned 2, and leaves 8 returnable', () => {
  const line = normalizeSaleLine({
    productId: 'p1', productName: 'Product A', soldQty: 0, returnedQty: 2,
    unitPricePaisas: 500n * RS, originalInvoiceItemId: originalItemId,
    remainingReturnableQty: 10,
  })
  assert.equal(line.kind, 'HISTORICAL_RETURN')
  assert.equal(line.soldQty, 0)
  assert.equal(line.returnedQty, 2)
  assert.equal(10 - line.returnedQty, 8)
  assert.equal(line.originalInvoiceItemId, originalItemId)
})

test('a second historical return cannot exceed the remaining quantity', () => {
  assert.throws(() => normalizeSaleLine({
    productId: 'p1', productName: 'Product A', soldQty: 0, returnedQty: 9,
    unitPricePaisas: 500n * RS, originalInvoiceItemId: originalItemId,
    remainingReturnableQty: 8,
  }), (error: unknown) => error instanceof SaleLineError && /exceeds the remaining/.test(error.message))
})

test('historical return restores exactly the returned stock quantity', () => {
  const line = normalizeSaleLine({
    productId: 'p1', productName: 'Product A', soldQty: 0, returnedQty: 2,
    unitPricePaisas: 500n * RS, originalInvoiceItemId: originalItemId,
    remainingReturnableQty: 10,
  })
  assert.deepEqual(computeStockEffects([line]), [{
    productId: 'p1', productName: 'Product A', soldQty: 0, returnedQty: 2, netChange: 2,
  }])
})

test('zero, negative, and unreferenced pure return quantities are rejected', () => {
  for (const returnedQty of [0, -1]) {
    assert.throws(() => normalizeSaleLine({
      productId: 'p1', productName: 'Product A', soldQty: 0, returnedQty,
      unitPricePaisas: 500n * RS, originalInvoiceItemId: originalItemId,
      remainingReturnableQty: 10,
    }), SaleLineError)
  }
  assert.throws(() => normalizeSaleLine({
    productId: 'p1', productName: 'Product A', soldQty: 0, returnedQty: 2,
    unitPricePaisas: 500n * RS,
  }), SaleLineError)
  assert.match(route, /qty: z\.number\(\)\.int\(\)\.positive\(\)/)
})

test('mixed same-bill return remains valid', () => {
  const line = normalizeSaleLine({
    productId: 'p1', productName: 'Product A', soldQty: 10, returnedQty: 2,
    unitPricePaisas: 500n * RS, commissionRatePaisas: 20n * RS,
  })
  assert.equal(line.kind, 'SALE')
  assert.equal(line.netQty, 8)
  assert.equal(line.stockEffect, -8)
  assert.equal(line.commissionAmountPaisas, 160n * RS)
})

test('commission adjustment reverses eligible units but never more than earned', () => {
  assert.deepEqual(computeHistoricalReturnCommissionAdjustment({
    ratePaisas: 20n * RS, returnedQty: 2, earnedRemainingPaisas: 160n * RS,
  }), { eligibleReversalPaisas: 40n * RS, payableReversalPaisas: 40n * RS })
  assert.deepEqual(computeHistoricalReturnCommissionAdjustment({
    ratePaisas: 20n * RS, returnedQty: 2, earnedRemainingPaisas: 15n * RS,
  }), { eligibleReversalPaisas: 40n * RS, payableReversalPaisas: 15n * RS })
  assert.match(dataAccess, /eventType: \{ in: \['collection', 'reversal'\] \}/)
  assert.match(dataAccess, /eventType: 'reversal'/)
})

test('local return posting is atomic, linked, idempotent, and uses SRT identity', () => {
  const functionStart = dataAccess.indexOf('async function postLinkedSaleReturnViaPrisma')
  const functionBody = dataAccess.slice(functionStart, dataAccess.indexOf('export async function receiveInvoicePayment', functionStart))
  assert.match(functionBody, /db\.\$transaction/)
  assert.match(functionBody, /businessId_idempotencyKey/)
  assert.match(functionBody, /originalInvoiceId: invoice\.id/)
  assert.match(functionBody, /originalInvoiceItemId: source\.id/)
  assert.match(functionBody, /returnedQty: \{ increment: requested\.qty \}/)
  assert.match(functionBody, /currentStock: \{ increment: requested\.qty \}/)
  assert.match(functionBody, /allocateDocumentNumber\(tx, input\.businessId, 'SRT'\)/)
  assert.match(functionBody, /commissionAmount: -reversal/)
})

test('legacy RPC validates same business and remaining quantity before writes', () => {
  const validateAt = migration.indexOf('-- Validate and lock every original line before the first business write.')
  const insertAt = migration.indexOf('insert into public.sales_returns')
  assert.ok(validateAt > 0 && insertAt > validateAt)
  assert.match(migration, /ii\.invoice_id = p_invoice_id[\s\S]{0,100}ii\.business_id = p_business_id/)
  assert.match(migration, /for update/)
  assert.match(migration, /v_requested > v_line\.qty - v_line\.returned_qty/)
  assert.match(migration, /claim_legacy_transaction_request[\s\S]{0,180}'historical_sales_return'/)
  assert.match(migration, /return_no into v_return_id, v_return_no/)
})

test('legacy return restores stock and keeps original sold quantity immutable', () => {
  assert.match(migration, /create_stock_movement\([\s\S]{0,180}'adjustment_in', v_requested/)
  assert.match(migration, /set returned_qty = returned_qty \+ v_requested/)
  assert.doesNotMatch(migration, /set\s+qty\s*=/i)
  assert.match(migration, /sales_return_lines[\s\S]{0,200}original_invoice_item_id/)
})

test('refund settlement uses a business account or records explicit customer credit', () => {
  assert.match(migration, /is_business_account = true/)
  assert.match(migration, /v_status := 'CREDIT_DUE'/)
  assert.match(migration, /v_status := 'REFUNDED'/)
  assert.match(detailView, /Customer credit \(refund remains due\)/)
  assert.match(detailView, /Select active business account/)
  assert.match(detailView, /Customer credit due/)
})

test('one shared invoice-driven UI covers Counter, Online, OFC, and Other', () => {
  assert.match(salesList, /Historical Return/)
  for (const channel of ['COUNTER', 'ONLINE', 'OFC', 'OTHER']) assert.ok(salesList.includes(channel))
  assert.match(salesList, /return=1/)
  for (const label of ['Original invoice:', 'Original sold', 'previously returned', 'returnable', 'Return qty']) {
    assert.ok(detailView.includes(label), `return UI must show ${label}`)
  }
})
