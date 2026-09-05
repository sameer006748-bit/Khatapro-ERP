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

// The release ships exactly four choices. A shop prints on whatever paper is in
// the drawer that morning, so each one has to be selectable and has to carry its
// own physical page size into the print dialog.
test('all four release print formats are offered and each sizes its own page', () => {
  assert.ok(dialog.includes("const PRINT_MODE_OPTIONS: InvoicePrintMode[] = ['single', 'two-up', 'full-a4', 'thermal']"))
  for (const label of ['Print Half A4', 'Print Two Copies on A4', 'Print Full A4', 'Print 80mm Receipt']) {
    assert.ok(dialog.includes(`'${label}'`), `missing action label ${label}`)
  }
  // Thermal is a continuous roll, the sheet modes are A4 portrait; the @page
  // rule is injected per print rather than left on the document.
  assert.ok(dialog.includes("? '@page { size: 80mm auto; margin: 0; }'"))
  assert.ok(dialog.includes(": '@page { size: A4 portrait; margin: 0; }'"))
  assert.ok(dialog.includes('invoice-print-root-thermal { width: 80mm; }'))
  assert.ok(dialog.includes('.thermal-receipt { width: 80mm;'))
  assert.ok(dialog.includes('.a4-page.a4-single'))
  // Every format renders from the one engine serialization, so a figure cannot
  // differ between the half sheet, the full sheet and the roll.
  assert.ok(dialog.includes('buildInvoicePrintModel({'))
  assert.equal(
    dialog.match(/buildInvoicePrintModel\(/g)?.length,
    1,
    'one serialization call feeds every format',
  )
  assert.ok(dialog.includes('<InvoiceDocument model={models[0]} variant="full"'))
  assert.ok(dialog.includes('<InvoiceDocument model={models[0]} variant="half"'))
  assert.ok(dialog.includes('<ThermalReceipt model={models[0]}'))
})

// A customer copy is the one document that leaves the building. Commission is
// the business's own margin: it may appear only on a copy the operator asked
// for deliberately, and the choice must not survive to the next print.
test('a customer copy never carries commission on any format', () => {
  assert.ok(dialog.includes('const [internalCopy, setInternalCopy] = useState(false)'))
  assert.ok(dialog.includes("localStorage.setItem(STORAGE_KEY, mode)"))
  assert.ok(!dialog.includes('setItem(STORAGE_KEY, internalCopy'))
  assert.ok(dialog.includes('toModel(inv, internalCopy && commissionAvailable)'))
  assert.ok(dialog.includes('commission: includeCommission ? inv.commission ?? null : null'))
  // Both the sheet document and the roll gate the block on the same field.
  assert.ok(dialog.includes('{model.internalCommission && <InternalCommissionBlock'))
  assert.ok(dialog.includes('{model.internalCommission && ('))
  assert.ok(dialog.includes('Never give a copy printed with this option to a customer.'))
  // The rate itself is only fetched when the caller opted in, and only the
  // invoice screen offers that; the server still decides who may read it.
  assert.ok(button.includes('commission: allowInternalCopy ? await loadCommission(id) : null'))
  assert.ok(button.includes("fetch(`/api/sales/${id}/commission`)"))
  assert.ok(invoiceDetail.includes('allowInternalCopy'))
  assert.ok(salesList.includes('<PrintInvoiceButton'))
  assert.ok(!salesList.includes('allowInternalCopy'))
})
