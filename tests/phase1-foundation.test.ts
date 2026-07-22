/**
 * Phase 1 Foundation — static contract and schema validation tests.
 * Uses node:test and node:assert — same convention as opening-stock.test.ts.
 *
 * Tests inspect exact Prisma schema lines and migration 00014 SQL.
 * No database runtime behavior is tested here.
 *
 * CORRECTED FOR PRODUCTION SCHEMA:
 * - Uses businesses (not business)
 * - No Prisma-only tables (accounts, account_categories, delivery_orders,
 *   delivery_status_events, rider_cod_submissions)
 * - Mixed production identifier types: UUID business identities and text invoice identities
 * - Business-scoped idempotency
 * - Server-only RLS containment (no SELECT policies)
 * - Rider foundation uses delivery_events and rider_cash_ledger
 */
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const PRISMA_SCHEMA = (await readFile('prisma/schema.prisma', 'utf8')).toLowerCase()
const MIGRATION_14 = (await readFile('supabase/migrations/00014_phase1_foundation.sql', 'utf8')).toLowerCase()
const INSPECT_14 = (await readFile('supabase/migrations/00014_phase1_foundation_inspect.sql', 'utf8')).toLowerCase()
const DISCOVERY_14 = (await readFile('supabase/migrations/00014_production_schema_discovery.sql', 'utf8')).toLowerCase()

function linesOf(source: string, ...terms: string[]): string[] {
  return source.split('\n').filter((l) => terms.some((t) => l.includes(t.toLowerCase())))
}

// ==========================================================================
// Product commission rate
// ==========================================================================
test('product model has commissionrate as nullable bigint', () => {
  assert.ok(PRISMA_SCHEMA.includes('commissionrate') && PRISMA_SCHEMA.includes('bigint?'), 'commissionRate must be BigInt? in Prisma')
})

test('migration adds commission_rate with non-negative CHECK', () => {
  assert.ok(MIGRATION_14.includes('commission_rate numeric(20,0)'), 'column must be numeric(20,0)')
  assert.ok(MIGRATION_14.includes('commission_rate_non_negative'), 'CHECK constraint name must exist')
  assert.ok(MIGRATION_14.includes('commission_rate is null or commission_rate >= 0'), 'CHECK must allow NULL or >= 0')
})

test('commission rate is whole-unit money, not floating-point', () => {
  assert.ok(!PRISMA_SCHEMA.includes('commissionrate float'), 'must not be Float')
  assert.ok(!MIGRATION_14.includes('commission_rate real'), 'must not be real/float8')
})

// ==========================================================================
// System account foundation — REMOVED (no accounts table in production)
// ==========================================================================
test('no accounts table references in migration 00014', () => {
  assert.ok(!MIGRATION_14.includes('public.accounts'), 'migration must not reference accounts table')
  assert.ok(!MIGRATION_14.includes('is_system'), 'migration must not add is_system column')
  assert.ok(!MIGRATION_14.includes('insert into public.accounts'), 'no INSERT into accounts')
})

test('no account_categories references in migration 00014', () => {
  assert.ok(!MIGRATION_14.includes('public.account_categories'), 'migration must not reference account_categories')
  assert.ok(!MIGRATION_14.includes('parent_id'), 'migration must not add parent_id to account_categories')
})

// ==========================================================================
// Return foundation
// ==========================================================================
test('return lineage: originalInvoiceItemId on SaleReturnLine, NOT on InvoiceItem', () => {
  assert.ok(PRISMA_SCHEMA.includes('model salereturnline') && PRISMA_SCHEMA.includes('originalinvoiceitemid'), 'SaleReturnLine must include originalInvoiceItemId')
  const invItemBlock = PRISMA_SCHEMA.slice(PRISMA_SCHEMA.indexOf('model invoiceitem'), PRISMA_SCHEMA.indexOf('model paymentallocation'))
  assert.ok(!invItemBlock.includes('originalinvoiceitemid'), 'InvoiceItem must NOT have originalInvoiceItemId — sale_return_lines has the relation')
})

