import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const migration = [
  await readFile('supabase/migrations/00021_account_subcategories.sql', 'utf8'),
  await readFile('supabase/migrations/00029_ledger_account_subcategories.sql', 'utf8'),
].join('\n')
const route = await readFile('src/app/api/account-subcategories/route.ts', 'utf8')
const dataAccess = await readFile('src/lib/money/persisted-account-subcategories.ts', 'utf8')

test('approved parents are business-scoped and one level only', () => {
  for (const parent of ['sales', 'expenses', 'accounts-receivable', 'accounts-payable', 'capital', 'current-assets', 'purchases', 'salesman']) {
    assert.ok(migration.includes(`'${parent}'`))
  }
  assert.match(migration, /business_id uuid not null/)
  assert.doesNotMatch(migration, /parent_subcategory_id|tree_depth|category_path/)
})

test('create, rename, archive, assign, move and Uncategorized persist', () => {
  for (const action of ['create', 'rename', 'archive', 'assign', 'move', 'uncategorize']) {
    assert.ok(migration.includes(`'${action}'`))
    assert.ok(route.includes(`'${action}'`))
  }
  assert.match(migration, /account_id uuid/)
  assert.match(migration, /references public\.ledger_accounts\(business_id, id\)/)
  assert.match(migration, /on conflict \(business_id, account_id\) where account_id is not null do update/)
  assert.match(migration, /subcategory_id is null then 'uncategorize'/)
})

test('duplicate names are normalized per business and parent', () => {
  assert.match(migration, /unique \(business_id, parent_code, normalized_name\)/)
  assert.match(migration, /lower\(trim\(p_name\)\)/)
})

test('classification changes contain no money or posting mutation', () => {
  const manage = migration.slice(migration.indexOf('create or replace function public.manage_account_subcategory'))
  assert.doesNotMatch(manage, /update public\.(?:vouchers|voucher_lines|invoices|payments|products|customers|vendors)/i)
  assert.doesNotMatch(manage, /update public\.ledger_(?:vouchers|voucher_lines)/i)
})

test('report class stays valid for TB, P&L and Balance Sheet consumers', () => {
  for (const reportClass of ['Income', 'Expense', 'Asset', 'Liability', 'Equity']) {
    assert.ok(migration.includes(`'${reportClass}'`))
  }
  assert.match(migration, /Account cannot move between Balance Sheet and Profit and Loss report classes/)
})

test('archived categories remain assigned and historically reportable', () => {
  const archiveStart = migration.indexOf("elsif v_action = 'archive'")
  const archive = migration.slice(archiveStart, migration.indexOf("elsif v_action in ('assign'", archiveStart))
  assert.match(archive, /is_active = false/)
  assert.doesNotMatch(archive, /delete from/)
  assert.match(migration, /on delete restrict/)
})

test('permissions fail closed in both route and RPC', () => {
  assert.match(route, /can_manage_account_categories/)
  assert.match(route, /FORBIDDEN/)
  assert.match(migration, /Profile cannot manage account subcategories/)
  assert.match(migration, /pr\.business_id = p_business_id/)
})

test('every mutation is audited and reload uses the persisted RPC', () => {
  assert.match(migration, /insert into public\.account_classification_audit/)
  assert.match(dataAccess, /list_account_subcategories/)
  assert.match(dataAccess, /manage_account_subcategory/)
})
