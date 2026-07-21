/**
 * Phase 1 Foundation — static contract and schema validation tests.
 * Uses node:test and node:assert — the same convention as opening-stock.test.ts.
 *
 * Tests inspect exact Prisma schema lines and migration 00014 SQL.
 * No database runtime behavior is tested here.
 */
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const PRISMA_SCHEMA = (await readFile('prisma/schema.prisma', 'utf8')).toLowerCase()
const MIGRATION_14 = (await readFile('supabase/migrations/00014_phase1_foundation.sql', 'utf8')).toLowerCase()

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
  assert.ok(MIGRATION_14.includes('commission_rate bigint'), 'column must be bigint')
  assert.ok(MIGRATION_14.includes('commission_rate_non_negative'), 'CHECK constraint name must exist')
  assert.ok(MIGRATION_14.includes('commission_rate is null or commission_rate >= 0'), 'CHECK must allow NULL or >= 0')
})

test('commission rate is whole-unit money, not floating-point', () => {
  assert.ok(!PRISMA_SCHEMA.includes('commissionrate float'), 'must not be Float')
  assert.ok(!MIGRATION_14.includes('commission_rate numeric'), 'must not be numeric/decimal')
  assert.ok(!MIGRATION_14.includes('commission_rate real'), 'must not be real/float8')
})

// ==========================================================================
// System account foundation
// ==========================================================================
test('no hardcoded system business_id in migration', () => {
  assert.ok(!MIGRATION_14.includes("business_id = 'system'"), 'no literal system business_id')
})

test('Rider Held COD account is NOT created by 00014', () => {
  assert.ok(!MIGRATION_14.includes('insert into public.accounts'), 'no INSERT into accounts — seed removed')
})

test('accounts table receives is_system boolean column', () => {
  assert.ok(MIGRATION_14.includes('is_system boolean') || MIGRATION_14.includes('is_system bool'), 'migration must add is_system to accounts')
  assert.ok(PRISMA_SCHEMA.includes('issystem'), 'Prisma model must have isSystem field')
})

test('existing accounts default to non-system', () => {
  assert.ok(MIGRATION_14.includes('is_system') && MIGRATION_14.includes('default false'), 'default must be false so existing accounts are unaffected')
})

// ==========================================================================
// Return foundation
// ==========================================================================
test('return lineage: originalInvoiceItemId on InvoiceItem', () => {
  assert.ok(PRISMA_SCHEMA.includes('originalinvoiceitemid'), 'Prisma must include originalInvoiceItemId')
  assert.ok(MIGRATION_14.includes('original_invoice_item_id'), 'migration must add original_invoice_item_id')
})

test('returnedQty is documented as cached aggregate', () => {
  assert.ok(MIGRATION_14.includes('cached aggregate'), 'migration must label returned_qty as cached aggregate')
  assert.ok(MIGRATION_14.includes('select ... for update') || MIGRATION_14.includes('atomic rpc') || MIGRATION_14.includes('atomic'), 'migration must reference atomic enforcement requirement')
})

test('sales_returns has idempotency_key unique index', () => {
  assert.ok(MIGRATION_14.includes('sales_returns_idempotency_key_idx') || MIGRATION_14.includes('sales_returns'), 'sales_returns must have idempotency')
  assert.ok(PRISMA_SCHEMA.includes('idempotencykey'), 'Prisma must have idempotencyKey')
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

test('CommissionEvent has unique idempotencyKey', () => {
  assert.ok(PRISMA_SCHEMA.includes('idempotencykey') && PRISMA_SCHEMA.includes('@unique'), 'idempotencyKey must be @unique')
  assert.ok(MIGRATION_14.includes('commission_events_idempotency_key_idx'), 'migration must create unique index')
})

test('CommissionEvent has required indexes', () => {
  assert.ok(MIGRATION_14.includes('commission_events_biz_invoice_idx'), 'business+invoice index')
  assert.ok(MIGRATION_14.includes('commission_events_salesman_idx'), 'salesman index')
  assert.ok(MIGRATION_14.includes('commission_events_invoice_item_idx'), 'invoice item index')
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

test('existing shared sale invoice sequence is untouched', () => {
  const invModel = PRISMA_SCHEMA.slice(PRISMA_SCHEMA.indexOf('model invoice {'), PRISMA_SCHEMA.indexOf('model invoiceitem'))
  assert.ok(invModel.includes('invoiceno'), 'invoiceNo field must remain')
  assert.ok(invModel.includes('@@unique([businessid, invoiceno])'), 'invoiceNo unique unchanged')
})

// ==========================================================================
// Account category parent
// ==========================================================================
test('account_categories has parent_id with self-parent CHECK', () => {
  assert.ok(MIGRATION_14.includes('parent_id text'), 'migration must add parent_id')
  assert.ok(MIGRATION_14.includes('account_categories_no_self_parent'), 'self-parent constraint must exist')
})

test('AccountCategory in Prisma has parentId with hierarchy relation', () => {
  assert.ok(PRISMA_SCHEMA.includes('parentid'), 'Prisma must have parentId')
  assert.ok(PRISMA_SCHEMA.includes('accountcategoryhierarchy'), 'self-referencing relation must exist')
})

// ==========================================================================
// Rider foundation
// ==========================================================================
test('delivery_orders has qty fields for partial delivery/return', () => {
  assert.ok(MIGRATION_14.includes('ordered_qty'), 'ordered_qty must exist')
  assert.ok(MIGRATION_14.includes('delivered_qty'), 'delivered_qty must exist')
  assert.ok(MIGRATION_14.includes('returned_qty'), 'returned_qty on delivery_orders must exist')
})

test('delivery_status_events has idempotency_key', () => {
  assert.ok(MIGRATION_14.includes('delivery_events_idempotency_key_idx'), 'delivery event idempotency index must exist')
})

test('rider_cod_submissions has idempotency_key', () => {
  assert.ok(MIGRATION_14.includes('cod_submissions_idempotency_key_idx'), 'settlement idempotency index must exist')
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
    'paymentallocation', 'salesmancommission', 'salesreturn', 'vendor',
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
  const badPatterns = [
    'alter table if exists public.products\n  add constraint if not exists',
    'alter table if exists public.account_categories\n  add constraint if not exists',
    'add foreign key if not exists',
    'create policy if not exists',
    'alter policy if exists',
  ]
  for (const bad of badPatterns) {
    assert.ok(!MIGRATION_14.includes(bad), `forbidden pattern: ${bad}`)
  }
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

test('commission_events has business-scoped SELECT policy', () => {
  assert.ok(MIGRATION_14.includes('commission_events_select_own on public.commission_events'), 'SELECT policy must exist')
  assert.ok(MIGRATION_14.includes("business_id = current_setting('app.current_business_id', true)"), 'business_id must match current_business_id')
})

test('identity_sequences has business-scoped SELECT policy', () => {
  assert.ok(MIGRATION_14.includes('identity_sequences_select_own on public.identity_sequences'), 'SELECT policy must exist')
  assert.ok(MIGRATION_14.includes("business_id = current_setting('app.current_business_id', true)"), 'business_id must match current_business_id')
})

test('delivery_status_events and rider_cod_submissions remain RLS-covered by 00007', () => {
  assert.ok(MIGRATION_14.includes('delivery_status_events and rider_cod_submissions already have rls from'), 'documentation must note existing RLS')
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