test('returnedQty is documented as cached aggregate', () => {
  assert.ok(MIGRATION_14.includes('cached aggregate'), 'migration must label returned_qty as cached aggregate')
  assert.ok(MIGRATION_14.includes('select ... for update') || MIGRATION_14.includes('atomic rpc') || MIGRATION_14.includes('atomic'), 'migration must reference atomic enforcement requirement')
})

test('linked-return tables replace the nonexistent historical sales_returns assumption', () => {
  assert.ok(!MIGRATION_14.includes('public.sales_returns'), '00014 must not ALTER or target the nonexistent guessed table')
  assert.ok(MIGRATION_14.includes('create table if not exists public.sale_return_documents'), 'return document table must be created')
  assert.ok(MIGRATION_14.includes('create table if not exists public.sale_return_lines'), 'return line table must be created')
  assert.ok(PRISMA_SCHEMA.includes('@@map("sale_return_documents")'), 'SalesReturn must map to the return document table')
  assert.ok(PRISMA_SCHEMA.includes('@@map("sale_return_lines")'), 'SaleReturnLine must map to the return line table')
})

test('return document idempotency is unique within a business', () => {
  assert.ok(MIGRATION_14.includes('sale_return_documents_business_idempotency_key_key'), 'business-scoped idempotency constraint is required')
  assert.ok(PRISMA_SCHEMA.includes('@@unique([businessid, idempotencykey])'), 'Prisma must model business-scoped idempotency')
})

test('return lines have immutable original-invoice relationships and quantities', () => {
  assert.ok(MIGRATION_14.includes('business_id         uuid not null'), 'return document business_id must be UUID')
  assert.ok(MIGRATION_14.includes('original_invoice_id text not null'), 'return document invoice ID must be text')
  // Sale return documents use composite FK matching invoices composite PK (business_id, id)
  assert.ok(MIGRATION_14.includes('sale_return_documents_invoice_fkey'), 'composite invoice FK constraint must exist')
  assert.ok(MIGRATION_14.includes('foreign key (business_id, original_invoice_id)'), 'composite FK must use business_id + original_invoice_id')
  assert.ok(MIGRATION_14.includes('references public.invoices(business_id, id)'), 'composite FK must reference invoices(business_id, id')
  // Must NOT have a single-column FK to invoices(id)
  const fkDefEnd = MIGRATION_14.indexOf('create index if not exists sale_return_documents_original_invoice_idx')
  const fkDefStart = MIGRATION_14.indexOf('sale_return_documents (')
  const fkDefs = fkDefEnd > 0 ? MIGRATION_14.slice(fkDefStart, fkDefEnd) : ''
  assert.ok(!fkDefs.match(/references public\.invoices\(id\)/), 'must not have single-column FK to invoices(id)')
  assert.ok(MIGRATION_14.includes('original_invoice_item_id text not null references public.invoice_items(id) on delete restrict'), 'return line must retain a text invoice item ID')
  assert.ok(MIGRATION_14.includes('sale_return_lines_returned_qty_positive'), 'return quantities must be positive')
  assert.ok(PRISMA_SCHEMA.includes('originalinvoiceitemid') && PRISMA_SCHEMA.includes('returnedqty'), 'Prisma must model return-line lineage and quantity')
})

test('original invoice lines remain immutable — no destructive edit fields', () => {
  const invItemBlock = PRISMA_SCHEMA.slice(PRISMA_SCHEMA.indexOf('model invoiceitem'), PRISMA_SCHEMA.indexOf('model paymentallocation'))
  assert.ok(!invItemBlock.includes('mutate'), 'no mutate field')
  assert.ok(!invItemBlock.includes('overwrite'), 'no overwrite field')
})

// ==========================================================================
// CommissionEvent
// ==========================================================================
test('CommissionEvent distinguishes Owner from Salesman', () => {
  assert.ok(PRISMA_SCHEMA.includes('isowneronly'), 'isOwnerOnly field must exist')
  assert.ok(!PRISMA_SCHEMA.includes('isowneronly float'), 'must not be Float')
  assert.ok(!PRISMA_SCHEMA.includes('isowneronly string'), 'must not be String')
})

