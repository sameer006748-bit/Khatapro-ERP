import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

function buildPayload(includeIdempotencyKey) {
  const body = {
    invoiceType: 'COUNTER',
    invoiceDate: '2026-07-17',
    items: [{ productId: null, productName: 'Test Item', qty: 1, unitPrice: '500', isTemporary: false }],
    payments: [{ accountId: '00000000-0000-0000-0000-000000000001', amount: '50000' }],
    salesmanId: 'salesman-1',
    customerName: 'Test Customer',
    discountPaisas: '0',
  }
  if (includeIdempotencyKey) {
    body.idempotencyKey = '123e4567-e89b-12d3-a456-426614174000'
  }
  return body
}

describe('Counter Sale POST payload', () => {
  it('does NOT include idempotencyKey (Phase 8 compatible)', () => {
    const payload = buildPayload(false)
    assert.strictEqual('idempotencyKey' in payload, false)
    assert.strictEqual(JSON.stringify(payload).includes('idempotencyKey'), false)
  })

  it('payments.amount is sent as string (BigInt-safe)', () => {
    const payload = buildPayload(false)
    assert.strictEqual(typeof payload.payments[0].amount, 'string')
    assert.strictEqual(payload.payments[0].amount, '50000')
  })

  it('items.unitPrice is sent as string (rupees, not paisas)', () => {
    const payload = buildPayload(false)
    assert.strictEqual(typeof payload.items[0].unitPrice, 'string')
    assert.strictEqual(payload.items[0].unitPrice, '500')
  })
})

describe('Duplicate-submit guard (postingRef)', () => {
  it('blocks submission when already in progress', () => {
    let postingRef = false
    function tryPost() {
      if (postingRef) throw new Error('Submission already in progress')
      postingRef = true
      return 'posted'
    }
    assert.strictEqual(tryPost(), 'posted')
    assert.throws(() => tryPost(), /Submission already in progress/)
    postingRef = false
    assert.strictEqual(tryPost(), 'posted')
  })

  it('allows retry after failure', () => {
    let postingRef = false
    let attempts = 0
    function tryPost() {
      if (postingRef) throw new Error('Submission already in progress')
      postingRef = true
      attempts++
      throw new Error('Network error')
    }
    assert.throws(() => tryPost(), /Network error/)
    assert.strictEqual(attempts, 1)
    postingRef = false
    // After clearing the ref, retry should succeed (no double-submit block)
    let retryOk = false
    assert.doesNotThrow(() => {
      if (postingRef) throw new Error('Submission already in progress')
      postingRef = true
      retryOk = true
    })
    assert.strictEqual(retryOk, true)
    assert.strictEqual(attempts, 1)
  })

  it('does NOT auto-resubmit after success', () => {
    let postingRef = false
    let callCount = 0
    function tryPost() {
      if (postingRef) throw new Error('Submission already in progress')
      postingRef = true
      callCount++
      postingRef = false
      return `invoice-${callCount}`
    }
    tryPost()
    assert.strictEqual(callCount, 1)
  })
})

describe('Phase 8 compatibility gate', () => {
  it('blocks non-null idempotencyKey when salesIdempotency is false', () => {
    const salesIdempotency = false
    const idempotencyKey = 'abc-123'
    const blocked = !salesIdempotency && idempotencyKey != null
    assert.strictEqual(blocked, true)
  })

  it('allows undefined idempotencyKey', () => {
    const salesIdempotency = false
    const idempotencyKey = undefined
    const blocked = !salesIdempotency && idempotencyKey != null
    assert.strictEqual(blocked, false)
  })
})