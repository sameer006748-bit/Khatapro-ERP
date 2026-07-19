import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  CURRENT_DATABASE_CAPABILITIES,
  CURRENT_DATABASE_PHASE,
  PHASE_8_POST_RECEIPT_VOUCHER_ARGUMENT_NAMES,
  PHASE_8_POST_SALE_ARGUMENT_NAMES,
  buildPhase8PostReceiptVoucherPayload,
  buildPhase9PostSalePayload,
} from '../src/lib/supabase/rpc-compatibility'

const saleInput = {
  p_business_id: 'business-1',
  p_invoice_type: 'COUNTER' as const,
  p_invoice_date: '2026-07-13',
  p_items: [{
    product_id: 'product-1',
    product_name: 'Product',
    qty: 2,
    unit_price: '12500',
    is_temporary: false,
  }],
  p_payments: [{
    account_id: 'account-1',
    amount: '25000',
    is_change: false,
  }],
  p_salesman_id: 'salesman-1',
  p_customer_id: null,
  p_customer_name: null,
  p_customer_phone: null,
  p_customer_address: null,
  p_customer_city: null,
  p_memo: null,
  p_created_by: null,
  p_discount_paisas: '0',
}

const receiptInput = {
  p_business_id: 'business-1',
  p_receipt_date: '2026-07-13',
  p_received_into_account_id: 'cash-account',
  p_credit_account_id: 'receivable-account',
  p_amount_paisas: '25000',
  p_customer_id: null,
  p_reference: null,
  p_notes: null,
  p_created_by: null,
}

test('compatibility boundary is fixed to Phase 8 with Phase 9 features disabled', () => {
  assert.equal(CURRENT_DATABASE_PHASE, 8)
  assert.deepEqual(CURRENT_DATABASE_CAPABILITIES, {
    salesDiscounts: false,
    salesIdempotency: false,
    receiptAllocations: false,
    receiptIdempotency: false,
  })
})

test('Phase 8 post_sale payload has exactly the 13 Phase-8 argument names', () => {
  assert.equal(CURRENT_DATABASE_PHASE, 8)
  const payload = buildPhase9PostSalePayload({ ...saleInput, discountPaisas: 0n })
  assert.deepEqual(Object.keys(payload), [...PHASE_8_POST_SALE_ARGUMENT_NAMES])
  assert.equal('p_discount_paisas' in payload, false)
  assert.equal('p_idempotency_key' in payload, false)
})

test('Phase 8 post_sale omits discount/idempotency without sending null or zero', () => {
  const payload = buildPhase9PostSalePayload({ ...saleInput, discountPaisas: 0n, idempotencyKey: null })
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'p_discount_paisas'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'p_idempotency_key'), false)
})

test('post_sale accepts a zero/default discount', () => {
  assert.doesNotThrow(() => buildPhase9PostSalePayload({ ...saleInput, discountPaisas: 0n }))
  assert.doesNotThrow(() => buildPhase9PostSalePayload({ ...saleInput, discountPaisas: undefined }))
})

test('post_sale rejects a nonzero discount before payload construction', () => {
  assert.throws(
    () => buildPhase9PostSalePayload({ ...saleInput, discountPaisas: 1n }),
    /Sales discounts are unavailable/,
  )
})

test('post_sale rejects a Phase 9 retry key', () => {
  assert.throws(
    () => buildPhase9PostSalePayload({ ...saleInput, idempotencyKey: 'stale-key' }),
    /Sale retry keys are unavailable/,
  )
})

test('post_receipt_voucher payload has exactly the Phase 8 argument names', () => {
  const payload = buildPhase8PostReceiptVoucherPayload(receiptInput)
  assert.deepEqual(Object.keys(payload), [...PHASE_8_POST_RECEIPT_VOUCHER_ARGUMENT_NAMES])
  assert.equal('p_allocations' in payload, false)
  assert.equal('p_idempotency_key' in payload, false)
})

test('post_receipt_voucher rejects unsupported allocation input', () => {
  assert.throws(
    () => buildPhase8PostReceiptVoucherPayload({
      ...receiptInput,
      allocations: [{ invoiceId: 'invoice-1', allocatedAmount: 25000n }],
    }),
    /Invoice allocation is unavailable/,
  )
})

test('post_receipt_voucher rejects a Phase 9 retry key', () => {
  assert.throws(
    () => buildPhase8PostReceiptVoucherPayload({ ...receiptInput, idempotencyKey: 'stale-key' }),
    /Receipt retry keys are unavailable/,
  )
})

test('payload typing is not bypassed with as any', async () => {
  const source = await readFile(
    new URL('../src/lib/supabase/rpc-compatibility.ts', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(source, /\bas\s+any\b/)
})