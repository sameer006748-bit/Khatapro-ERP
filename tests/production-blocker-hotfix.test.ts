import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  INVOICE_CORE_COLUMNS,
  INVOICE_DETAIL_COLUMNS,
  INVOICE_DETAIL_SECTIONS,
  isSchemaShapeError,
} from '../src/lib/sales/invoice-detail-compatibility.ts'

/**
 * Regressions for the three failures found in production UAT:
 *   1. a Salesman's "Assign Rider" dropdown was always empty,
 *   2. a freshly posted invoice could not be opened,
 *   3. the AI connection test reported a failure for a working key.
 *
 * Nothing here is an idealized schema: the invoice assertions are written against
 * the legacy production shape, where `invoices` has a COMPOSITE primary key and
 * therefore cannot carry the single-column foreign key PostgREST would need to
 * embed line items.
 */

const read = async (path: string) => (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')

const ridersRoute = await read('src/app/api/riders/route.ts')
const assignRoute = await read('src/app/api/delivery-orders/[id]/assign/route.ts')
const deliveryAccess = await read('src/lib/delivery/data-access.ts')
const onlineSale = await read('src/components/erp/views/online-sale-view.tsx')
const salesAccess = await read('src/lib/sales/data-access.ts')
const ownerSummary = await read('src/lib/dashboard/owner-summary.ts')
const invoiceView = await read('src/components/erp/views/invoice-detail-view.tsx')
const foundation = await read('supabase/migrations/00014_phase1_foundation.sql')
const phase4Sales = await read('supabase/migrations/00004_phase4_sales.sql')

const assignableRiders = /export async function listAssignableRiders[\s\S]*?\n\}/.exec(deliveryAccess)![0]

/**
 * Column names in a PostgREST select list. Compared as whole names, never as
 * substrings: `paid_amount`.includes('paid') is true, which is exactly how a
 * column that does not exist survived a passing test.
 */
const columnNames = (list: string): string[] => list.split(',').map(part => part.trim())

const coreColumns = columnNames(INVOICE_CORE_COLUMNS)
const detailColumns = columnNames(INVOICE_DETAIL_COLUMNS)

/** Every literal `invoices` select in a source file, as column-name lists. */
function invoiceSelects(source: string): string[][] {
  return [...source.matchAll(/from\('invoices'\)[\s\S]{0,160}?\.select\('([^']*)'\)/g)]
    .map(match => columnNames(match[1]))
}

// ---------------------------------------------------------------------------
// BLOCKER 1 — the empty rider dropdown.
//
// GET /api/riders was gated on can_view_delivery_orders / can_manage_riders. The
// Salesman role carries neither, so the request 403'd, react-query never reached
// success, and the selector rendered empty with no message at all.
// ---------------------------------------------------------------------------

test('a Salesman can read the rider roster the sale screen needs', () => {
  assert.match(ridersRoute, /hasPermission\(loaded, 'can_create_online_orders'\)/)
  assert.match(ridersRoute, /canManageDelivery\s*\n?\s*\? await listRiders\(loaded\.businessId\)\s*\n?\s*: await listAssignableRiders\(loaded\.businessId\)/)
})

test('the roster a Salesman receives is same-business and active only', () => {
  // Both filters are in the query, not in the browser, so neither an inactive
  // rider nor another business's rider is ever sent to the client.
  assert.match(assignableRiders, /\.eq\('business_id', businessId\)\.eq\('is_active', true\)/)
  assert.match(assignableRiders, /\.select\('id, name, phone'\)/)
  assert.match(assignableRiders, /businessId: string/)
  // Rider administration fields are not in the least-privilege projection.
  assert.doesNotMatch(assignableRiders, /zone|vehicle_type|user_id/)
})

test('every rider read is scoped to the caller\'s own business', () => {
  for (const source of [/export async function listRiders[\s\S]*?\n\}/.exec(deliveryAccess)![0], assignableRiders]) {
    assert.match(source, /\.eq\('business_id', businessId\)/)
  }
  assert.match(ridersRoute, /loaded\.businessId/)
  assert.doesNotMatch(ridersRoute, /searchParams.*business|body\.businessId/)
})

