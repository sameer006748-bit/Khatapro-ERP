import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const classification = await readFile('src/lib/money/account-subcategories.ts', 'utf8')
const moneyView = await readFile('src/components/erp/views/accounts-view.tsx', 'utf8')
const navigation = await readFile('src/components/erp/dashboard-shell.tsx', 'utf8')
const homeHook = await readFile('src/hooks/use-owner-dashboard.ts', 'utf8')
const foundationTest = await readFile('tests/phase1-foundation.test.ts', 'utf8')

test('system definitions provide stable parent and one-level subcategory IDs', () => {
  for (const id of ['sales', 'expenses', 'accounts-receivable', 'accounts-payable', 'purchases', 'capital', 'current-assets', 'salesman']) assert.match(classification, new RegExp(`id: '${id}'`))
  assert.match(classification, /as const satisfies readonly AccountCategoryDefinition\[\]/)
  assert.doesNotMatch(classification, /AccountSubcategory = \{[^}]*subcategories/i)
})

test('useful labels, Uncategorized fallback, and existing activity compatibility are present', () => {
  for (const label of ['Rent', 'Salary', 'Utilities', 'Delivery', 'Marketing', 'Miscellaneous', 'Cash', 'Bank', 'Wallet', 'Petty Cash', 'Owner Capital', 'Drawings', 'Counter Sale', 'Online Sale', 'OFC Sale']) assert.ok(classification.includes(label), label)
  assert.match(classification, /UNCATEGORIZED_CATEGORY/)
  assert.match(classification, /voucherType\?: string \| null/)
})

test('parent totals include classified children and filtering is subcategory-specific', () => {
  assert.match(classification, /parent\.amount \+= entry\.amount/)
  assert.match(classification, /child\.amount \+= entry\.amount/)
  assert.match(classification, /entry\.parentId === parentId && \(subcategoryId === undefined \|\| entry\.subcategoryId === subcategoryId\)/)
  assert.match(moneyView, /matchesAccountSubcategory\(item, filter\.parentId, filter\.subcategoryId\)/)
})

test('classification is presentation-only and does not alter balances or post accounting records', () => {
  assert.match(classification, /never writes accounting records/)
  assert.doesNotMatch(classification, /fetch\(|\.insert\(|\.update\(|from\('/i)
  assert.match(moneyView, /does not change balances or create entries/)
})

test('Money UI uses compact expandable mobile-safe grouping and clear empty state', () => {
  assert.match(moneyView, /Simple Categories/)
  assert.match(moneyView, /setExpanded/)
  assert.match(moneyView, /flex flex-wrap gap-2/)
  assert.match(moneyView, /No recent activity in this subcategory/)
  assert.match(moneyView, /Clear filter/)
})

test('existing Money and Advanced Accounting permission navigation is unchanged', () => {
  assert.match(navigation, /key: 'accounts'.*perm: 'can_view_account_balances'/s)
  assert.match(navigation, /label: 'Advanced Accounting'/)
  assert.doesNotMatch(moneyView, /permissions\.push|can_view_account_balances/)
})

test('production-absent accounts tables are not introduced by this classification layer', () => {
  assert.doesNotMatch(classification, /account_categories|public\.accounts|from\('accounts'\)/)
  assert.match(foundationTest, /prisma-only table absent: accounts/)
  assert.match(foundationTest, /prisma-only table absent: account_categories/)
})

test('Home date-range query behavior remains shared and untouched', () => {
  assert.match(homeHook, /queryKey: \['owner-dashboard', range\.from, range\.to\]/)
  assert.match(homeHook, /URLSearchParams\(\{ from: range\.from, to: range\.to \}\)/)
})

test('no migration changed', () => {
  const changed = execFileSync('git', ['diff', '--name-only', '9295e78d3d375c3eaa9d553cf83908b92a5d8164'], { encoding: 'utf8' })
  assert.doesNotMatch(changed, /^supabase\/migrations\//m)
})
