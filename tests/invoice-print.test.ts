import { strict as assert } from 'node:assert'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { promisify } from 'node:util'

const dialog = await readFile('src/components/invoice/invoice-print-dialog.tsx', 'utf8')
const button = await readFile('src/components/invoice/print-invoice-button.tsx', 'utf8')
const salesList = await readFile('src/components/erp/views/sales-list-view.tsx', 'utf8')
const execFileAsync = promisify(execFile)

test('shared template supports Counter, Online, and OFC document titles', () => {
  assert.ok(dialog.includes("invoiceType: 'COUNTER' | 'ONLINE' | 'OFC'"))
  assert.ok(dialog.includes("return 'ONLINE ORDER'"))
  assert.ok(dialog.includes("return 'OFC INVOICE'"))
  assert.ok(dialog.includes("return 'SALE INVOICE'"))
})

test('half-A4 mode occupies one bounded half of an A4 portrait page', () => {
  assert.ok(dialog.includes("'single': 'Print Half A4'"))
  assert.ok(dialog.includes("@page { size: A4 portrait; margin: 0; }"))
  assert.ok(dialog.includes('height: 148.5mm'))
  assert.ok(dialog.includes('a4-half-top'))
  assert.ok(dialog.includes('a4-half-bottom a4-half-blank'))
})

test('two-up mode requires exactly two independent invoices', () => {
  assert.ok(dialog.includes("const twoUpInvalid = mode === 'two-up' && invoices.length !== 2"))
  assert.ok(dialog.includes('twoUpInvalid'))
  assert.ok(dialog.includes('showBottom && invoices[1]'))
  assert.ok(!dialog.includes('invoices[1] || invoices[0]'))
  assert.ok(salesList.includes('label="Print Two Invoices on A4"'))
  assert.ok(salesList.includes('disabled={selected.length !== 2}'))
})

test('print CSS keeps top and bottom halves separate with a cut line', () => {
  for (const token of ['.a4-page', '.a4-half', 'height: 148.5mm', "content: 'CUT HERE'", 'break-inside: avoid', 'page-break-inside: avoid']) {
    assert.ok(dialog.includes(token), `missing ${token}`)
  }
})

test('print isolation hides application navigation and actions', () => {
  assert.ok(dialog.includes('body.printing-invoice #__next > * { visibility: hidden !important; }'))
  assert.ok(dialog.includes('.invoice-print-root * { visibility: visible !important; }'))
  assert.ok(dialog.includes('className="no-print'))
})

test('totals, optional customer fields, payment status, and return status remain conditional', () => {
  for (const token of ['Grand Total', 'Outstanding', 'businessContact?.email', 'inv.customerAddress', 'inv.isReturned', 'inv.isCancelled', 'inv-status-paid']) {
    assert.ok(dialog.includes(token), `missing ${token}`)
  }
})

test('long invoices warn and block half-A4 printing after rendered measurement', () => {
  assert.ok(dialog.includes('HALF_A4_PRINTABLE_PX'))
  assert.ok(dialog.includes('overflowDetected'))
  assert.ok(dialog.includes('Half-A4 printing is blocked to prevent clipping'))
  assert.ok(dialog.includes("setMode('full-a4')"))
})

test('the mobile preview and print trigger remain usable', () => {
  assert.ok(dialog.includes('max-h-[90vh]'))
  assert.ok(dialog.includes('overflow-y-auto'))
  assert.ok(button.includes('disabled?: boolean'))
  assert.ok(button.includes('disabled={disabled || loading || ids.length === 0}'))
})

test('invoice-print work does not change accounting, permissions, or migrations', async () => {
  const { stdout } = await execFileAsync('git', ['diff', '--name-only'])
  const changed = stdout.split('\n').filter(Boolean)
  assert.ok(!changed.some((path) => path.startsWith('supabase/migrations/')), 'no migrations may change')
  assert.ok(!changed.some((path) => path.includes('accounting/') || path.includes('permissions.ts') || path.includes('api/sales/')), 'no accounting, permissions, or sale APIs may change')
})