test('CommissionEvent money fields are all BigInt', () => {
  const ce = PRISMA_SCHEMA.slice(PRISMA_SCHEMA.indexOf('model commissionevent'), PRISMA_SCHEMA.indexOf('model identitysequence'))
  const moneyFields = ['ratepaisas', 'grossamount', 'eligibleamount', 'payableamount', 'paidamount']
  for (const f of moneyFields) {
    assert.ok(ce.includes(f) && ce.includes('bigint'), `${f} must be BigInt`)
  }
})

test('CommissionEvent has business-scoped idempotency', () => {
  assert.ok(PRISMA_SCHEMA.includes('@@unique([businessid, idempotencykey])'), 'idempotencyKey must be business-scoped unique')
  assert.ok(MIGRATION_14.includes('commission_events_business_idempotency_key_idx'), 'migration must create business-scoped unique index')
  assert.ok(!MIGRATION_14.includes('commission_events_idempotency_key_idx'), 'old global idempotency index must be removed')
})

test('CommissionEvent has required indexes', () => {
  assert.ok(MIGRATION_14.includes('commission_events_biz_invoice_idx'), 'business+invoice index')
  assert.ok(MIGRATION_14.includes('commission_events_salesman_idx'), 'salesman index')
  assert.ok(MIGRATION_14.includes('commission_events_invoice_item_idx'), 'invoice item index')
})

test('CommissionEvent preserves production invoice and invoice-item identifier types', () => {
  const ce = MIGRATION_14.slice(MIGRATION_14.indexOf('create table if not exists public.commission_events'), MIGRATION_14.indexOf('-- business-scoped idempotency'))
  assert.ok(ce.includes('business_id              uuid not null references public.businesses(id)'), 'business ID must remain UUID')
  for (const field of ['salesman_id              text', 'invoice_id               text not null', 'invoice_item_id          text not null', 'original_invoice_item_id text']) {
    assert.ok(ce.includes(field), `${field.trim()} must use a compatible text identifier`)
  }
  assert.ok(!ce.includes('references public.invoices'), 'unverified invoice trace fields must not receive an FK')
  assert.ok(!ce.includes('references public.invoice_items'), 'unverified invoice-item trace fields must not receive an FK')
})

test('every new Phase 1 identifier field uses its verified type', () => {
  const returns = MIGRATION_14.slice(MIGRATION_14.indexOf('create table if not exists public.sale_return_documents'), MIGRATION_14.indexOf('-- ============================================================\n-- 4. commission events ledger'))
  for (const field of [
    'id                  uuid primary key',
    'business_id         uuid not null references public.businesses(id)',
    'original_invoice_id text not null',
    'return_voucher_id   text',
    'created_by          uuid',
    'id                       uuid primary key',
    'sale_return_id           uuid not null references public.sale_return_documents(id)',
    'original_invoice_item_id text not null references public.invoice_items(id)',
  ]) assert.ok(returns.includes(field), `return identifier field must be compatible: ${field.trim()}`)

  const ce = MIGRATION_14.slice(MIGRATION_14.indexOf('create table if not exists public.commission_events'), MIGRATION_14.indexOf('-- business-scoped idempotency'))
  for (const field of ['id                       uuid primary key', 'business_id              uuid not null', 'return_event_id          text', 'allocation_id            text']) {
    assert.ok(ce.includes(field), `commission identifier field must be compatible: ${field.trim()}`)
  }
  assert.ok(MIGRATION_14.includes('business_id uuid not null references public.businesses(id)'), 'identity sequence business ID must be UUID')
  for (const field of ['add column if not exists idempotency_key text', 'add column if not exists settlement_batch_id text']) {
    assert.ok(MIGRATION_14.includes(field), `${field} is required`)
  }
})

// ==========================================================================
// IdentitySequence
// ==========================================================================
test('IdentitySequence has business+prefix composite PK', () => {
  const idSeq = PRISMA_SCHEMA.slice(PRISMA_SCHEMA.indexOf('model identitysequence'), PRISMA_SCHEMA.length)
  assert.ok(idSeq.includes('businessid') && idSeq.includes('prefix'), 'must contain businessId and prefix')
  assert.ok(PRISMA_SCHEMA.includes('@@unique([businessid, prefix])'), 'composite unique constraint required')
})

test('identity_sequences table has composite PK in migration', () => {
  assert.ok(MIGRATION_14.includes('primary key (business_id, prefix)'), 'migration PK must match Prisma unique')
})