test('a role holding none of the rider permissions still fails closed', () => {
  assert.match(ridersRoute, /if \(!canManageDelivery && !canCreateOrders\) \{\s*\n\s*return NextResponse\.json\(\{ error: 'FORBIDDEN' \}, \{ status: 403 \}\)/)
  assert.match(ridersRoute, /if \(!session\?\.user\) return NextResponse\.json\(\{ error: 'UNAUTHORIZED' \}, \{ status: 401 \}\)/)
  assert.match(ridersRoute, /if \(!loaded\) return NextResponse\.json\(\{ error: 'UNAUTHORIZED' \}, \{ status: 401 \}\)/)
})

test('creating or editing riders still requires rider administration', () => {
  // Read access widened; write access did not move.
  assert.match(ridersRoute, /requirePermission\(loaded, 'can_manage_riders'\)/)
})

test('an order creator may make the first assignment and nothing more', () => {
  assert.match(assignRoute, /const canAssignAny = hasPermission\(loaded, 'can_assign_rider'\)/)
  assert.match(assignRoute, /: await requirePermission\(loaded, 'can_create_online_orders'\)/)
  assert.match(assignRoute, /if \(order\.riderId \|\| order\.status !== 'pending'\)/)
  assert.match(assignRoute, /error: 'FORBIDDEN'/)
  assert.match(assignRoute, /getDeliveryOrder\(su\.businessId, id\)/)
})

test('the sale screen explains an empty rider list instead of showing nothing', () => {
  assert.match(onlineSale, /ridersQ\.isError \?/)
  assert.match(onlineSale, /rider list could not be loaded/)
  assert.match(onlineSale, /ridersQ\.isSuccess && activeRiders\.length === 0/)
  assert.match(onlineSale, /No active rider found/)
  // The selector stays optional, and no rider is ever hardcoded.
  assert.match(onlineSale, /Assign Rider \(optional\)/)
  assert.match(onlineSale, /activeRiders\.map\(r => <SelectItem/)
})

// ---------------------------------------------------------------------------
// BLOCKER 2 — a posted invoice would not open.
//
// Production `invoices` is keyed on (business_id, id). A composite primary key
// cannot be referenced by a single-column foreign key, so PostgREST has no
// relationship to resolve for an `invoice_items(...)` embed — and an unresolvable
// embed fails the WHOLE select, not just the embedded part. The read no longer
// embeds anything.
// ---------------------------------------------------------------------------

test('the production invoices table really does have a composite primary key', () => {
  assert.match(foundation, /primary key \(business_id, id\)/i)
})

test('the invoice read embeds no related resource at all', () => {
  const supabaseBranch = /export async function getInvoice[\s\S]*?\n  \}\n  const inv = await db\.invoice\.findFirst/.exec(salesAccess)![0]
  // Comments name the embeds that were removed, so assertions read code only.
  const code = supabaseBranch.replace(/^[ \t]*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /invoice_items\s*\(/)
  assert.doesNotMatch(code, /salesmen\s*\(/)
  assert.doesNotMatch(code, /payments\s*\(/)
  // Line items are their own business-scoped query on the pair the index covers.
  assert.match(code, /\.from\('invoice_items'\)\s*\.select\(columns\)\s*\.eq\('business_id', businessId\)\.eq\('invoice_id', invoiceId\)/)
})

test('the core read carries identity and money, and narrows before giving up', () => {
  for (const column of ['id', 'invoice_no', 'invoice_date', 'customer_name', 'salesman_id', 'subtotal', 'total', 'paid_amount', 'is_cancelled', 'is_returned']) {
    assert.ok(coreColumns.includes(column), `core columns must include ${column}`)
  }
  // Presentation-only columns are additive, so a database that predates them
  // still opens its own invoices on the retry.
  for (const column of ['customer_phone', 'customer_address', 'customer_city', 'discount', 'memo']) {
    assert.ok(!coreColumns.includes(column), `${column} must not be required to open an invoice`)
    assert.ok(detailColumns.includes(column), `${column} belongs to the detail read`)
  }
  assert.match(salesAccess, /let core = await readInvoice\(INVOICE_DETAIL_COLUMNS\)/)
  assert.match(salesAccess, /if \(core\.error && isSchemaShapeError\(core\.error\)\) \{/)
  assert.match(salesAccess, /core = await readInvoice\(INVOICE_CORE_COLUMNS\)/)
})

// ---------------------------------------------------------------------------
// BLOCKER 2b — every invoice read asked for two columns that do not exist.
//
// Production returned 42703 `column invoices.paid does not exist` for both
// GET /api/sales/counter (the Sales List) and GET /api/sales/[id] (the detail),
// and the narrowed retry carried the same two names so it failed identically.
// `invoices` has `paid_amount` plus the `is_cancelled` / `is_returned` flags and
// has never had `paid` or `status` — migration 00004 is the definition.
// ---------------------------------------------------------------------------

test('no invoice read asks for a paid or status column', () => {
  for (const [name, columns] of [['core', coreColumns], ['detail', detailColumns]] as const) {
    assert.ok(!columns.includes('paid'), `${name} columns must not read invoices.paid`)
    assert.ok(!columns.includes('status'), `${name} columns must not read invoices.status`)
  }
  // The two invoices selects written inline rather than through the constants.
  for (const select of invoiceSelects(salesAccess).concat(invoiceSelects(ownerSummary))) {
    assert.ok(!select.includes('paid'), `select must not read invoices.paid: ${select.join(', ')}`)
    assert.ok(!select.includes('status'), `select must not read invoices.status: ${select.join(', ')}`)
  }
})

test('the invoices table defines paid_amount and the lifecycle flags, not paid or status', () => {
  const table = /create table (?:if not exists )?public\.invoices \([\s\S]*?\n\);/i.exec(phase4Sales)![0]
  assert.match(table, /\bpaid_amount\s+numeric/i)
  assert.match(table, /\bis_cancelled\s+boolean/i)
  assert.match(table, /\bis_returned\s+boolean/i)
  assert.doesNotMatch(table, /^\s*paid\s+/im)
  assert.doesNotMatch(table, /^\s*status\s+/im)
})

test('invoice lifecycle is read from the flags, and the label is derived from them', () => {
  // The list and the detail both map the flags directly; neither infers them
  // from a status string that the table cannot supply.
  const mappings = salesAccess.match(/isCancelled: Boolean\(r\.is_cancelled\), isReturned: Boolean\(r\.is_returned\)/g) ?? []
  assert.equal(mappings.length, 2, 'the list and the detail each map the flags once')
  assert.doesNotMatch(salesAccess, /isCancelled: r\.status/)
  assert.doesNotMatch(salesAccess, /isReturned: r\.status/)
  assert.match(salesAccess, /paidAmount: String\(r\.paid_amount \?\? 0\)/)
  assert.match(salesAccess, /function invoiceStatusLabel\(isCancelled: boolean, isReturned: boolean\)/)
  // The owner dashboard filters posted invoices on the same flags.
  assert.match(ownerSummary, /function isPostedInvoice\(row: any\): boolean \{\s*\n\s*return !row\.is_cancelled && !row\.is_returned/)
})

test('only a schema-shape failure is absorbed; anything else propagates', () => {
  assert.equal(isSchemaShapeError({ code: '42703' }), true)
  assert.equal(isSchemaShapeError({ code: '42P01' }), true)
  assert.equal(isSchemaShapeError({ code: 'PGRST200' }), true)
  assert.equal(isSchemaShapeError({ code: 'PGRST204' }), true)
  assert.equal(isSchemaShapeError({ code: 'pgrst205' }), true)
  assert.equal(isSchemaShapeError({ code: null, message: 'column invoices.memo does not exist' }), true)
  assert.equal(isSchemaShapeError({ code: null, message: "Could not find a relationship between 'invoices' and 'invoice_items'" }), true)
  // Permissions, connectivity and genuine query faults are real errors.
  assert.equal(isSchemaShapeError({ code: '42501', message: 'permission denied for table invoices' }), false)
  assert.equal(isSchemaShapeError({ code: '57014', message: 'canceling statement due to statement timeout' }), false)
  assert.equal(isSchemaShapeError({ code: '22P02', message: 'invalid input syntax for type uuid' }), false)
  assert.equal(isSchemaShapeError(null), false)
  assert.equal(isSchemaShapeError(undefined), false)
})

test('each optional section fails on its own and is reported by name', () => {
  assert.deepEqual([...INVOICE_DETAIL_SECTIONS], ['items', 'payments', 'returns', 'salesman', 'returnDetail'])
  for (const section of ['items', 'payments', 'returns', 'salesman', 'returnDetail'] as const) {
    assert.match(salesAccess, new RegExp(`unavailable\\.push\\('${section}'\\)`), `${section} must degrade, not throw`)
    assert.match(salesAccess, new RegExp(`logInvoiceSectionUnavailable\\('${section}'`), `${section} must be logged`)
  }
  assert.match(salesAccess, /unavailableSections: unavailable/)
  // Independent reads run together; none of them can prevent the invoice opening.
  assert.match(salesAccess, /const \[itemRead, salesmanRead, paymentRead, returnRead\] = await Promise\.all\(\[/)
})

test('section diagnostics log codes and never row contents', () => {
  const logger = /function logInvoiceSectionUnavailable[\s\S]*?\n\}/.exec(salesAccess)![0]
  assert.match(logger, /errorCode: error\?\.code \?\? null/)
  assert.match(logger, /schemaShape: isSchemaShapeError\(error\)/)
  assert.doesNotMatch(logger, /customer|amount|total|row\b/)
})

test('a genuine core failure is still an error, never "Invoice not found"', async () => {
  assert.match(salesAccess, /if \(core\.error\) throw new Error\(`Supabase invoice: \$\{core\.error\.message\}`\)/)
  assert.match(salesAccess, /if \(!core\.row\) return null/)
  const route = await read('src/app/api/sales/[id]/route.ts')
  assert.match(route, /if \(!invoice\) return NextResponse\.json\(\{ error: 'NOT_FOUND' \}, \{ status: 404 \}\)/)
})

test('money on the document stays exact, and an unknowable balance is withheld', () => {
  // Totals come from the invoice's own columns, so they never depend on a section
  // that failed to read.
  assert.match(salesAccess, /subtotal: String\(r\.subtotal\)/)
  assert.match(salesAccess, /total: String\(r\.total\)/)
  assert.match(salesAccess, /paidAmount: String\(r\.paid_amount \?\? 0\)/)
  assert.match(invoiceView, /const outstandingKnown = !unavailableSections\.includes\('returns'\)/)
  assert.match(invoiceView, /outstandingKnown && outstanding > 0n/)
  assert.match(invoiceView, /Line items could not be read\./)
  assert.match(invoiceView, /the totals below come from the invoice record and are exact/i)
  // No rounding, no floats: paisa arithmetic stays in BigInt.
  assert.doesNotMatch(invoiceView, /parseFloat|Number\(inv\.total\)|Math\.round\(/)
})

test('every sale type opens its invoice through the one shared read', async () => {
  // Counter, Online, OFC and Other Sale all post into `invoices`, and both entry
  // points — "View Invoice" after posting, and the Sales List — resolve through
  // the same route and the same reader, so the fix cannot be partial.
  const route = await read('src/app/api/sales/[id]/route.ts')
  assert.match(route, /getInvoice\(su\.businessId, id\)/)
  assert.equal((salesAccess.match(/export async function getInvoice\(/g) ?? []).length, 1)
  for (const file of ['counter-sale-view', 'ofc-sale-view', 'online-sale-view']) {
    const view = await read(`src/components/erp/views/${file}.tsx`)
    assert.match(view, /window\.open\(`\/\?invoice=\$\{result\.invoiceId\}`, '_self'\)/, `${file} must open the id the sale returned`)
  }
  const list = await read('src/components/erp/views/sales-list-view.tsx')
  assert.match(list, /\/\?invoice=\$\{r\.id\}/)
  assert.match(invoiceView, /fetch\(`\/api\/sales\/\$\{invoiceId\}`\)/)
})

// ---------------------------------------------------------------------------
// BLOCKER 3 — "Test Connection" failed on a valid key.
//
// Gemini 3 Flash defaults to `medium` thinking. Thinking tokens are charged
// against maxOutputTokens and are never returned, so the probe's 512-token
// ceiling was consumed by reasoning and the candidate came back with no text and
// finishReason MAX_TOKENS. That was read as an empty response — a provider fault
// — and surfaced as a connection error. Detailed coverage lives in
// minimal-ai-integration.test.ts; this pins the two production-facing rules.
// ---------------------------------------------------------------------------

test('the connection test pins a thinking tier and keeps the key server-side', async () => {
  const client = await read('src/lib/ai/gemini-client.ts')
  const core = await read('src/lib/ai/gemini-client-core.ts')
  const view = await read('src/components/erp/views/ai-settings-view.tsx')
  assert.match(client, /^import 'server-only'/m)
  assert.match(client, /PROBE_OUTPUT_TOKENS, resolveThinkingConfig\(GEMINI_MODEL\)/)
  assert.match(core, /if \(candidate\?\.finishReason === 'MAX_TOKENS'\) \{[\s\S]*?'truncated', 200, 'MAX_TOKENS'/)
  // The key is sent as a header and never logged or returned.
  assert.match(core, /'x-goog-api-key': apiKey/)
  assert.doesNotMatch(client, /console\.\w+\([^)]*apiKey/)
  assert.doesNotMatch(view, /apiKey.*(localStorage|sessionStorage)|GEMINI_API_KEY/)
})
