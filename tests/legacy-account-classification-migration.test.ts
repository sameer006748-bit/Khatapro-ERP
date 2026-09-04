import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const migration = await readFile(
  'supabase/migrations/00042_legacy_account_classification.sql',
  'utf8',
)
const businessAccounts = await readFile(
  'supabase/migrations/00041_legacy_business_accounts_type_fix.sql',
  'utf8',
)
const businessAccountDataAccess = await readFile(
  'src/lib/accounting/legacy-business-accounts.ts',
  'utf8',
)

test('migration is transactional, legacy-only, and never applies itself', () => {
  assert.match(migration, /^--[\s\S]*\r?\nbegin;/)
  assert.match(migration, /notify pgrst, 'reload schema';\r?\ncommit;\s*$/)
  assert.doesNotMatch(migration, /public\.businesses|public\.ledger_accounts|public\.account_subcategories/)
  assert.doesNotMatch(migration, /apply_migration|supabase db push|post_sale/)
  assert.match(migration, /c\.udt_name = 'text'/)
})

test('first-apply preflight preserves exactly the five fixed roots and aborts on surprises', () => {
  for (const [code, type] of [
    ['ASSET', 'Asset'],
    ['LIABILITY', 'Liability'],
    ['EQUITY', 'Equity'],
    ['INCOME', 'Income'],
    ['EXPENSE', 'Expense'],
  ]) {
    assert.match(migration, new RegExp(`\\('${code}', '${type}'\\)`))
  }
  assert.match(migration, /\) <> 5/)
  assert.match(migration, /Unexpected legacy account category state for business/)
  assert.match(migration, /Cross-business or missing account category references/)
})

test('root backfill is explicit and leaves existing account links unchanged', () => {
  const backfill = migration.slice(
    migration.indexOf('-- Additive hierarchy and lifecycle columns.'),
    migration.indexOf('-- Database-enforced hierarchy, lifecycle, and system-account invariants.'),
  )
  assert.match(migration, /set parent_id = null,[\s\S]*root_id = id,[\s\S]*depth = 0,[\s\S]*is_active = true,[\s\S]*is_system = true/)
  assert.match(migration, /where depth is null/)
  assert.doesNotMatch(backfill, /update public\.accounts\s+set category_id/i)
  assert.match(migration, /Existing accounts remain valid when linked directly to a depth-0 root/)
})

test('hierarchy columns, business-scoped keys, depth, and sibling uniqueness are enforced', () => {
  for (const column of ['parent_id text', 'root_id text', 'depth smallint', 'is_active boolean', 'is_system boolean']) {
    assert.ok(migration.includes(column), `missing ${column}`)
  }
  assert.match(migration, /foreign key \(business_id, parent_id\)[\s\S]*account_categories\(business_id, id\)/)
  assert.match(migration, /foreign key \(business_id, root_id\)[\s\S]*account_categories\(business_id, id\)/)
  assert.match(migration, /foreign key \(business_id, category_id\)[\s\S]*account_categories\(business_id, id\)/)
  assert.match(migration, /check \(depth between 0 and 2\)/)
  assert.match(migration, /account_categories_sibling_name_key[\s\S]*lower\(btrim\(name\)\)[\s\S]*where depth in \(1, 2\)/)
  assert.doesNotMatch(migration, /add constraint if not exists/i)
})

test('root and cross-root mutations are blocked by invariant triggers', () => {
  assert.match(migration, /Fixed accounting roots cannot be deleted/)
  assert.match(migration, /Fixed accounting roots are immutable/)
  assert.match(migration, /New accounting roots cannot be created/)
  assert.match(migration, /Parent, root, depth and accounting type must agree/)
  assert.match(migration, /Ledger accounts cannot move across fixed accounting roots/)
  assert.match(migration, /accounts_classification_guard/)
  assert.match(migration, /account_categories_hierarchy_guard/)
})

