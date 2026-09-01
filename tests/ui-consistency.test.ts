import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { userFacingError } from '../src/lib/user-facing-error.ts'

const salesList = await readFile('src/components/erp/views/sales-list-view.tsx', 'utf8')
const onlineSale = await readFile('src/components/erp/views/online-sale-view.tsx', 'utf8')
const ofcSale = await readFile('src/components/erp/views/ofc-sale-view.tsx', 'utf8')
const accounts = await readFile('src/components/erp/views/accounts-view.tsx', 'utf8')

test('technical API codes are replaced with a clear client-facing fallback', () => {
  assert.equal(userFacingError(new Error('POST_FAILED'), 'Please try again.'), 'Please try again.')
  assert.equal(userFacingError('FETCH_FAILED', 'Please try again.'), 'Please try again.')
  assert.equal(userFacingError(new Error('Payment account is inactive.'), 'Please try again.'), 'Payment account is inactive.')
})

test('primary sales pages keep one clear primary path and visible required customer labels', () => {
  assert.match(salesList, />\s*Counter Sale/)
  assert.doesNotMatch(salesList, /> New Sale</)
  for (const page of [onlineSale, ofcSale]) {
    assert.match(page, /Customer name \*/)
    assert.match(page, /Phone \*/)
    assert.match(page, /Address \*/)
    assert.match(page, /userFacingError/)
  }
})

test('money page uses the shared client-facing page frame', () => {
  assert.match(accounts, /<PageHeader/)
  assert.match(accounts, /title="Accounts & Balances"/)
})