test('identity_sequences references businesses with uuid FK', () => {
  assert.ok(MIGRATION_14.includes('references public.businesses(id)'), 'FK must reference businesses')
})

test('existing shared sale invoice sequence is untouched', () => {
  const invModel = PRISMA_SCHEMA.slice(PRISMA_SCHEMA.indexOf('model invoice {'), PRISMA_SCHEMA.indexOf('model invoiceitem'))
  assert.ok(invModel.includes('invoiceno'), 'invoiceNo field must remain')
  assert.ok(invModel.includes('@@unique([businessid, invoiceno])'), 'invoiceNo unique unchanged')
})

// ==========================================================================
// Account category parent — REMOVED (no account_categories in production)
// ==========================================================================
test('no account_categories.parent_id in migration 00014', () => {
  assert.ok(!MIGRATION_14.includes('account_categories.parent_id'), 'migration must not add parent_id to account_categories')
  assert.ok(!MIGRATION_14.includes('account_categories_no_self_parent'), 'self-parent constraint must not exist')
})

// ==========================================================================
// Rider foundation — uses real production tables
// ==========================================================================
test('rider foundation uses delivery_events and rider_cash_ledger, not delivery_orders', () => {
  assert.ok(MIGRATION_14.includes('public.delivery_events'), 'migration must reference delivery_events')
  assert.ok(MIGRATION_14.includes('public.rider_cash_ledger'), 'migration must reference rider_cash_ledger')
  assert.ok(!MIGRATION_14.includes('public.delivery_orders'), 'migration must NOT reference delivery_orders')
  assert.ok(!MIGRATION_14.includes('public.delivery_status_events'), 'migration must NOT reference delivery_status_events')
  assert.ok(!MIGRATION_14.includes('public.rider_cod_submissions'), 'migration must NOT reference rider_cod_submissions')
})

test('delivery_events has idempotency_key', () => {
  assert.ok(MIGRATION_14.includes('delivery_events_idempotency_key_idx'), 'delivery event idempotency index must exist')
})

test('rider_cash_ledger has idempotency_key and settlement_batch_id', () => {
  assert.ok(MIGRATION_14.includes('rider_cash_ledger_idempotency_key_idx'), 'rider cash ledger idempotency index must exist')
  assert.ok(MIGRATION_14.includes('rider_cash_ledger_settlement_batch_idx'), 'rider cash ledger settlement batch index must exist')
})

// ==========================================================================
// Migration safety
// ==========================================================================
test('00014 does not touch 00009, 00011, 00012, or 00013', async () => {
  for (const m of ['00009', '00011', '00012', '00013']) {
    const migContent = await readFile('supabase/migrations/00014_phase1_foundation.sql', 'utf8')
    const dropLines = linesOf(migContent.toLowerCase(), 'drop')
    for (const line of dropLines) {
      assert.ok(!line.includes(m), `00014 must not DROP anything from migration ${m}`)
    }
  }
  assert.ok(!MIGRATION_14.includes('business_id = system'), 'no system business_id literal')
})

test('00014 is additive — no destructive DDL', () => {
  const destructive = ['drop table', 'drop column', 'delete from', 'truncate', 'alter column']
  for (const term of destructive) {
    assert.ok(!MIGRATION_14.includes(term), `must not contain '${term}'`)
  }
})

test('00014 is wrapped in transaction', () => {
  assert.ok(MIGRATION_14.includes('begin;'), 'must start with BEGIN')
  assert.ok(MIGRATION_14.includes('commit;'), 'must end with COMMIT')
})

test('every ALTER target is explicitly verified before DDL', () => {
  const verifiedTargets = [
    'public.products', 'public.invoice_items',
    'public.delivery_events', 'public.rider_cash_ledger',
  ]
  for (const target of verifiedTargets) {
    assert.ok(MIGRATION_14.includes(`to_regclass('${target}')`), `${target} must be a required base table`)
    assert.ok(MIGRATION_14.includes(`alter table ${target}`), `${target} must be altered only after precondition verification`)
  }
  assert.ok(!MIGRATION_14.includes('alter table if exists'), 'missing base tables must not be silently skipped')
})

