import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { normalizeCodeWord, CODE_WORD_PATTERN, formatNameWithCodeWord } from '../src/lib/accounting/code-words.ts'
import { DOCUMENT_PREFIXES, isDocumentPrefix, formatDocumentNumber } from '../src/lib/identity/generate.ts'

const migration = await readFile('supabase/migrations/00034_code_words_and_prefix_registry.sql', 'utf8')
const identityGenerator = await readFile('src/lib/identity/generate.ts', 'utf8')
const salesAccess = await readFile('src/lib/sales/data-access.ts', 'utf8')
const purchasesAccess = await readFile('src/lib/purchases/data-access.ts', 'utf8')
const prismaSchema = await readFile('prisma/schema.prisma', 'utf8')
const subcategoryRoute = await readFile('src/app/api/account-subcategories/route.ts', 'utf8')
const subcategoryLib = await readFile('src/lib/money/persisted-account-subcategories.ts', 'utf8')
const accountsView = await readFile('src/components/erp/views/accounts-view.tsx', 'utf8')

// ===========================================================================
// Readable code words â€” validation rules
// ===========================================================================

test('code words uppercase-trim to canonical storage form', () => {
  assert.equal(unwrap('  exp-comm  '), 'EXP-COMM')
  assert.equal(unwrap('bank-mzn'), 'BANK-MZN')
  assert.equal(unwrap('CASH'), 'CASH')
})

function unwrap(raw: string): string {
  const result = normalizeCodeWord(raw)
  if (!result.ok) throw new Error(result.error)
  return result.code
}

test('code words reject characters outside letters, numbers and hyphens', () => {
  const bad: Array<string | null> = ['EXP COMM', 'EXP_COM', 'EXP/COMM', 'exp!', 'CASH--BANK', '-LEAD', 'TRAIL-', 'A', '', '   ', null]
  for (const candidate of bad) {
    assert.equal(normalizeCodeWord(candidate).ok, false, `must reject: ${candidate}`)
  }
  assert.match(String(CODE_WORD_PATTERN.source), /^\^/)
})

test('duplicate code rejection surfaces a clear validation error', () => {
  assert.match(subcategoryRoute, /DUPLICATE_CODE_WORD/)
  assert.match(migration, /DUPLICATE_CODE_WORD: code word % is already used in this business/)
  assert.match(migration, /create unique index if not exists account_subcategories_business_code_key/)
})

test('subcategory codes are format-constrained and length-bounded in SQL', () => {
  assert.match(migration, /add constraint account_subcategories_code_format/)
  assert.match(migration, /char_length\(code\) between 2 and 40/)
  assert.match(migration, /code ~ '\^\[A-Z0-9\]\+\(-\[A-Z0-9\]\+\)\*\$'/)
})

test('editing a subcategory code never breaks the parent relation or history', () => {
  // The rename branch updates name + code only; parent_code and IDs stay.
  const renameBranch = migration.slice(migration.indexOf("elsif v_action = 'rename'"), migration.indexOf("elsif v_action = 'archive'"))
  assert.match(renameBranch, /code = coalesce\(v_code, code\)/)
  assert.doesNotMatch(renameBranch, /parent_code =/)
  assert.match(accountsView, /Edit code/)
})

test('create requires a readable code word at API and SQL levels', () => {
  assert.match(subcategoryRoute, /parsed\.data\.action === 'create'/)
  assert.match(subcategoryRoute, /INVALID_CODE_WORD/)
  const createBranch = migration.slice(migration.indexOf("if v_action = 'create'"), migration.indexOf("elsif v_action = 'rename'"))
  assert.match(createBranch, /v_code := public\.normalize_subcategory_code_word\(p_code\)/)
  assert.match(createBranch, /DUPLICATE_OR_INVALID_CODE/)
})

test('listing returns the readable code word for hierarchy display', () => {
  assert.match(migration, /'code', s\.code/)
  assert.match(subcategoryLib, /code: string \| null/)
  assert.match(accountsView, /· \{category\.code\}/)
})

test('backfill is safe, derived once, and collision-resolved', () => {
  assert.match(migration, /where s\.code is null/)
  assert.match(migration, /v_candidate \|\| '-' \|\| v_suffix::text/)
  assert.match(migration, /public\.normalize_subcategory_code_word\(v_row\.name\)/)
})

