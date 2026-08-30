import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const migration = await readFile('supabase/migrations/00036_legacy_transaction_identity_bridge.sql', 'utf8')
const bridge = await readFile('src/lib/identity/legacy-bridge.ts', 'utf8')
const vouchers = await readFile('src/lib/vouchers/data-access.ts', 'utf8')
const purchases = await readFile('src/lib/purchases/data-access.ts', 'utf8')
const sales = await readFile('src/lib/sales/data-access.ts', 'utf8')
const contra = await readFile('src/lib/money/operational-money.ts', 'utf8')
const salesReturnRoute = await readFile('src/app/api/sales/[id]/return/route.ts', 'utf8')
// Docs are maintained in mixed encodings: CLIENT_REQUIREMENTS and
// CURRENT_IMPLEMENTATION_STATUS were re-encoded to UTF-8 (at the historical
// sales-return workflow commit), while ACCOUNTING_CODES_AND_IDENTITIES remains
// UTF-16LE. Decode each file by its UTF-16LE BOM when present, else UTF-8.
async function readDoc(path: string): Promise<string> {
  const buf = await readFile(path)
  return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe
    ? buf.toString('utf16le').replace(/^\uFEFF/, '')
    : buf.toString('utf8').replace(/^\uFEFF/, '')
}

const clientRequirements = await readDoc('docs/CLIENT_REQUIREMENTS.md')
const identityPolicy = await readDoc('docs/ACCOUNTING_CODES_AND_IDENTITIES.md')
const implementationStatus = await readDoc('docs/CURRENT_IMPLEMENTATION_STATUS.md')

const executableSql = migration
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join('\n')

test('historic transaction identities are not rewritten', () => {
  for (const table of ['contra_entries', 'receipts', 'payments', 'purchase_returns', 'invoices', 'purchases', 'expenses', 'vouchers']) {
    assert.doesNotMatch(executableSql, new RegExp(`update\\s+public\\.${table}\\b`, 'i'))
  }
  assert.match(migration, /Never rewrite CV\/RV\/JV\/PRN\/SR historical values/)
  assert.doesNotMatch(executableSql, /replace\s*\(\s*contra_no|replace\s*\(\s*receipt_no/i)
})

test('legacy helper tokens map new postings to approved prefixes', () => {
  assert.match(migration, /'contra_entries\.contra_no' then 'CON'/)
  assert.match(migration, /'receipts\.receipt_no' then 'REC'/)
  assert.match(migration, /'payments\.payment_no' then 'PAY'/)
  assert.match(migration, /next_purchase_return_no[\s\S]+?'PRT'/)
  assert.match(migration, /next_invoice_no[\s\S]+?'INV'/)
  assert.match(migration, /next_purchase_no[\s\S]+?'PUR'/)
  assert.match(migration, /'expenses\.expense_no' then 'EXP'/)
  assert.match(migration, /'vouchers\.voucher_no' then 'JRV'/)
  assert.match(migration, /next_cod_submission_no[\s\S]+?'CS'/)
  for (const pending of ['STA', 'STM', 'OPS', 'RDS', 'COM', 'CAP', 'DRW', 'DO']) {
    assert.match(migration, new RegExp(`'${pending}'`))
  }
})

test('sales-return identity is added, backfilled safely, scoped, then required', () => {
  const addAt = migration.indexOf('add column if not exists return_no text')
  const backfillAt = migration.indexOf("set return_no = 'SR-'")
  const uniqueAt = migration.indexOf('sales_returns_business_return_no_uidx')
  const requiredAt = migration.indexOf('alter column return_no set not null')
  assert.ok(addAt >= 0 && addAt < backfillAt && backfillAt < uniqueAt && uniqueAt < requiredAt)
  assert.match(migration, /partition by sr\.business_id/)
  assert.match(migration, /order by sr\.created_at, sr\.id/)
  assert.match(migration, /before insert on public\.sales_returns/)
  assert.match(migration, /allocate_legacy_transaction_identity\(new\.business_id, 'SRT'\)/)
})

test('allocator is business-scoped, collision-safe, monotonic, and deletion-safe', () => {
  assert.match(migration, /primary key \(business_id, prefix\)/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /set last_value = last_value \+ 1/)
  assert.match(migration, /greatest\([\s\S]+last_value[\s\S]+excluded\.last_value/)
  assert.doesNotMatch(migration, /delete from public\.legacy_transaction_identity_sequences/i)
})

test('posting retries replay stored results without allocating another number', () => {
  assert.match(migration, /primary key \(business_id, operation, idempotency_key\)/)
  assert.match(migration, /if not v_claimed then return v_result \|\| jsonb_build_object\('idempotent', true\)/)
  for (const operation of ['sale', 'payment', 'receipt', 'journal', 'contra', 'expense', 'purchase_return', 'sales_return']) {
    assert.match(migration, new RegExp(`operation = '${operation}'`))
  }
})

test('migration has no dependency on UUID-ledger architecture', () => {
  for (const forbidden of [
    'businesses', 'ledger_accounts', 'ledger_voucher_sequences',
    'account_subcategories', 'commission_events', 'sale_return_documents',
    'sale_return_lines',
  ]) {
    assert.doesNotMatch(migration, new RegExp(`\\b${forbidden}\\b`, 'i'), forbidden)
  }
  assert.match(migration, /references public\.business\(id\)/)
})

test('migration-absent compatibility retries unchanged legacy posting signatures', () => {
  assert.match(bridge, /classifyPostgrestCompatibilityError\(bridged\.error\) !== 'missing-rpc'/)
  assert.match(bridge, /admin\.rpc\(name, args\)/)
  assert.match(vouchers, /callLegacyIdentityRpc\('post_payment_voucher'/)
  assert.match(vouchers, /callLegacyIdentityRpc\('post_receipt_voucher'/)
  assert.match(vouchers, /callLegacyIdentityRpc\('post_journal_voucher'/)
  assert.match(vouchers, /callLegacyIdentityRpc\('post_expense_batch'/)
  assert.match(contra, /callLegacyIdentityRpc\('post_contra_entry'/)
  assert.match(purchases, /callLegacyIdentityRpc\('post_purchase_return'/)
  assert.match(sales, /callLegacyIdentityRpc\('post_sale'/)
})

test('sales return fails actionably when 00036 is absent and never posts a partial legacy return', () => {
  assert.match(bridge, /LegacyIdentityMigrationRequiredError/)
  assert.match(sales, /callRequiredLegacyIdentityRpc\('post_sales_return'/)
  assert.match(salesReturnRoute, /LEGACY_IDENTITY_MIGRATION_REQUIRED|e\.code/)
  assert.match(salesReturnRoute, /migration: e\.migration/)
  assert.match(salesReturnRoute, /status: 409/)
})

test('required docs record the verified legacy production contract and bridge status', () => {
  for (const doc of [clientRequirements, identityPolicy, implementationStatus]) {
    assert.match(doc, /legacy\/original schema|original schema|legacy production schema/)
    assert.match(doc, /00036_legacy_transaction_identity_bridge\.sql/)
    assert.match(doc, /APPLIED in production|applied in production|applied directly to|applied and schema-verified/i)
  }
  assert.match(identityPolicy, /`CAP`[\s\S]+`DRW`[\s\S]+`CS`[\s\S]+`DO`/)
  assert.match(implementationStatus, /00033[\s\S]+00034[\s\S]+00035[\s\S]+not suitable/)
})