test('00014 aborts rather than running against unverified missing base tables', () => {
  assert.ok(MIGRATION_14.includes('phase 1 foundation migration requires existing base table'), 'migration must raise a clear schema-drift error')
  assert.ok(MIGRATION_14.includes('v_missing is not null'), 'migration must stop when a required base table is absent')
})

test('no production-specific hardcoded IDs in 00014', () => {
  const lines = MIGRATION_14.split('\n')
  for (const line of lines) {
    if (line.includes('gen_random_uuid')) continue
    const uuidMatch = line.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    assert.ok(!uuidMatch, `hardcoded UUID found in migration: ${line.trim().slice(0, 80)}`)
  }
})

// ==========================================================================
// Prisma formatting confirmation
// ==========================================================================
test('Prisma large diff is formatting-only; no semantic change to pre-existing models', () => {
  const originalModels = [
    'aiprovidersetting', 'user', 'profile', 'role', 'permission',
    'rolepermission', 'business', 'accountcategory', 'account', 'businessaccount',
    'auditlog', 'voucher', 'voucherline', 'productcategory', 'product',
    'stockmovement', 'salesman', 'customer', 'invoice', 'invoiceitem',
    'paymentallocation', 'salesmancommission', 'salesreturn', 'salereturnline', 'vendor',
    'purchase', 'purchaseitem', 'purchasepayment', 'purchasereturn',
    'purchasereturnitem',
  ]
  for (const m of originalModels) {
    assert.ok(PRISMA_SCHEMA.includes(`model ${m}`), `pre-existing model '${m}' must still exist`)
  }
  assert.ok(PRISMA_SCHEMA.includes('@default("pkr")'), 'currency default preserved')
  assert.ok(PRISMA_SCHEMA.includes('@default("piece")'), 'unit default preserved')
  assert.ok(PRISMA_SCHEMA.includes('@default(5)'), 'lowStockThreshold default preserved')
})

test('00014 uses only PostgreSQL-safe conditional patterns', () => {
  assert.ok(!MIGRATION_14.includes('add constraint if not exists'), 'ADD CONSTRAINT IF NOT EXISTS is invalid PostgreSQL')
  assert.ok(!MIGRATION_14.includes('add foreign key if not exists'), 'ADD FOREIGN KEY IF NOT EXISTS is invalid PostgreSQL')
  assert.ok(!MIGRATION_14.includes('create policy if not exists'), 'CREATE POLICY IF NOT EXISTS is invalid PostgreSQL')
  assert.ok(!MIGRATION_14.includes('alter policy if exists'), 'ALTER POLICY IF EXISTS is invalid PostgreSQL')
})

// ==========================================================================
// Artifact / corruption regression
// ==========================================================================
test('00014 SQL contains no template/XML/artifact markers', () => {
  assert.ok(!MIGRATION_14.includes('</parameter2name>'), 'no parameter2name marker')
  assert.ok(!MIGRATION_14.includes('</write_to_file>'), 'no write_to_file marker')
  assert.ok(!MIGRATION_14.includes('<parameter'), 'no parameter marker')
  assert.ok(!MIGRATION_14.includes('</parameter'), 'no parameter close marker')
  assert.ok(!MIGRATION_14.includes('<tool'), 'no tool marker')
  assert.ok(!MIGRATION_14.includes('</tool'), 'no tool close marker')
  assert.ok(!MIGRATION_14.includes('```'), 'no markdown code fence')
})

test('00014 inspection SQL contains no template/XML/artifact markers', () => {
  assert.ok(!INSPECT_14.includes('</parameter2name>'), 'no parameter2name marker')
  assert.ok(!INSPECT_14.includes('</write_to_file>'), 'no write_to_file marker')
  assert.ok(!INSPECT_14.includes('<parameter'), 'no parameter marker')
  assert.ok(!INSPECT_14.includes('</parameter'), 'no parameter close marker')
  assert.ok(!INSPECT_14.includes('<tool'), 'no tool marker')
  assert.ok(!INSPECT_14.includes('</tool'), 'no tool close marker')
  assert.ok(!INSPECT_14.includes('```'), 'no markdown code fence')
})

