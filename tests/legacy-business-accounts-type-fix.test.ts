import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/00041_legacy_business_accounts_type_fix.sql'), 'utf8')

function functionBody(name: string): string {
  const match = migration.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    'i',
  ))
  assert.ok(match, `${name} must exist in 00041`)
  return match[0]
}

test('00041 recreates all four Business Accounts RPCs with the uuid/text cast', () => {
  for (const fn of [
    'list_business_accounts', 'create_business_account',
    'update_business_account', 'delete_business_account',
  ]) {
    const body = functionBody(fn)
    assert.match(body, /p\.id = p_actor_profile_id::text/, `${fn} must cast the uuid param to text`)
    assert.doesNotMatch(body, /p\.id = p_actor_profile_id(?!::)/, `${fn} must not compare text to uuid un-cast`)
    assert.match(body, /security definer/i)
    assert.match(body, /set search_path = public/i)
  }
})

test('00041 is service-role contained and additive', () => {
  for (const fn of [
    'list_business_accounts', 'create_business_account',
    'update_business_account', 'delete_business_account',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}[\\s\\S]*from public, anon, authenticated`, 'i'))
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*to service_role`, 'i'))
  }
  assert.match(migration, /extensions\.digest/)
  assert.doesNotMatch(migration, /public\.ledger_|public\.businesses\b/)
  assert.match(migration, /notify pgrst, 'reload schema'/)
})

test('00041 preflight guards the fix premise (profiles.id is text) and the four RPCs', () => {
  assert.ok(migration.includes("to_regprocedure('public.list_business_accounts(text, uuid)')"), 'list preflight')
  assert.ok(migration.includes("to_regprocedure('public.delete_business_account(text, text, uuid)')"), 'delete preflight')
  assert.match(migration, /information_schema\.columns/)
  assert.match(migration, /table_name = 'profiles'[\s\S]*column_name = 'id'[\s\S]*data_type = 'text'/)
})
