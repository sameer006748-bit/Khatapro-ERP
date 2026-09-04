/**
 * Custom account classification — the client-facing layer over the production
 * RPCs shipped by 00042_legacy_account_classification.sql.
 *
 * The RPCs own every rule (hierarchy, lifecycle, system accounts, isolation),
 * so these are source-contract assertions over the application seam: that the
 * app calls those RPCs instead of re-implementing them, that no screen relies
 * on its own filtering for a posting rule, and — the part with real money
 * behind it — that no report total is ever derived from a classification.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const dataAccess = await source('src/lib/accounting/legacy-account-classification.ts')
const classificationApi = await source('src/app/api/account-classification/route.ts')
const client = await source('src/lib/accounting/classification-client.ts')
const setupView = await source('src/components/erp/views/account-classification-view.tsx')
const expenseView = await source('src/components/erp/views/expense-batch-view.tsx')
const expenseApi = await source('src/app/api/expense-batch/route.ts')
const accountsView = await source('src/components/erp/views/accounts-view.tsx')
const coaView = await source('src/components/erp/views/coa-view.tsx')
const trialBalanceApi = await source('src/app/api/trial-balance/route.ts')
const trialBalanceView = await source('src/components/erp/views/trial-balance-view.tsx')
const reportsApi = await source('src/app/api/reports/route.ts')
const reportsView = await source('src/components/erp/views/reports-view.tsx')
const auditView = await source('src/components/erp/views/audit-log-view.tsx')

// ---------------------------------------------------------------------------
// Classification data access
// ---------------------------------------------------------------------------

test('classification data access goes through the service-role RPCs only', () => {
  assert.match(dataAccess, /import 'server-only'/)
  assert.match(dataAccess, /getAdminSupabase\(\)\.rpc\('list_account_classification'/)
  assert.match(dataAccess, /getAdminSupabase\(\)\.rpc\('manage_account_category'/)
  assert.match(dataAccess, /getAdminSupabase\(\)\.rpc\('manage_account_subcategory'/)
  assert.match(dataAccess, /getAdminSupabase\(\)\.rpc\('manage_manual_ledger_account'/)
  // No Prisma shadow of the hierarchy: a configured Supabase production is the
  // only source of classification truth.
  assert.doesNotMatch(dataAccess, /\bdb\.account/)
  assert.doesNotMatch(dataAccess, /from '@\/lib\/db'/)
})

test('every classification call is scoped to the business and the acting profile', () => {
  assert.match(dataAccess, /p_business_id: businessId/)
  assert.match(dataAccess, /p_actor_profile_id: actorProfileId/)
  assert.match(classificationApi, /businessId: user\.businessId, actorProfileId: user\.profileId/)
  assert.match(classificationApi, /listAccountClassification\(user\.businessId, user\.profileId\)/)
})

test('the classification API is the permission gate and the server decides canManage', () => {
  assert.match(classificationApi, /const MANAGE_PERMISSIONS = \[/)
  assert.match(classificationApi, /canManageClassification\(user: SessionUser\)/)
  assert.match(classificationApi, /if \(!canManageClassification\(user\)\) return NextResponse\.json\(\{ error: 'FORBIDDEN' \}, \{ status: 403 \}\)/)
  assert.match(classificationApi, /canManage: canManageClassification\(user\)/)
})

test('the stored Income root is displayed as Revenue without being renamed', () => {
  assert.match(dataAccess, /type === 'Income' \? 'Revenue' : type/)
  assert.match(dataAccess, /displayType/)
})

test('inactive classifications stay readable but cannot be chosen for something new', () => {
  // categoriesForRoot keeps everything (history), activeCategories is the picker.
  assert.match(client, /export function categoriesForRoot\([\s\S]*?filter\(\(node\) => node\.rootId === rootId\)/)
  assert.match(client, /export function activeCategories\([\s\S]*?filter\(\(node\) => node\.isActive\)/)
  assert.match(client, /export function activeSubcategories\([\s\S]*?filter\(\(node\) => node\.isActive\)/)
})

// ---------------------------------------------------------------------------
// Category / subcategory management
// ---------------------------------------------------------------------------

test('the setup screen offers the full category lifecycle and nothing more', () => {
  for (const action of ['create', 'rename', 'deactivate', 'reactivate', 'delete']) {
    assert.match(setupView, new RegExp(`scope: 'category', action: '${action}'|action: category\\.isActive \\? 'deactivate' : 'reactivate'`))
  }
  assert.match(setupView, /scope: 'subcategory', action: 'create'/)
  assert.match(setupView, /scope: 'subcategory', action: 'rename'/)
  assert.match(setupView, /scope: 'subcategory', action: subcategory\.isActive \? 'deactivate' : 'reactivate'/)
  assert.match(setupView, /scope: 'subcategory', action: 'delete'/)
})

test('fixed roots are shown but never created, renamed or deleted from the screen', () => {
  assert.doesNotMatch(setupView, /scope: 'root'/)
  assert.doesNotMatch(setupView, /action: 'create', rootId: undefined/)
  // A category is always created under a root that came from the server tree.
  assert.match(setupView, /scope: 'category', action: 'create', rootId: draft\.parentId/)
})

test('the management screen hides its actions behind the server verdict', () => {
  assert.match(setupView, /const canManage = tree\?\.canManage === true/)
  assert.match(setupView, /\{canManage && /)
  assert.match(setupView, /canManage && account\.isManual/)
})

// ---------------------------------------------------------------------------
// System-managed accounts
// ---------------------------------------------------------------------------

test('system-managed accounts are not manual accounts anywhere in the app', () => {
  assert.match(dataAccess, /isManual: !row\.isSystem && !row\.isBusinessAccount && !row\.isPartyAccount/)
  assert.match(client, /account\.isActive && account\.isManual/)
})

test('manual expense pickers exclude system, business and party accounts', () => {
  assert.match(expenseView, /!a\.isSystem && !a\.isBusinessAccount && !a\.isPartyAccount/)
  assert.match(accountsView, /categoryType === 'Expense' && !a\.isSystem && !a\.isBusinessAccount && !a\.isPartyAccount/)
})

test('system-managed accounts stay visible in the chart of accounts', () => {
  assert.match(coaView, /a\.isSystem &&/)
  assert.match(coaView, />\s*System\s*</)
  // Visibility is never conditional on the flag — only the badge is.
  assert.doesNotMatch(coaView, /filter\(\(?a\)? => !a\.isSystem/)
})

test('reports never filter an account out for being system-managed', () => {
  assert.doesNotMatch(trialBalanceApi, /isSystem/)
  assert.doesNotMatch(reportsApi, /isSystem/)
  assert.doesNotMatch(trialBalanceView, /isSystem/)
})

// ---------------------------------------------------------------------------
// Expense Batch
// ---------------------------------------------------------------------------

test('Expense Batch cascades Category then Subcategory / Expense Account', () => {
  assert.match(expenseView, /Subcategory \/ Expense Account/)
  // The eligible accounts of a category come from the shared helper — the screen
  // caches its answer per picked category but never derives the list itself.
  assert.match(expenseView, /manualAccountsInCategory\(tree, expenseRootId, categoryId\)/)
  assert.match(expenseView, /cascadeByCategory\.get\(line\.categoryId\)/)
  assert.doesNotMatch(expenseView, /tree\??\.accounts\s*\.?\s*\.filter/)
  assert.match(expenseView, /Select category first…/)
})

test('Expense Batch never forces a subcategory that does not exist', () => {
  assert.match(expenseView, /NO_SUBCATEGORIES_MESSAGE/)
  assert.match(client, /No subcategories — you can select a direct expense account\./)
  // Accounts linked straight to the category are offered in the same dropdown.
  assert.match(client, /account\.categoryId === categoryId/)
})

test('accounts that predate the classification remain selectable', () => {
  assert.match(client, /export const DIRECT_ACCOUNT_GROUP = '__direct__'/)
  assert.match(client, /!account\.categoryId && !account\.subcategoryId/)
  assert.match(expenseView, /const cascade = categories\.length > 0 && rootAccounts\.length > 0/)
  assert.match(expenseView, /const expenseAccounts = cascade \? rootAccounts : flatExpenseAccounts/)
})

test('the posted line carries the category so the server can re-check it', () => {
  assert.match(expenseView, /categoryId: l\.categoryId && l\.categoryId !== DIRECT_ACCOUNT_GROUP \? l\.categoryId : undefined/)
})

test('the expense API re-validates every rule the dropdowns only suggest', () => {
  // Ownership: each account is loaded within the acting business.
  assert.match(expenseApi, /getAccountById\(su\.businessId, parsed\.data\.paymentAccountId\)/)
  assert.match(expenseApi, /getAccountById\(su\.businessId, line\.expenseAccountId\)/)
  // Expense root + active.
  assert.match(expenseApi, /!account\?\.isActive \|\| account\.category\.type !== 'Expense'/)
  // System / business / party accounts are refused as manual destinations.
  assert.match(expenseApi, /account\?\.isSystem === true/)
  assert.match(expenseApi, /account\?\.isBusinessAccount === true/)
  assert.match(expenseApi, /account\?\.isPartyAccount === true/)
  // The claimed category must really hold the account, directly or as its parent.
  assert.match(expenseApi, /category\.depth === 2 \? category\.parentId !== line\.categoryId : category\.id !== line\.categoryId/)
})

test('expense posting semantics, payment validation and idempotency are untouched', () => {
  assert.match(expenseApi, /requirePermission\(loaded, 'can_create_expense_batch'\)/)
  assert.match(expenseApi, /paymentAccount\.isBusinessAccount \|\| paymentAccount\.category\.type !== 'Asset'/)
  assert.match(expenseApi, /idempotencyKey: parsed\.data\.idempotencyKey \?\? crypto\.randomUUID\(\)/)
  assert.match(expenseApi, /amountPaisas: parseMoney\(l\.amount\)!/)
  assert.match(expenseApi, /postExpenseBatch\(\{/)
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

test('a deployment or business without categories gets the report it always got', () => {
  assert.match(trialBalanceApi, /if \(!overlay\?\.hasCustomClassification\)/)
  assert.match(trialBalanceApi, /hasCustomClassification: false, roots: \[\], categories: \[\], subcategories: \[\]/)
  assert.match(trialBalanceView, /const canFilter = classification\?\.hasCustomClassification === true/)
  assert.match(trialBalanceView, /useState\(false\)/)
})

test('Trial Balance filters hide whole rows and keep the server grand totals', () => {
  assert.match(trialBalanceView, /Filtering only ever hides whole account rows/)
  assert.match(trialBalanceView, /q\.data\?\.grandDebit/)
  assert.match(trialBalanceView, /q\.data\?\.grandCredit/)
  assert.match(trialBalanceView, /Filtered subtotal/)
  assert.match(trialBalanceView, /Grand totals/)
})

test('Trial Balance grouping partitions the same rows, so subtotals reconcile', () => {
  assert.match(trialBalanceView, /Root → Category → Subcategory → Account/)
  assert.match(trialBalanceView, /Every row lands in exactly one/)
  // One bucket per row: an account with no classification still lands under its
  // accounting type, and one with no subcategory under a direct bucket.
  assert.match(trialBalanceView, /row\.rootId \?\? `type:\$\{row\.categoryType\}`/)
  assert.match(trialBalanceView, /row\.classSubcategoryId \?\? 'direct'/)
  assert.match(trialBalanceView, /buildGroups\(visibleRows, roots\)/)
})

test('an account with no classification cannot be filtered out of existence', () => {
  assert.match(trialBalanceView, /r\.rootId \? r\.rootId === typeFilter : selectedRoot\?\.type === r\.categoryType/)
})

// ---------------------------------------------------------------------------
// Balance Sheet / financial reports
// ---------------------------------------------------------------------------

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

test('Profit & Loss and Balance Sheet are grouped but never filtered', () => {
  assert.match(reportsView, /function groupByClassification</)
  assert.match(reportsView, /Every\s*\n?\s*\* row lands in exactly one bucket/)
  assert.match(reportsView, /function ProfitLossReport\(\{ rows, classification \}/)
  assert.match(reportsView, /function BalanceSheetReport\(\{ rows, classification \}/)
})

test('the Expense report is the one financial report that can be filtered', () => {
  assert.match(reportsView, /The one financial report that can safely be filtered/)
  assert.match(reportsView, /No expenses match these filters\./)
  assert.match(reportsView, /Filtered total/)
  assert.match(reportsView, /Total Expenses/)
})

test('Cash Flow and the in-report Trial Balance were left alone', () => {
  assert.doesNotMatch(reportsApi, /case 'cash-flow': return NextResponse\.json\(\{[\s\S]{0,120}classification/)
  assert.match(reportsApi, /case 'trial-balance': return NextResponse\.json\(\{ rows: await reportTrialBalance\(bid, fromDate, toDate\) \}\)/)
})

test('grouping and filtering are off until a business creates its own categories', () => {
  assert.match(reportsApi, /const EMPTY_CLASSIFICATION: ReportClassification = \{\s*\n?\s*hasCustomClassification: false/)
  assert.match(reportsView, /classification\?\.hasCustomClassification/)
})

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

test('every classification mutation has a readable audit label', () => {
  for (const [action, label] of [
    ['ACCOUNT_CATEGORY_CREATE', 'Category created'],
    ['ACCOUNT_CATEGORY_RENAME', 'Category renamed'],
    ['ACCOUNT_CATEGORY_DEACTIVATE', 'Category deactivated'],
    ['ACCOUNT_CATEGORY_REACTIVATE', 'Category reactivated'],
    ['ACCOUNT_CATEGORY_DELETE', 'Category deleted'],
    ['ACCOUNT_SUBCATEGORY_CREATE', 'Subcategory created'],
    ['ACCOUNT_SUBCATEGORY_RENAME', 'Subcategory renamed'],
    ['ACCOUNT_SUBCATEGORY_DEACTIVATE', 'Subcategory deactivated'],
    ['ACCOUNT_SUBCATEGORY_REACTIVATE', 'Subcategory reactivated'],
    ['ACCOUNT_SUBCATEGORY_DELETE', 'Subcategory deleted'],
    ['MANUAL_LEDGER_ACCOUNT_CLASSIFY', 'Account classification changed'],
  ] as const) {
    assert.match(auditView, new RegExp(`${action}: '${label}'`), `${action} needs a readable label`)
  }
  assert.match(auditView, /ACTION_LABELS\[row\.action\]/)
  assert.match(auditView, /account_category: 'Category'/)
  assert.match(auditView, /manual_ledger_account: 'Ledger account'/)
})

test('the audit log reads the recorded change without showing raw payloads', () => {
  assert.match(auditView, /function snapshotChanges\(row: Row\)/)
  assert.match(auditView, /label: 'Status'/)
  // Identifiers are dropped rather than printed.
  assert.doesNotMatch(auditView, /label: '(rootId|parentId|categoryId|depth)'/)
  assert.doesNotMatch(auditView, /JSON\.stringify/)
})

// ---------------------------------------------------------------------------
// Loading the tree
// ---------------------------------------------------------------------------

test('every screen reads the tree under one shared key, so it is fetched once', () => {
  assert.match(client, /export const CLASSIFICATION_QUERY_KEY = \['account-classification'\] as const/)
  assert.match(client, /export const CLASSIFICATION_STALE_TIME_MS = 300_000/)
  for (const [name, view] of [['setup', setupView], ['expense batch', expenseView]] as const) {
    assert.match(view, /queryKey: CLASSIFICATION_QUERY_KEY/, `${name} must share the classification key`)
    assert.match(view, /staleTime: CLASSIFICATION_STALE_TIME_MS/, `${name} must share the cache lifetime`)
    assert.doesNotMatch(view, /queryKey: \['account-classification'\]/, `${name} must not re-declare the key`)
  }
  // The chart of accounts is the screen's second load; it is shared on the same
  // terms so opening Expense Batch does not refetch setup data it already has.
  assert.match(expenseView, /queryKey: \['coa'\][\s\S]{0,160}staleTime: 300_000/)
})

test('a classification change invalidates both caches so consumers cannot go stale', () => {
  assert.match(setupView, /invalidateQueries\(\{ queryKey: CLASSIFICATION_QUERY_KEY \}\)/)
  assert.match(setupView, /invalidateQueries\(\{ queryKey: \['coa'\] \}\)/)
})

test('the tree is loaded once per screen — no polling and no refetch loop', () => {
  for (const [name, view] of [['setup', setupView], ['expense batch', expenseView]] as const) {
    assert.doesNotMatch(view, /refetchInterval|refetchOnMount: 'always'|setInterval/, `${name} must not poll`)
    // A refetch only happens on the user's own Retry, never from an effect.
    assert.doesNotMatch(view, /useEffect\([\s\S]{0,200}refetch\(\)/, `${name} must not refetch from an effect`)
  }
})

// ---------------------------------------------------------------------------
// Copy and presentation
// ---------------------------------------------------------------------------

test('the agreed empty and error states are used verbatim', () => {
  assert.match(client, /export const NO_CATEGORIES_MESSAGE = 'No categories created yet\.'/)
  assert.match(client, /export const NO_SUBCATEGORIES_MESSAGE = 'No subcategories — you can select a direct expense account\.'/)
  assert.match(client, /export const NO_MANUAL_ACCOUNTS_MESSAGE = 'No manual expense accounts are available in this category\.'/)
  assert.match(client, /export const CLASSIFICATION_LOAD_ERROR = 'Unable to load account classifications'/)
  assert.match(setupView, /CLASSIFICATION_LOAD_ERROR/)
  assert.match(setupView, /Retry/)
  assert.match(expenseView, /CLASSIFICATION_LOAD_ERROR/)
})

test('no screen shows database or RPC terminology', () => {
  for (const [name, view] of [
    ['setup', setupView], ['expense batch', expenseView], ['trial balance', trialBalanceView],
    ['reports', reportsView], ['audit log', auditView], ['chart of accounts', coaView],
  ] as const) {
    assert.doesNotMatch(view, /account_categories|is_system|root_id|parent_id|\brpc\b/, `${name} leaks schema terminology`)
  }
})

test('the chart of accounts presents accounts under their fixed accounting type', () => {
  assert.match(coaView, /function rootGroups\(categories: Category\[\]\)/)
  assert.match(coaView, /if \(\(category\.depth \?\? 0\) !== 0\) continue/)
  assert.match(coaView, /Type \/ Category/)
  // A generated category code never reaches the screen.
  assert.doesNotMatch(coaView, /\{c\.code\}/)
})
