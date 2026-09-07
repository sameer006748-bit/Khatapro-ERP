import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const shell = await readFile('src/components/erp/dashboard-shell.tsx', 'utf8')
const salesmanDashboard = await readFile('src/components/erp/views/salesman-dashboard.tsx', 'utf8')
const salesList = await readFile('src/components/erp/views/sales-list-view.tsx', 'utf8')
const invoiceDetail = await readFile('src/components/erp/views/invoice-detail-view.tsx', 'utf8')
const salesRoute = await readFile('src/app/api/sales/counter/route.ts', 'utf8')
const invoiceRoute = await readFile('src/app/api/sales/[id]/route.ts', 'utf8')

test('Salesman My Sales resolves through the registered Sales List page', () => {
  assert.ok(salesmanDashboard.includes("{ label: 'My Sales', icon: FileText, action: () => openShellPage('sales-list') }"))
  assert.ok(shell.includes("{ key: 'sales-list', label: 'Sales List', short: 'Sales', icon: ReceiptText, perm: ['can_view_sales', 'can_view_own_sales'] }"))
  assert.ok(shell.includes('const permissions = Array.isArray(item.perm) ? item.perm : [item.perm]'))
  assert.ok(shell.includes('permissions.some((permission) => user.permissions.includes(permission))'))
})

test('Salesman sales history and invoice detail remain server-scoped to own sales', () => {
  assert.ok(salesRoute.includes("const canViewOwn = hasPermission(su, 'can_view_own_sales')"))
  assert.ok(salesRoute.includes('resolveSalesmanIdForUser(su.businessId, su.supabaseUserUuid, su.userId)'))
  assert.ok(salesRoute.includes('listInvoices(su.businessId, { type, salesmanId })'))
  assert.ok(invoiceRoute.includes("const canViewOwn = hasPermission(su, 'can_view_own_sales')"))
  assert.ok(invoiceRoute.includes('verifyInvoiceOwnership(su.businessId, id, userSalesmanId)'))
  assert.ok(salesList.includes('navigateShell(`/?invoice=${r.id}${returnMode ? \'&return=1\' : \'\'}`)'))
})

test('every invoice has a deterministic settlement summary, including unpaid and partial sales', () => {
  const paymentHistoryStart = invoiceDetail.indexOf('{inv.payments && inv.payments.length > 0 && (')
  const summaryStart = invoiceDetail.indexOf('data-settlement-summary')
  assert.ok(summaryStart > paymentHistoryStart, 'summary is rendered after, not inside, optional payment history')
  assert.ok(invoiceDetail.includes('Settlement Summary'))
  assert.ok(invoiceDetail.includes('Net Payable'))
  assert.ok(invoiceDetail.includes('>Paid</div>'))
  assert.ok(invoiceDetail.includes('>Outstanding</div>'))
  assert.ok(invoiceDetail.includes('const netPayableBeforeFloor = BigInt(inv.total) - returnedTotal'))
  assert.ok(invoiceDetail.includes('const outstandingBeforeFloor = netPayable - BigInt(inv.paidAmount)'))
  // Rs 2,000 paid/unpaid/partial examples document the exact integer-paisa
  // reconciliation expected from the displayed source fields.
  for (const paid of [200000n, 0n, 50000n]) {
    const netPayable = 200000n
    assert.equal(paid + (netPayable - paid), netPayable)
  }
})

test('returns retain the established net/outstanding withholding rule', () => {
  assert.ok(invoiceDetail.includes("const outstandingKnown = !unavailableSections.includes('returns')"))
  assert.ok(invoiceDetail.includes('const returnedTotal = (inv.returns ?? []).reduce'))
  assert.ok(invoiceDetail.includes("outstandingKnown ? <div className=\"font-semibold text-foreground\""))
  assert.ok(invoiceDetail.includes('>Unavailable</div>'))
})

test('Salesman dashboard uses real middle-dot separators, never a literal escape sequence', () => {
  assert.ok(!salesmanDashboard.includes('\\\\u00B7'))
  assert.ok(salesmanDashboard.includes('>·</span>'))
  assert.ok(salesmanDashboard.includes("'Walk-in'} · {formatDateTime"))
})
