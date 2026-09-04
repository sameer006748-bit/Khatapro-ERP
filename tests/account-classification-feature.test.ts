/**
 * Simplified account classification: one level of user categories under the five
 * fixed accounting roots, the ledger account behind each category maintained by
 * the server, and Expense Batch posting against a plain category.
 *
 * The RPCs from 00042_legacy_account_classification.sql own every rule
 * (hierarchy, lifecycle, system accounts, isolation), so these are
 * source-contract assertions over the application seam: that the app composes
 * those RPCs instead of restating them, that no screen decides a posting rule
 * for itself, and — the part with real money behind it — that no report total is
 * ever derived from a classification.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const dataAccess = await source('src/lib/accounting/legacy-account-classification.ts')
const categoryLedger = await source('src/lib/accounting/category-ledger.ts')
const classificationApi = await source('src/app/api/account-classification/route.ts')
const client = await source('src/lib/accounting/classification-client.ts')
const setupView = await source('src/components/erp/views/account-classification-view.tsx')
const expenseView = await source('src/components/erp/views/expense-batch-view.tsx')
const expenseApi = await source('src/app/api/expense-batch/route.ts')
const vouchers = await source('src/lib/vouchers/data-access.ts')
const accountsView = await source('src/components/erp/views/accounts-view.tsx')
const coaView = await source('src/components/erp/views/coa-view.tsx')
const trialBalanceApi = await source('src/app/api/trial-balance/route.ts')
const trialBalanceView = await source('src/components/erp/views/trial-balance-view.tsx')
const reportsApi = await source('src/app/api/reports/route.ts')
const reportsView = await source('src/components/erp/views/reports-view.tsx')
const auditView = await source('src/components/erp/views/audit-log-view.tsx')

// ---------------------------------------------------------------------------
// Categories — one level under the five fixed accounting roots
// ---------------------------------------------------------------------------

test('classification reads and writes go through the service-role RPCs only', () => {
  assert.match(dataAccess, /import 'server-only'/)
  assert.match(dataAccess, /getAdminSupabase\(\)\.rpc\('list_account_classification'/)
  assert.match(dataAccess, /getAdminSupabase\(\)\.rpc\('manage_account_category'/)
  assert.match(dataAccess, /getAdminSupabase\(\)\.rpc\('manage_manual_ledger_account'/)
  // No Prisma shadow of the hierarchy: a configured Supabase production is the
  // only source of classification truth.
  assert.doesNotMatch(dataAccess, /\bdb\.account/)
  assert.doesNotMatch(dataAccess, /from '@\/lib\/db'/)
})

test('the automatic ledger account is composed from those same RPCs', () => {
  assert.match(categoryLedger, /import 'server-only'/)
  assert.match(categoryLedger, /manageManualLedgerAccount\(\{[\s\S]{0,120}action: 'create'/)
  // Never a shortcut around the RPC: this module writes no account row itself.
  assert.doesNotMatch(categoryLedger, /\.insert\(/)
})

test('a category can be created under each of the five fixed roots', () => {
  // The screen offers Add category on every root the server returned, and the
  // create carries that root's id — nothing here is hard-coded to Expense.
  assert.match(setupView, /roots\.map\(\(root\) => \{/)
  assert.match(setupView, /scope: 'category', action: 'create', rootId: root\.id, name: adding\.value\.trim\(\)/)
  for (const [type, hint] of [
    ['Asset', 'e\\.g\\. Office Equipment'],
    ['Liability', 'e\\.g\\. Short Term Loan'],
    ['Equity', 'e\\.g\\. Owner Capital'],
    ['Income', 'e\\.g\\. Service Income'],
    ['Expense', 'e\\.g\\. Lunch Expense'],
  ] as const) {
    assert.match(setupView, new RegExp(`${type}: '${hint}'`), `${type} needs its own example`)
  }
  // Each root has its own code band, so an automatic account is numbered like
  // the seeded chart of accounts instead of appended to one list.
  for (const [type, band] of [
    ['Asset', 1000], ['Liability', 2000], ['Equity', 3000], ['Income', 4000], ['Expense', 5000],
  ] as const) {
    assert.match(categoryLedger, new RegExp(`${type}: ${band},`), `${type} needs its own code band`)
  }
})

test('creating a category also creates the ledger account behind it', () => {
  assert.match(classificationApi, /manageAccountCategory\(\{[\s\S]{0,80}action: 'create', rootId: input\.rootId, name: input\.name,/)
  assert.match(classificationApi, /const ledger = await ensureCategoryLedgerAccount\(actor, tree, category\)/)
  assert.match(classificationApi, /if \(ledger\.created\) \{/)
  // Categories that predate this workflow are linked the next time somebody who
  // may manage the classification loads the tree, so none stays unpostable.
  assert.match(categoryLedger, /export async function ensureCategoryLedgerAccounts\(/)
  assert.match(classificationApi, /if \(canManage\) await healCategoryLedgers\(user, tree\)/)
  // One category that cannot be linked never stops the screen from loading.
  assert.match(categoryLedger, /\} catch \{\s+failed \+= 1/)
})

test('a retried create can never leave two ledger accounts on one category', () => {
  // Idempotent by construction: an existing link short-circuits the create.
  assert.match(categoryLedger, /const existing = linkedLedgerAccount\(tree, category\.id\)/)
  assert.match(categoryLedger, /if \(existing\) return \{ id: existing\.id, code: existing\.code, name: existing\.name, created: false \}/)
  // Losing a race for a code is the only retry, and it re-reads before deciding.
  assert.match(categoryLedger, /error\.message === DUPLICATE_ACCOUNT_CODE_MESSAGE/)
  assert.match(categoryLedger, /await refreshAccounts\(actor, tree\)/)
  assert.match(categoryLedger, /const linked = linkedLedgerAccount\(tree, category\.id\)/)
  assert.match(categoryLedger, /if \(linked\) return \{ id: linked\.id, code: linked\.code, name: linked\.name, created: false \}/)
})

test('renaming a category keeps its account in step without overwriting a chosen name', () => {
  assert.match(categoryLedger, /export async function renameCategoryWithLedger\(/)
  assert.match(categoryLedger, /if \(!before \|\| !linked \|\| linked\.name !== before\.name\) return \{ category, ledgerRenamed: false \}/)
  assert.match(categoryLedger, /manageManualLedgerAccount\(\{ \.\.\.actor, action: 'rename', accountId: linked\.id, name \}\)/)
  // A rename sends a name and an id only — the category's identity is untouched.
  assert.match(setupView, /scope: 'category', action: 'rename', categoryId: category\.id, name/)
})

test('deactivate and reactivate move the whole category in the order the database allows', () => {
  const accountOff = categoryLedger.indexOf("action: 'deactivate', accountId: account.id")
  const categoryOff = categoryLedger.indexOf("manageAccountCategory({ ...actor, action: 'deactivate', categoryId })")
  assert.ok(accountOff > -1 && categoryOff > -1)
  assert.ok(accountOff < categoryOff, 'accounts must be switched off before their category')
  const categoryOn = categoryLedger.indexOf("action: 'reactivate', categoryId })")
  const accountOn = categoryLedger.indexOf("action: 'activate', accountId: account.id")
  assert.ok(categoryOn > -1 && accountOn > -1)
  assert.ok(categoryOn < accountOn, 'a category must be active before its accounts')
  // Only manual accounts are moved; a system-managed one is left to the database.
  assert.match(categoryLedger, /function manualAccountsUnder\(tree: AccountClassificationTree, categoryId: string\)/)
  assert.match(setupView, /action: category\.isActive \? 'deactivate' : 'reactivate', categoryId: category\.id/)
})

test('a category that has already been used cannot be deleted', () => {
  assert.match(categoryLedger, /export async function deleteCategoryIfSafe\(/)
  // A voucher line, an expense line, a child account, a non-zero balance or any
  // of the flags all count as "in use" — and so does a check that fails to run.
  for (const proof of [
    /from\('voucher_lines'\)/, /from\('expense_lines'\)/, /in\('parent_id', accountIds\)/,
    /if \(hasBalance\(row\.balance_cache\)\) throw inUse\(\)/,
    /if \(row\.is_system \|\| row\.is_business_account \|\| row\.is_party_account\) throw inUse\(\)/,
  ]) {
    assert.match(categoryLedger, proof)
  }
  assert.match(categoryLedger, /for \(const result of \[accounts, voucherLines, expenseLines, children\]\) \{\s+if \(result\.error\) throw inUse\(\)/)
  assert.match(categoryLedger, /export const CATEGORY_IN_USE_MESSAGE =\s+'This category has already been used and cannot be deleted\. Deactivate it instead\.'/)
  // An account the client never got automatically is refused, not removed.
  assert.match(categoryLedger, /const foreign = tree\.accounts\.some\(\(account\) => account\.categoryId === categoryId && !account\.isManual\)/)
  // The delete restates the flags as its own WHERE clause.
  assert.match(categoryLedger, /\.eq\('is_system', false\)\s+\.eq\('is_business_account', false\)\s+\.eq\('is_party_account', false\)/)
  assert.match(setupView, /A category that has already been used cannot be deleted — deactivate it instead\./)
})

test('the fixed roots are shown but never created, renamed or deleted from the screen', () => {
  assert.doesNotMatch(setupView, /scope: 'root'/)
  assert.match(setupView, /The five accounting types are fixed\./)
})

test('the setup screen offers the category lifecycle and nothing else', () => {
  for (const action of ['create', 'rename', 'delete']) {
    assert.match(setupView, new RegExp(`scope: 'category', action: '${action}'`), `${action} must be offered`)
  }
  assert.match(setupView, /'deactivate' : 'reactivate'/)
  // One level, one decision: no subcategory tier and no ledger-account form.
  assert.doesNotMatch(setupView, /scope: 'subcategory'|scope: 'account'/)
  assert.doesNotMatch(setupView, /subcategor/i)
  assert.doesNotMatch(setupView, /accountCode|New account|Add account/)
  // And no internal counters or depth jargon beside a category name.
  assert.doesNotMatch(setupView, /\.length\} ?(sub|account)/)
  assert.doesNotMatch(setupView, /\bdepth\b/)
})

test('the management screen defers to the server verdict, and the server is the gate', () => {
  assert.match(setupView, /const canManage = tree\?\.canManage === true/)
  assert.match(setupView, /\{canManage && \(/)
  assert.match(setupView, /You can see the categories here; changing them needs setup permission\./)
  assert.match(setupView, /You do not have permission to manage account categories\./)
  assert.match(classificationApi, /const MANAGE_PERMISSIONS = \[/)
  assert.match(classificationApi, /function canManageClassification\(user: SessionUser\): boolean/)
  assert.match(classificationApi, /if \(!canManageClassification\(user\)\) return NextResponse\.json\(\{ error: 'FORBIDDEN' \}, \{ status: 403 \}\)/)
  assert.match(classificationApi, /const canManage = canManageClassification\(user\)/)
  assert.match(classificationApi, /return NextResponse\.json\(\{ \.\.\.tree, canManage \}\)/)
})

test('every classification call is scoped to the acting business and profile', () => {
  assert.match(dataAccess, /p_business_id: businessId/)
  assert.match(dataAccess, /p_actor_profile_id: actorProfileId/)
  assert.match(classificationApi, /const actor: ClassificationActor = \{ businessId: user\.businessId, actorProfileId: user\.profileId \}/)
  assert.match(classificationApi, /listAccountClassification\(user\.businessId, user\.profileId\)/)
  // The automatic ledger work is scoped the same way, and its own reads are
  // pinned to one business_id rather than to an id taken from the request.
  assert.match(categoryLedger, /export type ClassificationActor = \{ businessId: string; actorProfileId: string \}/)
  for (const scoped of [/\.eq\('business_id', businessId\)/, /\.eq\('business_id', businessId\)\.in\('id', wanted\)/]) {
    assert.match(categoryLedger, scoped)
  }
})

test('the stored Income root is displayed as Revenue without being renamed', () => {
  assert.match(dataAccess, /type === 'Income' \? 'Revenue' : type/)
  assert.match(dataAccess, /displayType/)
  assert.match(setupView, /\{root\.displayType\}/)
})

// ---------------------------------------------------------------------------
// Expense Batch
// ---------------------------------------------------------------------------

test('an expense line asks for a category, a description and an amount', () => {
  assert.match(expenseView, />Expense Category</)
  assert.match(expenseView, />Description</)
  assert.match(expenseView, />Amount \(Rs\)</)
  assert.match(expenseView, /<ChoiceSelect value=\{line\.choice\} groups=\{choiceGroups\}/)
  // One picker per line: there is no second account dropdown to reach.
  assert.doesNotMatch(expenseView, /Subcategory|Expense Account</)
  assert.doesNotMatch(expenseView, /Select category first…/)
  assert.doesNotMatch(expenseView, /cascade|manualAccountsInCategory/)
  // The header of the batch is unchanged.
  for (const field of [/>Date</, /Paid From \(business account\)/, />Reference</, />Notes</, /Post Expense Batch/]) {
    assert.match(expenseView, field)
  }
})

test('the choice a line offers is a category that already has a ledger account', () => {
  assert.match(client, /function postableCategories\(tree: ClassificationTree, rootId: string\): ClassificationNodeDto\[\]/)
  assert.match(client, /\.filter\(\(account\) => account\.isActive && account\.isManual && account\.categoryId\)/)
  assert.match(client, /return activeCategories\(tree, rootId\)\.filter\(\(node\) => linked\.has\(node\.id\)\)/)
  // Manual accounts that never had a category stay selectable in a second group,
  // so no destination that used to post quietly disappears.
  assert.match(client, /!account\.categoryId && !account\.subcategoryId/)
  assert.match(client, /export const OTHER_EXPENSE_ACCOUNTS_LABEL = 'Other expense accounts'/)
  assert.match(expenseView, /const fallback = expenseAccountChoices\(flatExpenseAccounts\)/)
  // The screen never derives the eligible list itself.
  assert.doesNotMatch(expenseView, /tree\??\.accounts\s*\.?\s*\.filter/)
})

test('system-managed expense accounts are never a category and never selectable', () => {
  assert.match(dataAccess, /isManual: !row\.isSystem && !row\.isBusinessAccount && !row\.isPartyAccount/)
  assert.match(client, /account\.isActive && account\.isManual/)
  assert.match(expenseView, /!a\.isSystem && !a\.isBusinessAccount && !a\.isPartyAccount/)
  assert.match(accountsView, /categoryType === 'Expense' && !a\.isSystem && !a\.isBusinessAccount && !a\.isPartyAccount/)
  // The resolver reads only accounts that carry none of those flags, so a
  // category can never post to 5010 Purchases / COGS or 5030 Commission.
  assert.match(categoryLedger, /\.eq\('is_active', true\)\.eq\('is_system', false\)/)
  assert.match(categoryLedger, /\.eq\('is_business_account', false\)\.eq\('is_party_account', false\)/)
})

test('system-managed accounts stay visible in the chart of accounts and the reports', () => {
  assert.match(coaView, /a\.isSystem &&/)
  assert.match(coaView, />\s*System\s*</)
  // Visibility is never conditional on the flag — only the badge is.
  assert.doesNotMatch(coaView, /filter\(\(?a\)? => !a\.isSystem/)
  assert.doesNotMatch(trialBalanceApi, /isSystem/)
  assert.doesNotMatch(reportsApi, /isSystem/)
  assert.doesNotMatch(trialBalanceView, /isSystem/)
})

test('the ledger account an expense posts to is resolved on the server', () => {
  assert.match(expenseApi, /resolution = await resolveCategoryLedgerAccounts\(su\.businessId, categoryIds\)/)
  assert.match(expenseApi, /expenseAccountId: linked\.accountId/)
  // Only a real, active, user-level category resolves at all.
  assert.match(categoryLedger, /if \(row\.depth === 1 && row\.is_active && !row\.is_system\) usable\.set\(row\.id, row\.name\)/)
  assert.match(categoryLedger, /const unavailable = wanted\.filter\(\(id\) => !usable\.has\(id\)\)/)
  assert.match(categoryLedger, /const notReady = \[\.\.\.usable\.keys\(\)\]\.filter\(\(id\) => !resolved\.has\(id\)\)/)
  // A database fault is never reported to the user as a bad category.
  assert.match(categoryLedger, /if \(categories\.error\) throw readFailed\('account_categories', categories\.error\.message\)/)
  assert.match(categoryLedger, /if \(accounts\.error\) throw readFailed\('accounts', accounts\.error\.message\)/)
})

test('a refused category is explained in the client’s own words, never hidden', () => {
  assert.match(expenseApi, /function categoryRejected\(categoryId: string, resolution: CategoryLedgerResolution \| null\)/)
  assert.match(expenseApi, /message: notReady \? CATEGORY_NOT_READY_MESSAGE : CATEGORY_UNAVAILABLE_MESSAGE/)
  assert.match(categoryLedger, /'This category is not ready to be used yet\./)
  assert.match(categoryLedger, /'This category is not available\. Refresh the page and pick an active category\.'/)
  // The screen shows the server's reason instead of swallowing it.
  assert.match(expenseView, /\{result\.error\}/)
  assert.match(expenseView, /throw new Error\(j\?\.message \?\? j\?\.error \?\? 'Failed'\)/)
})

test('every server check the expense flow made before is still made', () => {
  assert.match(expenseApi, /requirePermission\(loaded, 'can_create_expense_batch'\)/)
  assert.match(expenseApi, /if \(amt === null \|\| amt <= 0n\)/)
  // Ownership: every account is loaded within the acting business.
  assert.match(expenseApi, /getAccountById\(su\.businessId, parsed\.data\.paymentAccountId\)/)
  assert.match(expenseApi, /getAccountById\(su\.businessId, line\.expenseAccountId\)/)
  // Payment account: active, a business account, under the fixed Asset root.
  assert.match(expenseApi, /!paymentAccount\?\.isActive \|\| !paymentAccount\.isBusinessAccount \|\| paymentAccount\.category\.type !== 'Asset'/)
  // Destination: active and under the fixed Expense root.
  assert.match(expenseApi, /!account\?\.isActive \|\| account\.category\.type !== 'Expense'/)
  // Never a system, business or party account.
  assert.match(expenseApi, /account\?\.isSystem === true/)
  assert.match(expenseApi, /account\?\.isBusinessAccount === true/)
  assert.match(expenseApi, /account\?\.isPartyAccount === true/)
  // And the account must really belong to the category the line came from.
  assert.match(expenseApi, /category\.depth === 2 \? category\.parentId !== line\.categoryId : category\.id !== line\.categoryId/)
})

test('voucher identity, amounts and idempotency are untouched by the category layer', () => {
  assert.match(expenseApi, /postExpenseBatch\(\{/)
  assert.match(expenseApi, /amountPaisas: line\.amountPaisas/)
  assert.match(expenseApi, /idempotencyKey: parsed\.data\.idempotencyKey \?\? crypto\.randomUUID\(\)/)
  assert.match(vouchers, /Promise<\{ expenseId: string; expenseNo: string; voucherId: string; idempotent: boolean \}>/)
  assert.match(vouchers, /idempotent: result\.idempotent === true/)
})

test('a replayed posting is not audited twice', () => {
  assert.match(expenseApi, /if \(categories\.length > 0 && !result\.idempotent\) \{/)
})

test('categories only exist in the legacy accounting schema, and elsewhere a line names its account', () => {
  assert.match(expenseApi, /if \(!usesLegacyAccounting\) return categoryRejected\(categoryIds\[0\], null\)/)
  assert.match(expenseApi, /const usesLegacyAccounting = isSupabaseConfigured\(\) && await usesLegacyTransactionSchema\(\)/)
  assert.match(client, /export function isClassificationUnavailable\(error: unknown\): boolean/)
  assert.match(expenseView, /const expenseRootId = useMemo\(\(\) => rootByType\(tree, 'Expense'\)\?\.id \?\? null, \[tree\]\)/)
})

test('inactive categories stay readable in setup but are never offered for a new posting', () => {
  assert.match(client, /export function categoriesForRoot\([\s\S]{0,220}filter\(\(node\) => node\.rootId === rootId\)/)
  assert.match(client, /export function activeCategories\([\s\S]{0,220}filter\(\(node\) => node\.isActive\)/)
  assert.match(setupView, /const categories = categoriesForRoot\(tree, root\.id\)/)
  assert.match(setupView, /function InactiveBadge\(\)/)
})

// ---------------------------------------------------------------------------
// Trial Balance
// ---------------------------------------------------------------------------

test('Trial Balance totals are computed before any classification is consulted', () => {
  const totalsAt = trialBalanceApi.indexOf('grandDebit += ')
  const classificationAt = trialBalanceApi.indexOf('await tryListAccountClassification(')
  assert.ok(totalsAt > -1 && classificationAt > -1)
  assert.ok(totalsAt < classificationAt, 'the grand totals must not depend on the classification')
  assert.match(trialBalanceApi, /grandDebit: grandDebit\.toString\(\)/)
  assert.match(trialBalanceApi, /isBalanced: grandDebit === grandCredit/)
})

test('Trial Balance filters on accounting type and category, and resets both', () => {
  assert.match(trialBalanceView, /label="Accounting type" allLabel="All types" value=\{typeFilter\} onChange=\{selectType\}/)
  assert.match(trialBalanceView, /label="Category" allLabel="All categories" value=\{categoryFilter\} onChange=\{setCategoryFilter\}/)
  assert.match(trialBalanceView, /const filtersActive = canFilter && \(typeFilter !== ALL \|\| categoryFilter !== ALL\)/)
  assert.match(trialBalanceView, /function resetFilters\(\) \{\s+setTypeFilter\(ALL\)\s+setCategoryFilter\(ALL\)\s+\}/)
  assert.match(trialBalanceView, /<RotateCcw className="size-3\.5" \/> Reset/)
  // Two filters and no third tier: the subcategory selector is gone.
  assert.doesNotMatch(trialBalanceView, /subcategoryFilter|All subcategories/)
})

test('Trial Balance grouping is accounting type → category → ledger account', () => {
  assert.match(trialBalanceView, /Accounting type → category → ledger account/)
  assert.match(trialBalanceView, /Every row lands in exactly one\s+\*\s+category bucket/)
  assert.match(trialBalanceView, /const rootKey = row\.rootId \?\? `type:\$\{row\.categoryType\}`/)
  assert.match(trialBalanceView, /const categoryKey = row\.classCategoryId \?\? 'ungrouped'/)
  assert.match(trialBalanceView, /buildGroups\(visibleRows, roots\)/)
  // Exactly one bucket per row, so a subtotal can never count a row twice.
  assert.equal(trialBalanceView.match(/\.rows\.push\(row\)/g)?.length, 1)
  assert.match(trialBalanceView, /category\.rows\.map\(\(r\) => \(/)
})

test('Trial Balance filters hide whole rows and keep the server grand totals', () => {
  assert.match(trialBalanceView, /Filtering only ever hides whole account rows/)
  assert.match(trialBalanceView, /q\.data\?\.grandDebit/)
  assert.match(trialBalanceView, /q\.data\?\.grandCredit/)
  assert.match(trialBalanceView, /Filtered subtotal/)
  assert.match(trialBalanceView, /Grand totals/)
})

test('an account with no classification cannot be filtered or grouped out of existence', () => {
  assert.match(trialBalanceView, /r\.rootId \? r\.rootId === typeFilter : selectedRoot\?\.type === r\.categoryType/)
  assert.match(trialBalanceView, /'Not grouped in a category'/)
})

// ---------------------------------------------------------------------------
// Balance Sheet / Profit & Loss / Expense report
// ---------------------------------------------------------------------------

test('a deployment or business without categories gets the report it always got', () => {
  assert.match(trialBalanceApi, /if \(!overlay\?\.hasCustomClassification\)/)
  assert.match(trialBalanceApi, /hasCustomClassification: false, roots: \[\], categories: \[\], subcategories: \[\]/)
  assert.match(trialBalanceView, /const canFilter = classification\?\.hasCustomClassification === true/)
  assert.match(reportsApi, /const EMPTY_CLASSIFICATION: ReportClassification = \{\s+hasCustomClassification: false/)
  assert.match(reportsView, /classification\?\.hasCustomClassification/)
})

test('only account-level financial reports receive classification labels', () => {
  assert.match(reportsApi, /const CLASSIFIABLE_REPORTS = new Set\(\['profit-loss', 'balance-sheet', 'expense'\]\)/)
  assert.match(reportsApi, /if \(!CLASSIFIABLE_REPORTS\.has\(type\)\) return null/)
})

test('report rows and totals are returned exactly as the report RPC produced them', () => {
  assert.match(reportsApi, /rows: await reportProfitLoss\(bid, fromDate, toDate\)/)
  assert.match(reportsApi, /rows: await reportBalanceSheet\(bid, toDate\)/)
  assert.match(reportsApi, /rows: await reportExpenseSummary\(bid, fromDate, toDate\)/)
  // The overview KPIs and the statement sections keep reading the fixed codes.
  assert.match(reportsApi, /r\.section === 'REVENUE'/)
  assert.match(reportsApi, /r\.section === 'ASSET'/)
  assert.match(reportsApi, /balanced: assets === liabilities \+ equity/)
})

test('the classification cannot move an account to another statement section', () => {
  assert.match(reportsView, /the fixed accounting root still decides where an\s+\* account appears/)
  assert.match(reportsView, /fixed accounting root still decides what belongs in this section/)
})

test('Profit & Loss and Balance Sheet are grouped by category but never filtered', () => {
  assert.match(reportsView, /function groupByClassification</)
  assert.match(reportsView, /Every row lands in\s+\*\s+exactly one bucket/)
  assert.match(reportsView, /const categoryKey = label\?\.categoryId \?\? 'ungrouped'/)
  assert.equal(reportsView.match(/group\.rows\.push\(row\)/g)?.length, 1)
  assert.match(reportsView, /function ProfitLossReport\(\{ rows, classification \}/)
  assert.match(reportsView, /function BalanceSheetReport\(\{ rows, classification \}/)
  // One category header per group and then the statement's own lines: no third
  // tier left to split a category's rows across two subtotals.
  assert.match(reportsView, /group\.rows\.map\(\(row\) => <Fragment key=\{row\.account_code\}>\{renderRow\(row\)\}<\/Fragment>\)/)
  assert.doesNotMatch(reportsView, /subcategoryFilter|All subcategories|buckets\b/)
})

test('the Expense report is the one financial report that can be filtered', () => {
  assert.match(reportsView, /The one financial report that can safely be filtered/)
  assert.match(reportsView, /const filtersActive = canFilter && categoryFilter !== ALL/)
  assert.match(reportsView, /No expenses match these filters\./)
  assert.match(reportsView, /Filtered total/)
  assert.match(reportsView, /Total Expenses/)
})

test('Cash Flow and the in-report Trial Balance were left alone', () => {
  assert.doesNotMatch(reportsApi, /case 'cash-flow': return NextResponse\.json\(\{[\s\S]{0,120}classification/)
  assert.match(reportsApi, /case 'trial-balance': return NextResponse\.json\(\{ rows: await reportTrialBalance\(bid, fromDate, toDate\) \}\)/)
})

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

test('every category change has a readable audit label', () => {
  for (const [action, label] of [
    ['ACCOUNT_CATEGORY_CREATE', 'Category created'],
    ['ACCOUNT_CATEGORY_RENAME', 'Category renamed'],
    ['ACCOUNT_CATEGORY_DEACTIVATE', 'Category deactivated'],
    ['ACCOUNT_CATEGORY_REACTIVATE', 'Category reactivated'],
    ['ACCOUNT_CATEGORY_DELETE', 'Category deleted'],
    ['MANUAL_LEDGER_ACCOUNT_CLASSIFY', 'Account classification changed'],
  ] as const) {
    assert.match(auditView, new RegExp(`${action}: '${label}'`), `${action} needs a readable label`)
  }
  assert.match(auditView, /ACTION_LABELS\[row\.action\]/)
  assert.match(auditView, /account_category: 'Category'/)
  assert.match(auditView, /manual_ledger_account: 'Ledger account'/)
})

test('the automatic ledger work is visible in the audit log, by name', () => {
  assert.match(classificationApi, /action: 'ACCOUNT_CATEGORY_LEDGER_LINKED'/)
  assert.match(classificationApi, /action: 'MANUAL_LEDGER_ACCOUNT_REMOVED'/)
  assert.match(auditView, /ACCOUNT_CATEGORY_LEDGER_LINKED: 'Linked ledger created automatically'/)
  assert.match(auditView, /MANUAL_LEDGER_ACCOUNT_REMOVED: 'Linked ledger removed automatically'/)
  // The row reads "Lunch Expense", not a stored identifier.
  assert.match(classificationApi, /name: link\.categoryName/)
  assert.match(auditView, /for \(const key of \['name', 'categories'/)
})

test('an expense posting records the categories it was posted from', () => {
  assert.match(expenseApi, /action: 'EXPENSE_POSTED_WITH_CATEGORY'/)
  assert.match(expenseApi, /categories: categories\.join\(', '\)/)
  assert.match(expenseApi, /const categories = \[\.\.\.new Set\(lines\.map\(\(line\) => line\.categoryName\)\.filter\(Boolean\)\)\]/)
  assert.match(auditView, /EXPENSE_POSTED_WITH_CATEGORY: 'Expense posted using category'/)
  assert.match(auditView, /expense: 'Expense'/)
})

test('losing an audit row never turns completed work into a failure', () => {
  assert.match(categoryLedger, /export async function safeAudit\(entry: Parameters<typeof writeAudit>\[0\]\): Promise<void>/)
  assert.match(classificationApi, /await safeAudit\(\{/)
  assert.match(expenseApi, /await safeAudit\(\{/)
})

test('the audit log reads the recorded change without showing raw payloads', () => {
  assert.match(auditView, /function snapshotChanges\(row: Row\)/)
  assert.match(auditView, /label: 'Status'/)
  // Identifiers are dropped rather than printed.
  assert.doesNotMatch(auditView, /label: '(rootId|parentId|categoryId|depth)'/)
  assert.doesNotMatch(auditView, /JSON\.stringify/)
})

// ---------------------------------------------------------------------------
// One cache, one set of words
// ---------------------------------------------------------------------------

test('both classification screens read the same cache under the same key', () => {
  assert.match(client, /export const CLASSIFICATION_QUERY_KEY = \['account-classification'\] as const/)
  assert.match(client, /export const CLASSIFICATION_STALE_TIME_MS = 300_000/)
  for (const [view, name] of [[setupView, 'setup'], [expenseView, 'expense batch']] as const) {
    assert.match(view, /queryKey: CLASSIFICATION_QUERY_KEY/, `${name} must share the query key`)
    assert.match(view, /staleTime: CLASSIFICATION_STALE_TIME_MS/, `${name} must share the stale time`)
    assert.doesNotMatch(view, /queryKey: \['account-classification'\]/, `${name} must not retype the key`)
  }
})

test('adding or removing a category refreshes the chart of accounts with it', () => {
  assert.match(setupView, /void qc\.invalidateQueries\(\{ queryKey: CLASSIFICATION_QUERY_KEY \}\)/)
  assert.match(setupView, /void qc\.invalidateQueries\(\{ queryKey: \['coa'\] \}\)/)
  assert.match(coaView, /queryKey: \['coa'\]/)
})

test('no classification screen polls the server or fetches from an effect', () => {
  for (const [view, name] of [[setupView, 'setup'], [expenseView, 'expense batch']] as const) {
    assert.doesNotMatch(view, /refetchInterval|setInterval/, `${name} must not poll`)
    assert.doesNotMatch(view, /useEffect/, `${name} must not fetch from an effect`)
  }
})

test('the words shown when there is nothing to show are written once', () => {
  assert.match(client, /export const CLASSIFICATION_LOAD_ERROR = 'Unable to load account classifications'/)
  assert.match(client, /export const NO_CATEGORIES_MESSAGE = 'No categories yet\.'/)
  assert.match(client, /export const NO_EXPENSE_CATEGORIES_MESSAGE = 'No expense categories yet — add one under Account Categories\.'/)
  assert.match(client, /export const EXPENSE_CATEGORY_GROUP_LABEL = 'Expense categories'/)
  assert.match(client, /export const OTHER_EXPENSE_ACCOUNTS_LABEL = 'Other expense accounts'/)
  assert.match(setupView, /\{NO_CATEGORIES_MESSAGE\}/)
  assert.match(setupView, /: CLASSIFICATION_LOAD_ERROR\}/)
  assert.match(expenseView, /\{CLASSIFICATION_LOAD_ERROR\}/)
  assert.match(expenseView, /NO_EXPENSE_CATEGORIES_MESSAGE/)
  // Copy lives in the shared module, not inlined a second time in a view.
  for (const view of [setupView, expenseView]) {
    assert.doesNotMatch(view, /'Unable to load account classifications'|'No categories yet\.'/)
  }
})

test('the report screens use the classification the report already returned', () => {
  for (const [view, name] of [[trialBalanceView, 'Trial Balance'], [reportsView, 'Reports']] as const) {
    assert.doesNotMatch(view, /CLASSIFICATION_QUERY_KEY|account-classification/, `${name} must not open a second request`)
    assert.match(view, /q\.data\?\.classification/, `${name} must read the classification off its own payload`)
  }
})

test('the chart of accounts stays the one place a ledger account is shown in full', () => {
  assert.match(coaView, /function rootGroups\(categories: Category\[\]\): RootGroup\[\]/)
  assert.match(coaView, /a\.path \? <div className="mt-1 text-\[11px\] text-muted-foreground">\{a\.path\}<\/div> : null/)
  assert.match(coaView, /The categories themselves are managed\s*\n?\s*\*? ?in Account Categories\./)
  assert.match(coaView, /\{a\.isSystem && \(/)
})

test('no screen shows database or transport terminology', () => {
  const screens = [
    ['setup', setupView], ['expense batch', expenseView], ['Trial Balance', trialBalanceView],
    ['Reports', reportsView], ['audit log', auditView], ['chart of accounts', coaView],
  ] as const
  for (const [name, view] of screens) {
    assert.doesNotMatch(view, /\brpc\(|service_role|supabase/i, `${name} must not name the transport`)
    assert.doesNotMatch(view, /account_categories|ledger_accounts|manage_account_category/, `${name} must not name tables or routines`)
    assert.doesNotMatch(view, /\bis_system\b|\bparent_id\b|\bbusiness_id\b/, `${name} must not name raw columns`)
  }
})