test('readable code words coexist with numeric CoA codes; migration is additive only', () => {
  assert.match(migration, /add column if not exists code text/)
  assert.match(migration, /alter column code set not null/)
  const ddl = migration.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(ddl, /drop column/)
})

test('migration-absent compatibility: no 500 when p_code schema is missing', () => {
  assert.match(subcategoryLib, /CodeWordSchemaRequiredError/)
  assert.match(subcategoryLib, /PGRST202/)
  assert.match(subcategoryLib, /\.\.\.\(input\.code \? \{ p_code: input\.code \} : \{\}\)/)
  assert.match(subcategoryRoute, /CODE_WORD_SCHEMA_REQUIRED/)
  assert.match(subcategoryRoute, /status: 409/)
  assert.match(subcategoryRoute, /capability\.path === 'operational-fallback' \|\| capability\.path === 'legacy-local'/)
  assert.match(subcategoryRoute, /Server-attributed category actor is unavailable\|list_account_subcategories\|function .* does not exist\|relation .* does not exist\|schema cache/)
  assert.match(subcategoryRoute, /unavailableAccountingPayload\(/)
  assert.match(subcategoryRoute, /hasPermission\(loaded, 'can_manage_setup'\)/)
})

// ===========================================================================
// Transaction identities
// ===========================================================================

test('registry covers the required readable prefixes', () => {
  for (const prefix of ['INV', 'SRT', 'PUR', 'PRT', 'EXP', 'REC', 'PAY', 'CON', 'JRV', 'STA', 'STM', 'OPS', 'RDS', 'COM']) {
    assert.ok(isDocumentPrefix(prefix), `${prefix} must be a supported document prefix`)
    assert.match(migration, new RegExp(`'${prefix}'`))
  }
  assert.ok(DOCUMENT_PREFIXES.length >= 14)
})

test('Prisma paths allocate INV, PUR and PRT through the shared allocator', () => {
  assert.match(salesAccess, /allocateDocumentNumber\(tx, input\.businessId, 'INV'\)/)
  assert.match(purchasesAccess, /allocateDocumentNumber\(tx, input\.businessId, 'PUR'\)/)
  assert.match(purchasesAccess, /allocateDocumentNumber\(tx, input\.businessId, 'PRT'\)/)
  assert.match(identityGenerator, /identitySequence\.upsert/)
  assert.match(identityGenerator, /create: \{ businessId, prefix: normalized, lastSeq: 1 \}/)
  assert.match(identityGenerator, /update: \{ lastSeq: \{ increment: 1 \} \}/)
  assert.doesNotMatch(purchasesAccess, /prefix: 'PRN'/)
})

test('allocation is business-scoped and unique per business + prefix', () => {
  assert.match(prismaSchema, /@@unique\(\[businessId, prefix\]\)/)
  assert.match(migration, /on conflict \(business_id, prefix\)/)
  assert.match(migration, /returning last_seq into v_seq/)
})

test('retry idempotency returns the same identity without burning numbers', () => {
  assert.match(salesAccess, /idempotencyKey: `sale-\$\{input\.idempotencyKey\}`/)
  assert.match(salesAccess, /if \(existingInvoice\) return \{ invoiceId: existingInvoice\.id, invoiceNo: existingInvoice\.invoiceNo \}/)
})

test('document identities are human-readable, never raw UUIDs', () => {
  assert.match(identityGenerator, /formatDocumentNumber/)
  assert.doesNotMatch(identityGenerator, /randomUUID|uuidv4/)
})

test('identity format helper pads with zeros', () => {
  assert.equal(formatDocumentNumber('inv', 1), 'INV-0001')
  assert.equal(formatDocumentNumber('PRT', 12), 'PRT-0012')
  assert.equal(formatDocumentNumber('CON', 42, 6), 'CON-000042')
})

test('formatNameWithCodeWord renders name and code without dropping either', () => {
  assert.match(formatNameWithCodeWord('Sales Commission', 'EXP-COMM'), /^Sales Commission .+ EXP-COMM$/)
  assert.equal(formatNameWithCodeWord('Sales Commission', null), 'Sales Commission')
})
