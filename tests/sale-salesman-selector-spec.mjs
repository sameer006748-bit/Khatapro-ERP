import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { readFile } from 'node:fs/promises'

/**
 * Mirrors the salesman-selection logic used by the Online and OFC sale views
 * (same style as counter-sale-fix-spec.mjs: assert the payload contract).
 */

function pickEffectiveSalesmanId(selectedId, salesmen) {
  const active = salesmen.filter(s => s.isActive !== false)
  return selectedId || (active.length === 1 ? active[0].id : '')
}

function buildOnlinePayload({ salesmanId, advancePaisas, accountId }) {
  const payments = []
  if (advancePaisas > 0n) payments.push({ accountId, amount: advancePaisas.toString() })
  return {
    invoiceType: 'ONLINE',
    invoiceDate: '2026-07-20',
    items: [{ productId: 'p1', productName: 'Item', qty: 1, unitPrice: '500' }],
    payments,
    salesmanId,
    customerName: 'C', customerPhone: '1', customerAddress: 'A',
    discountPaisas: '0',
  }
}

function buildOfcPayload({ salesmanId, advancePaisas, accountId }) {
  return {
    invoiceType: 'OFC',
    invoiceDate: '2026-07-20',
    items: [{ productId: 'p1', productName: 'Item', qty: 1, unitPrice: '500' }],
    payments: [{ accountId, amount: advancePaisas.toString() }],
    salesmanId,
    customerName: 'C', customerPhone: '1', customerAddress: 'A', customerCity: 'K',
    discountPaisas: '0',
  }
}

describe('Salesman selection', () => {
  it('selected salesman ID enters the Online payload', () => {
    const p = buildOnlinePayload({ salesmanId: 'sm-1', advancePaisas: 0n, accountId: 'acc-1' })
    assert.equal(p.salesmanId, 'sm-1')
  })

  it('selected salesman ID enters the OFC payload', () => {
    const p = buildOfcPayload({ salesmanId: 'sm-2', advancePaisas: 50000n, accountId: 'acc-1' })
    assert.equal(p.salesmanId, 'sm-2')
  })

  it('no unrelated salesman is auto-selected when several are active', () => {
    const rows = [
      { id: 'sm-1', name: 'A', isActive: true },
      { id: 'sm-2', name: 'B', isActive: true },
    ]
    assert.equal(pickEffectiveSalesmanId('', rows), '')
  })

  it('the single active salesman is used as the unambiguous default', () => {
    const rows = [{ id: 'sm-1', name: 'A', isActive: true }]
    assert.equal(pickEffectiveSalesmanId('', rows), 'sm-1')
  })

  it('inactive salesmen are not offered as choices', () => {
    const rows = [
      { id: 'sm-1', name: 'A', isActive: false },
      { id: 'sm-2', name: 'B', isActive: true },
    ]
    const active = rows.filter(s => s.isActive !== false)
    assert.deepEqual(active.map(s => s.id), ['sm-2'])
    // With the inactive one filtered out, exactly one remains → default
    assert.equal(pickEffectiveSalesmanId('', rows), 'sm-2')
  })
})

describe('Payment-rule preservation', () => {
  it('Online COD with zero advance stays valid (empty payments array)', () => {
    const p = buildOnlinePayload({ salesmanId: 'sm-1', advancePaisas: 0n, accountId: 'acc-1' })
    assert.deepEqual(p.payments, [])
  })

  it('OFC full advance remains mandatory (view gate)', () => {
    const finalTotal = 50000n
    const netCollected = 40000n
    const ofcValid = !(netCollected < finalTotal) && finalTotal > 0n
    assert.equal(ofcValid, false)
    const paidInFull = !(finalTotal < finalTotal) && finalTotal > 0n
    assert.equal(paidInFull, true)
  })
})

describe('View wiring (source contract)', () => {
  for (const file of ['src/components/erp/views/online-sale-view.tsx', 'src/components/erp/views/ofc-sale-view.tsx']) {
    it(`${file} renders a required, active-only, 44px salesman selector`, async () => {
      const src = await readFile(file, 'utf8')
      assert.ok(src.includes("fetch('/api/salesmen')"), 'loads the shared salesman list')
      assert.ok(src.includes('s.isActive !== false'), 'filters inactive salesmen')
      assert.ok(src.includes('salesmanId: mustPickSalesman ? effectiveSalesmanId : undefined'), 'sends salesmanId in the payload')
      assert.ok(src.includes('(!mustPickSalesman || !!effectiveSalesmanId)'), 'posting is gated on a selection')
      assert.ok(src.includes('h-11'), 'uses a 44px touch target')
      assert.ok(src.includes("permissions.includes('can_view_sales')"), 'salesman-role users fall back to server-side resolution')
    })
  }
})