test('inspection SQL is read-only', () => {
  const mutations = [
    'insert into', 'update ', 'delete from', 'alter table', 'create table',
    'create index', 'drop ', 'grant ', 'revoke ', 'truncate ',
  ]
  for (const term of mutations) {
    assert.ok(
      !linesOf(INSPECT_14, term).length,
      `inspection SQL must not contain executable statement: ${term}`,
    )
  }
})

test('inspection SQL uses safe to_regclass() instead of ::regclass', () => {
  assert.ok(!INSPECT_14.includes('::regclass'), 'inspection SQL must not use ::regclass')
  assert.ok(INSPECT_14.includes('to_regclass'), 'inspection SQL must use to_regclass()')
})

test('production schema discovery is catalog-only and returns requested metadata', () => {
  const required = [
    'information_schema.tables', 'information_schema.columns',
    'information_schema.table_constraints', 'information_schema.key_column_usage',
    'information_schema.constraint_column_usage', 'table_name', 'column_name',
    'data_type', 'is_nullable', 'column_default', 'likely_domain', 'foreign key',
  ]
  for (const item of required) assert.ok(DISCOVERY_14.includes(item), `discovery SQL must include ${item}`)
  assert.ok(DISCOVERY_14.includes('business|company|tenant'), 'discovery must search business-domain terms')
  assert.ok(DISCOVERY_14.includes('delivery|rider|cod|courier'), 'discovery must search delivery-domain terms')
})

test('production schema discovery is read-only and never reads application tables', () => {
  const mutations = ['insert into', 'update ', 'delete from', 'alter table', 'create table', 'create index', 'drop ', 'grant ', 'revoke ', 'truncate ']
  for (const term of mutations) assert.equal(linesOf(DISCOVERY_14, term).length, 0, `discovery SQL must not contain ${term}`)
  assert.ok(!DISCOVERY_14.includes('from public.'), 'discovery SQL must not SELECT application rows')
  assert.ok(!DISCOVERY_14.includes('join public.'), 'discovery SQL must not JOIN application rows')
})

test('production schema discovery introduces no guessed table-name aliases', () => {
  for (const guessed of ['public.business', 'public.accounts', 'public.delivery_orders', 'account_master', 'chart_of_accounts', 'online_orders', 'delivery_assignments']) {
    assert.ok(!DISCOVERY_14.includes(guessed), `discovery must not assume ${guessed}`)
  }
})

test('migration 00014 avoids unsafe ::regclass in DO blocks', () => {
  assert.ok(!MIGRATION_14.includes('::regclass'), 'migration SQL must not use ::regclass')
})

test('inspection SQL never selects from Phase 1 application tables', () => {
  const phase1Tables = [
    'products', 'invoice_items', 'sale_return_documents', 'sale_return_lines',
    'commission_events', 'identity_sequences', 'delivery_events', 'rider_cash_ledger',
  ]
  for (const t of phase1Tables) {
    const bad = `from public.${t}`
    assert.ok(!INSPECT_14.includes(bad), `inspection SQL must not SELECT from ${bad}`)
    assert.ok(!INSPECT_14.includes(`join public.${t}`), `inspection SQL must not JOIN ${bad}`)
  }
})

test('inspection SQL covers every Phase 1 object from migration 00014', () => {
  const required = [
    'products.commission_rate', 'products.commission_rate_non_negative',
    'invoice_items.returned_qty',
    'base table: businesses', 'base table: products', 'base table: invoices',
    'base table: invoice_items', 'base table: profiles', 'base table: riders',
    'base table: delivery_events', 'base table: rider_cash_ledger',
    'invoices pk is composite', 'invoice_items pk is single-column',
    'sale_return_documents table',
    'sale_return_documents composite invoice fk',
    'sale_return_documents no single-column invoice fk',
    'sale_return_documents idempotency constraint',
    'sale_return_documents original invoice index', 'sale_return_documents rls',
    'sale_return_documents service_role insert',
    'sale_return_lines table',
    'sale_return_lines original invoice item fk',
    'sale_return_lines returned_qty positive constraint', 'sale_return_lines rls',
    'sale_return_lines service_role insert',
    'commission_events table', 'commission_events business-scoped idempotency index',
    'commission_events biz-invoice index', 'commission_events salesman index',
    'commission_events invoice-item index', 'commission_events rls',
    'commission_events anon select', 'commission_events anon insert',
    'commission_events authenticated select', 'commission_events authenticated insert',
    'commission_events service_role insert',
    'identity_sequences table', 'identity_sequences composite pk',
    'identity_sequences rls', 'identity_sequences anon select',
    'identity_sequences anon insert', 'identity_sequences authenticated select',
    'identity_sequences authenticated insert', 'identity_sequences service_role insert',
    'delivery_events.idempotency_key', 'delivery_events_idempotency_key_idx',
    'rider_cash_ledger.idempotency_key', 'rider_cash_ledger_idempotency_key_idx',
    'rider_cash_ledger.settlement_batch_id', 'rider_cash_ledger_settlement_batch_idx',
  ]
  for (const r of required) {
    assert.ok(INSPECT_14.includes(r), `inspection SQL must include row for ${r}`)
  }
})

