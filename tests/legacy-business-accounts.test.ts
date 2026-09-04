import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/00040_legacy_business_accounts.sql'), 'utf8')
const collectionRoute = fs.readFileSync(path.join(root, 'src/app/api/setup/business-accounts/route.ts'), 'utf8')
const itemRoute = fs.readFileSync(path.join(root, 'src/app/api/setup/business-accounts/[id]/route.ts'), 'utf8')
const service = fs.readFileSync(path.join(root, 'src/lib/accounting/legacy-business-accounts.ts'), 'utf8')
const view = fs.readFileSync(path.join(root, 'src/components/erp/views/business-accounts-view.tsx'), 'utf8')

function functionBody(name: string): string {
  const match = migration.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    'i',
  ))
  assert.ok(match, `${name} must exist`)
  return match[0]
}

test('configured legacy schema selects service-role RPCs before any Prisma access', () => {
  for (const route of [collectionRoute, itemRoute]) {
    assert.match(route, /isSupabaseConfigured\(\)/)
    assert.match(route, /usesLegacyTransactionSchema\(\)/)
    assert.ok(
      route.indexOf('usesLegacyTransactionSchema()') < route.indexOf('db.businessAccount'),
      'legacy detection must precede Prisma access',
    )
    assert.doesNotMatch(route, /getAccountingAvailability|ACCOUNTING_MIGRATION_REQUIRED/)
  }
  assert.match(collectionRoute, /listLegacyBusinessAccounts/)
  assert.match(collectionRoute, /createLegacyBusinessAccount/)
  assert.match(itemRoute, /updateLegacyBusinessAccount/)
  assert.match(itemRoute, /deleteLegacyBusinessAccount/)
})

test('local unconfigured behavior retains the existing Prisma implementation', () => {
  assert.match(collectionRoute, /db\.businessAccount\.findMany/)
  assert.match(collectionRoute, /db\.\$transaction/)
  assert.match(collectionRoute, /tx\.account\.create/)
  assert.match(collectionRoute, /tx\.businessAccount\.create/)
  assert.match(itemRoute, /tx\.businessAccount\.update/)
  assert.match(itemRoute, /tx\.account\.update/)
})

test('migration is legacy-only, preflighted, and service-role contained', () => {
  for (const relation of [
    'business', 'profiles', 'accounts', 'account_categories', 'business_accounts',
    'audit_logs', 'payment_allocations', 'voucher_lines', 'purchase_payments',
    'legacy_transaction_identity_requests',
  ]) {
    assert.match(migration, new RegExp(`to_regclass\\('public\\.${relation}'\\)`))
  }
  assert.doesNotMatch(migration, /public\.ledger_|public\.businesses\b/)
  for (const fn of [
    'list_business_accounts', 'create_business_account',
    'update_business_account', 'delete_business_account',
  ]) {
    const body = functionBody(fn)
    assert.match(body, /security definer/i)
    assert.match(body, /set search_path = public/i)
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}[\\s\\S]*from public, anon, authenticated`, 'i'))
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*to service_role`, 'i'))
  }
  assert.doesNotMatch(migration, /grant execute[\s\S]*to (?:public|anon|authenticated)/i)
})

