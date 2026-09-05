import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const read = async (path: string) => (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')

const dataAccess = await read('src/lib/sales/data-access.ts')
const route = await read('src/app/api/sales/[id]/route.ts')
const view = await read('src/components/erp/views/invoice-detail-view.tsx')
const online = await read('src/components/erp/views/online-sale-view.tsx')
const counter = await read('src/components/erp/views/counter-sale-view.tsx')
const ofc = await read('src/components/erp/views/ofc-sale-view.tsx')
const salesList = await read('src/components/erp/views/sales-list-view.tsx')
const legacyReturns = await read('supabase/migrations/00037_legacy_historical_sales_returns.sql')

const supabaseBranch = /export async function getInvoice[\s\S]*?\n  \}\n  const inv = await db\.invoice\.findFirst/.exec(dataAccess)![0]
/** Comments explain which columns are optional, so assertions read code only. */
const codeOnly = (source: string) => source.replace(/^[ \t]*\/\/.*$/gm, '')

// ---------------------------------------------------------------------------
// "View Invoice" on a freshly posted sale reported "Invoice not found" for an
// invoice that had just been created. The identifier was never wrong: every
// caller passes the invoices.id the sale returned. GET /api/sales/[id] was
// failing inside getInvoice and the failure was arriving at the screen wearing
// a 404's clothing.
// ---------------------------------------------------------------------------

test('every entry point opens an invoice by the id the sale returned', () => {
  for (const [name, source] of [['online', online], ['counter', counter], ['ofc', ofc]] as const) {
    assert.match(source, /window\.open\(`\/\?invoice=\$\{result\.invoiceId\}`, '_self'\)/, `${name} sale must open the posted invoice id`)
  }
  assert.match(salesList, /\/\?invoice=\$\{r\.id\}/)
  assert.match(view, /fetch\(`\/api\/sales\/\$\{invoiceId\}`\)/)
  assert.match(route, /getInvoice\(su\.businessId, id\)/)
})

test('the invoice screen never guesses at another identifier', () => {
  assert.doesNotMatch(view, /invoice_no|invoiceNo\s*\?\?|fallback/i)
  assert.match(view, /queryKey: \['invoice', invoiceId\]/)
})

// ---------------------------------------------------------------------------
// Root cause. `settlement_status` and the whole `sales_return_lines` table only
// exist once migration 00037 is applied. getInvoice selected `settlement_status`
// unconditionally — on every invoice, returns or not — and threw when the column
// was missing, so a database without 00037 could not open any invoice at all.
// ---------------------------------------------------------------------------

test('00037 is the only source of the columns that were breaking the read', () => {
  assert.match(legacyReturns, /alter table public\.sales_returns add column if not exists settlement_status text;/)
  assert.match(legacyReturns, /create table if not exists public\.sales_return_lines/)
})

test('loading an invoice does not depend on migration 00037', () => {
  const critical = codeOnly(supabaseBranch.slice(0, supabaseBranch.indexOf('if (returnIds.length > 0)')))
  assert.doesNotMatch(critical, /settlement_status/)
  assert.doesNotMatch(critical, /sales_return_lines/)
  assert.match(critical, /\.from\('sales_returns'\)\s*\.select\('id, return_no, return_date, total, reason'\)/)
})

test('the 00037-only reads are optional enrichment that may come back empty', () => {
  const optional = codeOnly(supabaseBranch.slice(supabaseBranch.indexOf('if (returnIds.length > 0)')))
  assert.match(optional, /const \{ data: settlements, error: settlementError \} = await admin\.from\('sales_returns'\)/)
  assert.match(optional, /const \{ data: lines, error: lineError \} = await admin\.from\('sales_return_lines'\)/)
  // The errors are reported, never thrown: a database without 00037 still renders
  // the invoice, and only the printed return breakdown is marked unavailable.
  assert.doesNotMatch(optional, /if \((settlementError|lineError)\) throw/)
  assert.match(optional, /unavailable\.push\('returnDetail'\)/)
  assert.match(optional, /returnLines = lines \?\? \[\]/)
  assert.match(supabaseBranch, /settlementStatus: settlementByReturn\.get\(sr\.id\) \?\? 'POSTED'/)
})