test('inactive classification and unsafe delete behavior fail closed', () => {
  assert.match(migration, /Deactivate active child subcategories first/)
  assert.match(migration, /Deactivate or reclassify active ledger accounts first/)
  assert.match(migration, /Reactivate the parent category first/)
  assert.match(migration, /Category with child subcategories cannot be deleted/)
  assert.match(migration, /Category linked to ledger accounts cannot be deleted/)
  assert.match(migration, /Inactive classifications are deliberately included/)
})

test('5010 and 5030 are verified and protected without locking 5020', () => {
  assert.match(migration, /system_account\.code = '5010'[\s\S]*system_account\.name = 'Purchases \/ COGS'/)
  assert.match(migration, /system_account\.code = '5030'[\s\S]*system_account\.name = 'Salesman Commission Expense'/)
  const systemBackfill = migration.match(/update public\.accounts\s+set is_system = true\s+where code in \(([^)]+)\);/i)
  assert.ok(systemBackfill)
  assert.match(systemBackfill[1], /'5010'/)
  assert.match(systemBackfill[1], /'5030'/)
  assert.doesNotMatch(systemBackfill[1], /'5020'/)
  assert.match(migration, /System-managed ledger accounts cannot be renamed, reclassified, deactivated or deleted/)
})

test('management RPCs use text legacy identities and are service-role only', () => {
  for (const rpc of [
    'list_account_classification',
    'manage_account_category',
    'manage_account_subcategory',
    'manage_manual_ledger_account',
  ]) {
    assert.match(migration, new RegExp(`function public\\.${rpc}\\(`))
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}\\([\\s\\S]*?to service_role;`))
    assert.match(migration, new RegExp(`revoke all on function public\\.${rpc}\\([\\s\\S]*?from public, anon, authenticated;`))
  }
  assert.match(migration, /p_business_id text,\s+p_actor_profile_id text/)
  assert.match(migration, /p\.id = p_actor_profile_id[\s\S]*p\.business_id = p_business_id[\s\S]*p\.is_active/)
  assert.match(migration, /can_manage_setup/)
  assert.match(migration, /can_manage_account_categories/)
  assert.match(migration, /Account classification access denied.*42501/)
})

test('category, subcategory, classification, and account lifecycle changes are audited safely', () => {
  assert.match(migration, /ACCOUNT_CATEGORY_' \|\| upper\(v_action\)/)
  assert.match(migration, /ACCOUNT_SUBCATEGORY_' \|\| upper\(v_action\)/)
  assert.match(migration, /MANUAL_LEDGER_ACCOUNT_' \|\| upper\(v_action\)/)
  assert.match(migration, /jsonb_build_object\('before', v_before, 'after', v_after\)/)
  assert.doesNotMatch(migration, /'(?:password|secret|token|credential)'/i)
})

test('Business Accounts stays compatible with account guards and RLS hardening', () => {
  assert.match(businessAccountDataAccess, /getAdminSupabase\(\)\.rpc\('create_business_account'/)
  assert.match(businessAccountDataAccess, /getAdminSupabase\(\)\.rpc\('update_business_account'/)
  assert.match(businessAccountDataAccess, /getAdminSupabase\(\)\.rpc\('delete_business_account'/)
  assert.match(businessAccounts, /grant execute on function public\.create_business_account[\s\S]*to service_role/)
  assert.match(businessAccounts, /update public\.accounts set[\s\S]*name = case[\s\S]*is_active = case/)
  assert.match(migration, /if tg_op = 'UPDATE' and old\.is_system then/)
  assert.match(migration, /revoke insert, update, delete on public\.accounts from anon, authenticated/)
  assert.doesNotMatch(migration, /drop function.*business_account/is)
})

test('existing select policies remain and only direct mutation policies are removed', () => {
  assert.match(migration, /drop policy if exists acct_cat_manage_perms/)
  assert.match(migration, /drop policy if exists accounts_manage_perms/)
  assert.doesNotMatch(migration, /drop policy if exists acct_cat_select_own/)
  assert.doesNotMatch(migration, /drop policy if exists accounts_select_own/)
  assert.doesNotMatch(migration, /drop policy if exists "categories_read_same_business"/)
  assert.doesNotMatch(migration, /drop policy if exists "accounts_read_same_business"/)
})