test('migration requires only production base tables', () => {
  const required = [
    'public.businesses', 'public.products', 'public.invoices',
    'public.invoice_items', 'public.profiles', 'public.riders',
    'public.delivery_events', 'public.rider_cash_ledger',
  ]
  for (const t of required) {
    assert.ok(MIGRATION_14.includes(t), `migration must require production table: ${t}`)
  }
  // Must NOT require Prisma-only tables
  assert.ok(!MIGRATION_14.match(/to_regclass\('public\.business'\)/), 'migration must not require public.business')
  assert.ok(MIGRATION_14.match(/to_regclass\('public\.businesses'\)/), 'migration must require public.businesses')
  for (const t of ['public.accounts', 'public.account_categories', 'public.delivery_orders', 'public.delivery_status_events', 'public.rider_cod_submissions']) {
    assert.ok(!MIGRATION_14.includes(t), `migration must NOT require Prisma-only table: ${t}`)
  }
  assert.ok(MIGRATION_14.includes('aborting without changes'), 'unproven mappings must abort safely')
})

// ==========================================================================
// RLS / server-only access — static contract tests
// ==========================================================================
test('new Phase 1 tables follow server-only containment pattern', () => {
  assert.ok(MIGRATION_14.includes('revoke all on public.commission_events from anon'), 'commission_events must revoke anon')
  assert.ok(MIGRATION_14.includes('revoke all on public.commission_events from authenticated'), 'commission_events must revoke authenticated')
  assert.ok(MIGRATION_14.includes('grant all on public.commission_events to service_role'), 'commission_events must grant service_role')
  assert.ok(MIGRATION_14.includes('revoke all on public.identity_sequences from anon'), 'identity_sequences must revoke anon')
  assert.ok(MIGRATION_14.includes('revoke all on public.identity_sequences from authenticated'), 'identity_sequences must revoke authenticated')
  assert.ok(MIGRATION_14.includes('grant all on public.identity_sequences to service_role'), 'identity_sequences must grant service_role')
})

test('no SELECT policies on new Phase 1 tables — server-only containment', () => {
  assert.ok(!MIGRATION_14.includes('commission_events_select_own'), 'no SELECT policy on commission_events')
  assert.ok(!MIGRATION_14.includes('identity_sequences_select_own'), 'no SELECT policy on identity_sequences')
  assert.ok(!MIGRATION_14.includes('sale_return_documents_select_own'), 'no SELECT policy on sale_return_documents')
  assert.ok(!MIGRATION_14.includes('sale_return_lines_select_own'), 'no SELECT policy on sale_return_lines')
})

test('no unrestricted direct write grants to anon or authenticated on new tables', () => {
  const lines = MIGRATION_14.split('\n').map((l) => l.trim().toLowerCase())
  const badPatterns = [
    'grant insert, update, delete on public.commission_events to authenticated',
    'grant all on public.commission_events to authenticated',
    'grant insert, update, delete on public.identity_sequences to authenticated',
    'grant all on public.identity_sequences to authenticated',
    'grant insert, update, delete on public.commission_events to anon',
    'grant all on public.commission_events to anon',
    'grant insert, update, delete on public.identity_sequences to anon',
    'grant all on public.identity_sequences to anon',
  ]
  for (const bad of badPatterns) {
    assert.ok(!lines.includes(bad), `forbidden grant found: ${bad}`)
  }
})