test('create is atomic, idempotent, business-scoped, and writes the established audit record', () => {
  const body = functionBody('create_business_account')
  assert.match(body, /from public\.business b where b\.id = p_business_id/)
  assert.match(body, /p\.business_id = p_business_id[\s\S]*p\.is_active = true/)
  assert.match(body, /c\.business_id = p_business_id and c\.code = 'ASSET'/)
  assert.match(body, /claim_legacy_transaction_request\([\s\S]*'business_account_create'/)
  assert.match(body, /request_fingerprint/)
  assert.match(body, /return v_replay \|\| jsonb_build_object\('idempotent', true\)/)
  assert.match(body, /insert into public\.accounts/)
  assert.match(body, /insert into public\.business_accounts/)
  assert.match(body, /insert into public\.audit_logs/)
  assert.ok(
    body.indexOf('insert into public.accounts') < body.indexOf('insert into public.business_accounts'),
    'linked ledger row must be created before its business-account row',
  )
  assert.doesNotMatch(body, /exception[\s\S]*commit|begin;[\s\S]*commit;/i)
})

test('account code allocation is locked, valid, and skips seeded control ranges', () => {
  const body = functionBody('create_business_account')
  assert.match(body, /pg_advisory_xact_lock\(hashtextextended\('business-account-code:' \|\| p_business_id, 0\)\)/)
  assert.match(body, /v_code_number := 1060/)
  assert.match(body, /if v_code_number = 1100 then v_code_number := 1900/)
  assert.match(body, /where a\.business_id = p_business_id and a\.code = v_code/)
  assert.match(migration, /unique business\/code constraint/i)
  assert.doesNotMatch(body, /select\s+max\s*\(/i)
})

test('list and update preserve client shape, linkage, active state, and business isolation', () => {
  const list = functionBody('list_business_accounts')
  const update = functionBody('update_business_account')
  assert.match(list, /where ba\.business_id = p_business_id/)
  assert.match(list, /coalesce\(a\.balance_cache, 0\)/)
  assert.match(update, /where ba\.id = p_business_account_id and ba\.business_id = p_business_id/)
  assert.match(update, /update public\.business_accounts/)
  assert.match(update, /update public\.accounts set/)
  assert.match(update, /p_update_is_active/)
  for (const field of [
    'id', 'account_id', 'name', 'type', 'account_holder', 'bank_name',
    'account_number', 'is_active', 'account_code', 'balance_paisas',
  ]) {
    assert.match(migration, new RegExp(`\\b${field}\\b`))
  }
})

test('delete is guarded by all established history references and otherwise deletes the linked pair', () => {
  const body = functionBody('delete_business_account')
  assert.match(body, /from public\.payment_allocations[\s\S]*business_id = p_business_id/)
  assert.match(body, /from public\.voucher_lines[\s\S]*business_id = p_business_id/)
  assert.match(body, /from public\.purchase_payments[\s\S]*business_id = p_business_id/)
  assert.match(body, /coalesce\(v_row\.balance_cache, 0\) <> 0/)
  assert.match(body, /'error', 'ACCOUNT_IN_USE'/)
  assert.ok(
    body.indexOf('delete from public.business_accounts') < body.indexOf('delete from public.accounts'),
    'the linked child must be deleted before its account',
  )
  // Both delete branches answer with the one shared, readable refusal.
  assert.match(itemRoute, /message: ACCOUNT_IN_USE_MESSAGE/)
  assert.match(
    fs.readFileSync(path.join(root, 'src/lib/accounting/business-account-types.ts'), 'utf8'),
    /'This account has transaction history and cannot be deleted\. Deactivate it instead\.'/,
  )
})

test('missing 00040 fails with clean UX and no backend terminology in client response', () => {
  assert.match(service, /class LegacyBusinessAccountsUnavailableError/)
  assert.match(service, /classifyPostgrestCompatibilityError\(error\) === 'missing-rpc'/)
  assert.match(service, /This feature is currently unavailable\./)
  assert.match(collectionRoute, /error: 'FEATURE_UNAVAILABLE'/)
  for (const route of [collectionRoute, itemRoute]) {
    const response = route.match(/function unavailableResponse\(\) \{[\s\S]*?\n\}/)?.[0]
    assert.ok(response)
    assert.doesNotMatch(response, /migration|schema|Supabase|RPC/i)
  }
  assert.match(view, /j\?\.message \?\? j\?\.error/)
})

test('create submission sends a retry key without exposing it in response data', () => {
  assert.match(view, /'x-idempotency-key': idempotencyKey/)
  assert.match(view, /createMut\.mutate\(\{ payload, idempotencyKey: crypto\.randomUUID\(\) \}\)/)
  assert.match(collectionRoute, /req\.headers\.get\('x-idempotency-key'\)/)
  assert.doesNotMatch(collectionRoute, /['"]idempotencyKey['"]\s*:/)
  assert.doesNotMatch(collectionRoute, /['"]idempotency_key['"]\s*:/)
})