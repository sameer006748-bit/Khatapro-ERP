import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const migration = await readFile('supabase/migrations/00020_transaction_identity_coverage.sql', 'utf8')
const phase19 = await readFile('supabase/migrations/00019_rider_partial_delivery.sql', 'utf8')

test('all required transaction types have explicit non-uniform prefixes', () => {
  const expected: Record<string, string> = {
    COUNTER_SALE: 'INV', ONLINE_SALE: 'INV', OFC_SALE: 'INV', OTHER_SALE: 'INV',
    SALE_RETURN: 'SR', PURCHASE: 'PUR', PURCHASE_RETURN: 'PRN',
    RECEIPT_VOUCHER: 'RV', PAYMENT_VOUCHER: 'PV', JOURNAL_VOUCHER: 'JV',
    CONTRA_BATCH: 'CTB', CAPITAL_INTRODUCED: 'CAP', OWNER_DRAWING: 'DRW',
    STOCK_ADJUSTMENT: 'SA', OPENING_STOCK: 'OS',
    RIDER_COD_SETTLEMENT: 'RCS', COMMISSION_SETTLEMENT: 'CMS',
  }
  for (const [type, prefix] of Object.entries(expected)) {
    assert.match(migration, new RegExp(`when '${type}' then '${prefix}'`, 'i'))
  }
  assert.ok(new Set(Object.values(expected)).size > 10)
})

test('migration 00034 re-issues the readable docs registry without erasing legacy mappings', async () => {
  const registry = await readFile('supabase/migrations/00034_code_words_and_prefix_registry.sql', 'utf8')
  const readable: Record<string, string> = {
    SALE_RETURN: 'SRT', PURCHASE_RETURN: 'PRT', RECEIPT_VOUCHER: 'REC',
    PAYMENT_VOUCHER: 'PAY', JOURNAL_VOUCHER: 'JRV', CONTRA_BATCH: 'CON',
    STOCK_ADJUSTMENT: 'STA', OPENING_STOCK: 'OPS',
    RIDER_COD_SETTLEMENT: 'RDS', COMMISSION_SETTLEMENT: 'COM',
  }
  for (const [type, prefix] of Object.entries(readable)) {
    assert.match(registry, new RegExp(`when '${type}' then '${prefix}'`, 'i'))
  }
  // Legacy prefixes stay accepted by the allocator — historical identities and
  // replays must never fail after the registry upgrade.
  for (const legacy of ['SR', 'PRN', 'RV', 'PV', 'JV', 'CTB', 'SA', 'OS', 'RCS', 'CMS', 'CAP', 'DRW', 'CS', 'DO']) {
    assert.ok(registry.includes(`'${legacy}'`), `legacy prefix ${legacy} must remain accepted`)
  }
  assert.match(registry, /when 'RC' then 'REC'[\s\S]*when 'PM' then 'PAY'[\s\S]*when 'CT' then 'CON'/)
})

test('allocator is row-locking, business-scoped and rollback-safe', () => {
  assert.match(migration, /insert into public\.identity_sequences \(business_id, prefix, last_seq\)/i)
  assert.match(migration, /on conflict \(business_id, prefix\)[\s\S]{0,100}last_seq \+ 1/i)
  assert.match(migration, /returning last_seq into v_seq/i)
  assert.doesNotMatch(migration, /commit;[\s\S]*create or replace function public\.allocate_readable_identity/i)
})

test('legacy initialization ignores malformed rows and never moves backward', () => {
  assert.match(migration, /where %I ~ %L/i)
  assert.match(migration, /substring\(%I from %L\)/i)
  assert.match(migration, /greatest\([\s\S]{0,100}last_seq/i)
})

test('existing poster compatibility functions contain no last-row allocation', () => {
  for (const fn of ['next_invoice_no', 'next_purchase_no', 'next_purchase_return_no', 'next_cod_submission_no', 'next_document_no']) {
    const start = migration.indexOf(`function public.${fn}`)
    assert.ok(start >= 0, `${fn} must exist`)
    const body = migration.slice(start, migration.indexOf('end $$;', start) + 7)
    assert.doesNotMatch(body, /max\s*\(/i)
    assert.match(body, /allocate_(?:transaction_identity|readable_identity)/i)
  }
})

test('Sale Return unsafe candidate is replaced atomically before insert', () => {
  assert.match(migration, /before insert on public\.sale_return_documents/i)
  assert.match(migration, /new\.return_no := public\.allocate_transaction_identity\(new\.business_id, 'SALE_RETURN'\)/i)
})

test('stock adjustment and opening stock numbers are persisted and unique', () => {
  assert.match(migration, /add column if not exists readable_no text/i)
  assert.match(migration, /stock_movements_business_readable_no_idx/i)
  assert.match(migration, /'OPENING_STOCK'/)
  assert.match(migration, /'STOCK_ADJUSTMENT'/)
})

test('Phase 1 delivery identities use the same safe allocator', () => {
  assert.match(phase19, /allocate_readable_identity\(p_business_id, 'DO'\)/)
  assert.match(migration, /when 'DELIVERY_OUTCOME' then 'DO'/i)
})

test('identity functions fail closed to service role and audit source is protected', () => {
  assert.match(migration, /revoke all on function public\.allocate_readable_identity\(uuid, text\) from public, anon, authenticated/i)
  assert.match(migration, /grant execute on function public\.allocate_readable_identity\(uuid, text\) to service_role/i)
  assert.match(migration, /alter table public\.transaction_identity_audit enable row level security/i)
})