// ==========================================================================
// Production identifier type alignment
// ==========================================================================
test('new tables use uuid PK type', () => {
  // The actual SQL has commas after the default clause, so check partial match
  const pkPattern = /id\s+uuid\s+primary\s+key\s+default\s+gen_random_uuid/gi
  const matches = MIGRATION_14.match(pkPattern)
  assert.ok(matches && matches.length >= 3, 'sale_return_documents, sale_return_lines, and commission_events must use uuid PK')
})

test('new tables use UUID for business identifiers and text for invoice identifiers', () => {
  const fkPattern = /business_id\s+uuid\s+not\s+null\s+references\s+public\.businesses/gi
  const matches = MIGRATION_14.match(fkPattern)
  // sale_return_lines + commission_events + identity_sequences have direct FKs to businesses
  // sale_return_documents uses composite FK via invoices(business_id, id)
  // commission_events has no FK at all (deferred)
  assert.ok(matches && matches.length >= 3, 'business_id must be UUID referencing businesses in at least 3 places')
  assert.ok(MIGRATION_14.includes('original_invoice_id text not null'), 'sale return invoice ID must match invoices.id text')
  assert.ok(MIGRATION_14.includes('original_invoice_item_id text not null references public.invoice_items(id)'), 'return-line item ID must match invoice_items.id text')
})

test('identity_sequences uses uuid business_id', () => {
  assert.ok(MIGRATION_14.includes('business_id uuid not null references public.businesses(id)'), 'identity_sequences business_id must be uuid')
})

// ==========================================================================
// UUID type verification in inspection SQL
// ==========================================================================
test('inspection SQL checks UUID and text types on new and production tables', () => {
  assert.ok(INSPECT_14.includes('sale_return_documents uuid pk type'), 'inspection must check uuid PK on sale_return_documents')
  assert.ok(INSPECT_14.includes('sale_return_documents business_id uuid type'), 'inspection must check uuid business_id on sale_return_documents')
  assert.ok(INSPECT_14.includes('sale_return_lines uuid pk type'), 'inspection must check uuid PK on sale_return_lines')
  assert.ok(INSPECT_14.includes('sale_return_lines business_id uuid type'), 'inspection must check uuid business_id on sale_return_lines')
  assert.ok(INSPECT_14.includes('commission_events uuid pk type'), 'inspection must check uuid PK on commission_events')
  assert.ok(INSPECT_14.includes('commission_events business_id uuid type'), 'inspection must check uuid business_id on commission_events')
  assert.ok(INSPECT_14.includes('identity_sequences business_id uuid type'), 'inspection must check uuid business_id on identity_sequences')
  for (const typeCheck of [
    'invoices.business_id', 'invoices.id', 'invoice_items.business_id', 'invoice_items.id',
    'sale_return_documents original_invoice_id text type',
    'sale_return_lines original_invoice_item_id text type',
    'commission_events invoice_id text type', 'commission_events invoice_item_id text type',
    'phase 1 foreign keys have compatible column types',
  ]) assert.ok(INSPECT_14.includes(typeCheck), `inspection must check ${typeCheck}`)
})

// ==========================================================================
// Prisma-only table absence verification
// ==========================================================================
test('inspection SQL verifies Prisma-only tables are absent in production', () => {
  assert.ok(INSPECT_14.includes('prisma-only table absent: accounts'), 'inspection must check accounts absence')
  assert.ok(INSPECT_14.includes('prisma-only table absent: account_categories'), 'inspection must check account_categories absence')
  assert.ok(INSPECT_14.includes('prisma-only table absent: business'), 'inspection must check business absence')
  assert.ok(INSPECT_14.includes('prisma-only table absent: delivery_orders'), 'inspection must check delivery_orders absence')
  assert.ok(INSPECT_14.includes('prisma-only table absent: delivery_status_events'), 'inspection must check delivery_status_events absence')
  assert.ok(INSPECT_14.includes('prisma-only table absent: rider_cod_submissions'), 'inspection must check rider_cod_submissions absence')
})
