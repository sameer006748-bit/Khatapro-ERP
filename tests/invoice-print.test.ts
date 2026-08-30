import { strict as assert } from 'node:assert'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { promisify } from 'node:util'

const dialog = await readFile('src/components/invoice/invoice-print-dialog.tsx', 'utf8')
const button = await readFile('src/components/invoice/print-invoice-button.tsx', 'utf8')
const salesList = await readFile('src/components/erp/views/sales-list-view.tsx', 'utf8')
const saleEngine = await readFile('src/lib/sales/sale-engine.ts', 'utf8')
const invoiceDetail = await readFile('src/components/erp/views/invoice-detail-view.tsx', 'utf8')
const purchasesView = await readFile('src/components/erp/views/purchases-view.tsx', 'utf8')
const execFileAsync = promisify(execFile)

test('shared template supports Counter, Online, and OFC document titles', () => {
  assert.ok(dialog.includes("invoiceType: 'COUNTER' | 'ONLINE' | 'OFC'"))
  // The channel title now lives in the shared sale engine so Counter, Online,
  // OFC and Other all print through one implementation instead of a copy per
  // channel; the dialog only renders what the engine resolved.
  assert.ok(saleEngine.includes("case 'ONLINE': return 'ONLINE ORDER'"))
  assert.ok(saleEngine.includes("case 'OFC': return 'OFC INVOICE'"))
  assert.ok(saleEngine.includes("return 'SALE INVOICE'"))
  assert.ok(saleEngine.includes('documentTitle: invoiceDocumentTitle(input.invoiceType)'))
  assert.ok(dialog.includes('{model.documentTitle}'))
})

test('half-A4 mode occupies one bounded half of an A4 portrait page', () => {
  assert.ok(dialog.includes("'single': 'Print Half A4'"))
  assert.ok(dialog.includes("@page { size: A4 portrait; margin: 0; }"))
  assert.ok(dialog.includes('height: 148.5mm'))
  assert.ok(dialog.includes('a4-half-top'))
  assert.ok(dialog.includes('a4-half-bottom a4-half-blank'))
})

test('two-up mode prints two half-A4 copies and still supports two-document batches', () => {
  assert.ok(dialog.includes("const twoUpInvalid = mode === 'two-up' && invoices.length === 0"))
  assert.ok(dialog.includes('twoUpInvalid'))
  // A single detail document produces two physical copies. A batch that sends
  // two documents keeps the genuinely second document in the lower half.
  assert.ok(dialog.includes('models[1] ?? models[0]'))
  assert.ok(salesList.includes('label="Print Two Invoices on A4"'))
  assert.ok(salesList.includes('disabled={selected.length !== 2}'))
})

test('sales, returns, purchases, and purchase returns use the shared print renderer', () => {
  for (const token of ["documentKind: 'sales-return'", "documentTitle: 'SALES RETURN'", '<InvoicePrintDialog']) {
    assert.ok(invoiceDetail.includes(token), `invoice detail missing ${token}`)
  }
  for (const token of ["documentKind: 'purchase'", "documentKind: 'purchase-return'", "documentTitle: 'PURCHASE BILL'", "documentTitle: 'PURCHASE RETURN'", '<InvoicePrintDialog']) {
    assert.ok(purchasesView.includes(token), `purchase view missing ${token}`)
  }
  assert.ok(!invoiceDetail.includes('className="print-invoice"'))
  assert.ok(!purchasesView.includes('className="print-purchase"'))
})

test('customer-facing payment summaries do not expose account codes', () => {
  assert.ok(!dialog.includes('[{p.accountCode}]'))
  assert.ok(dialog.includes("{p.accountName}{p.isChange && ' (Change)'}"))
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
  // 'Net Payable' replaced 'Grand Total' in the redesigned document: a mixed
  // bill's payable is gross sales minus the return deduction and discount, so
  // the label now states what the figure actually is.
  for (const token of ['Net Payable', 'inv-totals-outstanding', 'businessContact?.email', 'inv.customerAddress', 'inv.isReturned', 'inv.isCancelled', 'inv-status-paid']) {
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

test('invoice-print components remain isolated from accounting, permissions, and migrations', async () => {
  const { stdout } = await execFileAsync('git', ['diff', '--name-only'])
  const changed = stdout.split('\n').filter(Boolean)
  assert.ok(!changed.some((path) => path.startsWith('supabase/migrations/')), 'no migrations may change')
  for (const component of [dialog, button]) {
    assert.doesNotMatch(component, /lib\/accounting|auth\/permissions/)
  }
})
