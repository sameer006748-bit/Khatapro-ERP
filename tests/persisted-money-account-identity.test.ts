import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const migrationPath = 'supabase/migrations/20260904161347_persist_business_account_identity.sql'
const migration = await readFile(migrationPath, 'utf8')
const identity = await readFile('src/lib/accounting/money-account-identity.ts', 'utf8')
const access = await readFile('src/lib/accounting/legacy-business-accounts.ts', 'utf8')
const collection = await readFile('src/app/api/setup/business-accounts/route.ts', 'utf8')
const item = await readFile('src/app/api/setup/business-accounts/[id]/route.ts', 'utf8')
const link = await readFile('src/app/api/setup/business-accounts/link/route.ts', 'utf8')
const audit = await readFile('src/app/api/audit-logs/route.ts', 'utf8')

test('migration is gated, transactional, and adds exactly one persisted data column', () => {
  assert.match(migration, /^--[\s\S]*\nbegin;/)
  assert.match(migration, /notify pgrst, 'reload schema';\s*\n\s*commit;\s*$/)
  assert.equal(
    migration.match(/alter table public\.business_accounts add column/gi)?.length,
    1,
  )
  assert.match(migration, /add column identity text/)
  assert.match(migration, /unexpected business_accounts column types/)
  assert.match(migration, /UNIQUE \(account_id\)/)
  for (const signature of [
    'list_business_accounts(text,uuid)',
    'create_business_account(text,text,text,text,text,text,uuid,text)',
    'update_business_account(text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,uuid)',
    'delete_business_account(text,text,uuid)',
  ]) assert.ok(migration.includes(`to_regprocedure('public.${signature}')`), signature)
})

test('backfill is deterministic, reserves seeded identities, and aborts unsafe names', () => {
  assert.match(migration, /when '1010' then 'CASH'/)
  assert.match(migration, /when '1020' then 'PETTY-CASH'/)
  assert.match(migration, /when '1030' then 'BANK'/)
  assert.match(migration, /when '1040' then 'EASYPAISA'/)
  assert.match(migration, /when '1050' then 'JAZZCASH'/)
  assert.match(migration, /a\.code is distinct from btrim\(coalesce\(p_account_code, ''\)\)/)
  assert.match(migration, /order by ba\.business_id, ba\.created_at, ba\.id/)
  assert.match(migration, /A readable Business Account identity cannot be derived from this name/)
  assert.match(migration, /No safe unique readable Business Account identity is available/)
  assert.doesNotMatch(migration, /random_uuid|gen_random_uuid\(\)/i)
  assert.doesNotMatch(migration, /v_base\s*:=\s*(?:a\.)?code/i)
})

test('database constraints make identity readable, scoped, required, and immutable', () => {
  assert.match(migration, /alter column identity set not null/)
  assert.match(migration, /char_length\(identity\) between 1 and 40/)
  assert.match(migration, /identity ~ '\^\[A-Z\]\[A-Z0-9\]\*\(-\[A-Z0-9\]\+\)\*\$'/)
  assert.match(migration, /unique \(business_id, identity\)/)
  assert.match(migration, /if new\.identity is distinct from old\.identity/)
  assert.match(migration, /Business Account identity is immutable/)
})

test('create and bridge allocate in the insert transaction while relink stays idempotent', () => {
  assert.match(migration, /before insert or update of identity on public\.business_accounts/)
  assert.match(migration, /new\.identity := public\.allocate_business_account_identity/)
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('business-account-identity:' \|\| p_business_id, 0\)\)/)
  assert.match(access, /insertError\.code !== '23505'/)
  assert.match(access, /alreadyLinked: Boolean\(existing\)/)
  assert.match(access, /listLegacyBusinessAccounts\(input\.businessId, input\.actorProfileId\)/)
  assert.doesNotMatch(link, /tx\.account\.create|admin\.from\('accounts'\)\.insert/)
})

test('stored v2 reads are authoritative without changing the four legacy RPC contracts', () => {
  assert.match(migration, /create or replace function public\.list_business_accounts_v2/)
  for (const oldRpc of [
    'list_business_accounts',
    'create_business_account',
    'update_business_account',
    'delete_business_account',
  ]) {
    assert.doesNotMatch(migration, new RegExp(`create or replace function public\\.${oldRpc}\\(`))
    assert.doesNotMatch(migration, new RegExp(`drop function.*${oldRpc}`, 'i'))
  }
  assert.match(access, /rpc\('list_business_accounts_v2'/)
  assert.match(access, /classifyPostgrestCompatibilityError\(v2\.error\) !== 'missing-rpc'/)
  assert.match(access, /rpc\('list_business_accounts'/)
  assert.match(collection, /identity: row\.identity/)
  assert.match(collection, /row\.identity \?\? deriveMoneyIdentity/)
  assert.match(item, /row\.identity \?\? deriveMoneyIdentity/)
})

test('rename, Cash/Bank moves, and activation changes never write identity', () => {
  const updateCall = access.slice(
    access.indexOf("rpc('update_business_account'"),
    access.indexOf('if (error) unavailable(error)', access.indexOf("rpc('update_business_account'")),
  )
  assert.doesNotMatch(updateCall, /p_identity|identity:/)
  assert.match(item, /identity: input\.after\.identity/)
  assert.match(item, /before: input\.before/)
  assert.match(item, /after: input\.after/)
})

test('new audit details are readable and raw internal ids are filtered', () => {
  assert.match(migration, /create trigger audit_logs_business_account_identity/)
  assert.match(migration, /'name', v_name[\s\S]*'identity', v_identity[\s\S]*'ledgerCode', v_ledger_code/)
  assert.match(migration, /- 'ledgerAccountId' - 'accountId' - 'businessId' - 'userId'/)
  assert.match(audit, /INTERNAL_DETAIL_KEY/)
  for (const key of ['ledgerAccountId', 'accountId', 'businessId', 'userId', 'profileId']) {
    assert.ok(audit.includes(key), key)
  }
  assert.doesNotMatch(identity, /randomUUID|uuidv4|crypto\./)
})