// Returns net off what the customer still owes, so an unreadable returns table
// makes the outstanding balance unknowable. It is withheld rather than thrown
// (the invoice still opens) and rather than shown overstated.
test('return totals come from the base schema, and an unknown balance is withheld', () => {
  assert.match(supabaseBranch, /\.eq\('original_invoice_id', invoiceId\)/)
  assert.match(supabaseBranch, /logInvoiceSectionUnavailable\('returns', invoiceId, returnRead\.error\)/)
  assert.match(view, /const returnedTotal = \(inv\.returns \?\? \[\]\)\.reduce/)
  assert.match(view, /const outstandingKnown = !unavailableSections\.includes\('returns'\)/)
  assert.match(view, /outstandingKnown \? .*formatMoney\(outstanding\)/s)
  assert.match(view, /Unavailable/)
})

// ---------------------------------------------------------------------------
// The per-line query named the wrong table's column: `sales_return_lines`
// (00037) keys on `sales_return_id`, while `sale_return_lines` (00014) keys on
// `sale_return_id`. Any invoice that had a return would have failed too.
// ---------------------------------------------------------------------------

test('return lines are filtered by the column sales_return_lines actually has', () => {
  assert.match(legacyReturns, /sales_return_id text not null references public\.sales_returns\(id\)/)
  assert.match(supabaseBranch, /\.in\('sales_return_id', returnIds\)/)
  assert.doesNotMatch(supabaseBranch, /\.in\('sale_return_id'/)
  assert.match(supabaseBranch, /line\.sales_return_id === sr\.id/)
})

// ---------------------------------------------------------------------------
// A failed read and a missing invoice are different answers and must stay
// different all the way to the screen.
// ---------------------------------------------------------------------------

test('getInvoice separates "no such invoice" from "the read failed"', () => {
  assert.match(supabaseBranch, /\.maybeSingle\(\)/)
  assert.match(supabaseBranch, /if \(core\.error\) throw new Error\(`Supabase invoice: \$\{core\.error\.message\}`\)/)
  assert.match(supabaseBranch, /if \(!core\.row\) return null/)
  assert.doesNotMatch(supabaseBranch, /if \(error \|\| !inv\) return null/)
})

test('the invoice screen reads the HTTP status instead of assuming success', () => {
  assert.match(view, /const res = await fetch\(`\/api\/sales\/\$\{invoiceId\}`\)/)
  assert.match(view, /if \(!res\.ok\) throw new InvoiceLoadError\(res\.status/)
  assert.match(view, /class InvoiceLoadError extends Error/)
  assert.doesNotMatch(view, /fetch\(`\/api\/sales\/\$\{invoiceId\}`\)\.then\(r => r\.json\(\)\)/)
})

test('each failure reason gets its own message, and only 404 says not found', () => {
  assert.match(view, /failure\?\.status === 403 \|\| failure\?\.code === 'FORBIDDEN'/)
  assert.match(view, /failure\?\.status === 401 \|\| failure\?\.code === 'UNAUTHORIZED'/)
  assert.match(view, /failure\?\.status === 404\s*\n\s*\? 'Invoice not found\.'/)
  assert.match(view, /the server could not read it/)
  assert.match(view, /Reference: \{failure\.requestId\}/)
})

test('a server-side failure is not retried as if it were the user\'s mistake', () => {
  assert.match(view, /retry: \(failureCount, error\) =>/)
  assert.match(view, /error instanceof InvoiceLoadError && error\.status < 500/)
})

test('the route still answers 404 only when the invoice is genuinely absent', () => {
  assert.match(route, /if \(!invoice\) return NextResponse\.json\(\{ error: 'NOT_FOUND' \}, \{ status: 404 \}\)/)
  assert.match(route, /error: 'FORBIDDEN'/)
  assert.match(route, /error: 'UNAUTHORIZED'/)
})
