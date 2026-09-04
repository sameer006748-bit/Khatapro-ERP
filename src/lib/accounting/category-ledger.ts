/**
 * The ledger account behind a user category.
 *
 * Clients pick a plain category ("Expense → Lunch Expense"); double-entry still
 * needs a ledger account. This module composes the service-role RPCs shipped by
 * 00042 so that account is created, renamed, (de)activated and removed together
 * with its category — no new migration, and not one database rule re-stated in
 * TypeScript: every write still goes through manage_account_category,
 * manage_account_subcategory or manage_manual_ledger_account, so hierarchy,
 * permission and system-account invariants stay enforced inside Postgres.
 */
import 'server-only'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/auth/permissions'
import {
  AccountClassificationRejectedError,
  DUPLICATE_ACCOUNT_CODE_MESSAGE,
  listAccountClassification,
  manageAccountCategory,
  manageAccountSubcategory,
  manageManualLedgerAccount,
  type AccountClassificationTree,
  type ClassificationAccount,
  type ClassificationNode,
} from './legacy-account-classification'

export type ClassificationActor = { businessId: string; actorProfileId: string }

/**
 * Code bands, unchanged since the first seeded chart of accounts: 1xxx Asset,
 * 2xxx Liability, 3xxx Equity, 4xxx Income, 5xxx Expense, spaced by 10. An
 * automatic account takes the first free slot in its own band, so the chart
 * still reads as if it had been numbered by hand.
 */
export const ROOT_CODE_BANDS: Record<string, number> = {
  Asset: 1000,
  Liability: 2000,
  Equity: 3000,
  Income: 4000,
  Expense: 5000,
}

export const NO_CODE_LEFT_MESSAGE =
  'No account code is free for this accounting type. Add the account from the Chart of Accounts instead.'
export const CATEGORY_IN_USE_MESSAGE =
  'This category has already been used and cannot be deleted. Deactivate it instead.'
export const CATEGORY_NOT_READY_MESSAGE =
  'This category is not ready to be used yet. Open Account Categories once to finish setting it up.'
export const CATEGORY_UNAVAILABLE_MESSAGE =
  'This category is not available. Refresh the page and pick an active category.'
/** The ledger account that carries one category's postings. */
export type LinkedLedger = { id: string; code: string; name: string; created: boolean }

/** First free code in the band of a fixed accounting root. */
export function nextLedgerCode(tree: AccountClassificationTree, rootType: string): string {
  const band = ROOT_CODE_BANDS[rootType]
  if (!band) throw new AccountClassificationRejectedError(NO_CODE_LEFT_MESSAGE)
  const used = new Set(tree.accounts.map((account) => account.code))
  for (const step of [10, 1]) {
    for (let candidate = band + step; candidate < band + 1000; candidate += step) {
      const code = String(candidate)
      if (!used.has(code)) return code
    }
  }
  throw new AccountClassificationRejectedError(NO_CODE_LEFT_MESSAGE)
}

/**
 * The account a category posts to: linked to the category itself, or — for the
 * subcategory rows that predate this workflow — to one of its subcategories.
 * Direct links win, then the lowest code, so the answer never changes between
 * two reads of the same tree.
 */
export function linkedLedgerAccount(
  tree: AccountClassificationTree,
  categoryId: string,
): ClassificationAccount | null {
  const ranked = tree.accounts
    .filter((account) => account.categoryId === categoryId && account.isActive && account.isManual)
    .sort((a, b) =>
      Number(Boolean(a.subcategoryId)) - Number(Boolean(b.subcategoryId)) || a.code.localeCompare(b.code))
  return ranked[0] ?? null
}

function subcategoriesOf(tree: AccountClassificationTree, categoryId: string): ClassificationNode[] {
  return tree.subcategories.filter((node) => node.parentId === categoryId)
}

/** Accounts this module may act on; system, business and party accounts are never touched. */
function manualAccountsUnder(tree: AccountClassificationTree, categoryId: string): ClassificationAccount[] {
  return tree.accounts.filter((account) => account.categoryId === categoryId && account.isManual)
}

async function refreshAccounts(actor: ClassificationActor, tree: AccountClassificationTree): Promise<void> {
  const fresh = await listAccountClassification(actor.businessId, actor.actorProfileId)
  tree.accounts.splice(0, tree.accounts.length, ...fresh.accounts)
}
/**
 * Guarantee that a category has a ledger account behind it.
 *
 * Idempotent by construction: an existing link is returned untouched, so a
 * retried request, a double-submitted form or two screens loading at once can
 * never leave two accounts on one category. A lost race for a code surfaces as
 * the unique (business, code) violation; that one case re-reads the tree and
 * takes the next free code instead of failing the user's action.
 */
export async function ensureCategoryLedgerAccount(
  actor: ClassificationActor,
  tree: AccountClassificationTree,
  category: ClassificationNode,
): Promise<LinkedLedger> {
  const existing = linkedLedgerAccount(tree, category.id)
  if (existing) return { id: existing.id, code: existing.code, name: existing.name, created: false }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = nextLedgerCode(tree, category.type)
    try {
      const { account } = await manageManualLedgerAccount({
        ...actor,
        action: 'create',
        accountCode: code,
        name: category.name,
        categoryId: category.id,
      })
      if (!account) throw new AccountClassificationRejectedError()
      // Keep the caller's tree truthful so a healing pass over many categories
      // allocates a distinct code for each one from a single loaded tree.
      tree.accounts.push({
        id: account.id,
        code: account.code,
        name: account.name,
        rootId: category.rootId,
        rootType: category.type,
        displayType: category.displayType,
        categoryId: category.id,
        subcategoryId: null,
        isActive: account.isActive,
        isSystem: account.isSystem,
        isManual: true,
      })
      return { id: account.id, code: account.code, name: account.name, created: true }
    } catch (error) {
      const codeTaken = error instanceof AccountClassificationRejectedError
        && error.message === DUPLICATE_ACCOUNT_CODE_MESSAGE
      if (!codeTaken) throw error
      await refreshAccounts(actor, tree)
      const linked = linkedLedgerAccount(tree, category.id)
      if (linked) return { id: linked.id, code: linked.code, name: linked.name, created: false }
    }
  }
  throw new AccountClassificationRejectedError(NO_CODE_LEFT_MESSAGE)
}
/** A ledger account this workflow had to create, described for an audit row. */
export type CreatedCategoryLedger = {
  categoryId: string
  categoryName: string
  displayType: string
  code: string
  name: string
}

/**
 * Bring every active category up to date in one pass. Categories created before
 * this workflow existed get their account the first time somebody who may manage
 * the classification opens a screen that reads the tree; once linked, the pass
 * writes nothing at all. One category that cannot be linked never blocks the
 * rest — the screen still loads, and that category stays unusable until its own
 * error is dealt with.
 */
export async function ensureCategoryLedgerAccounts(
  actor: ClassificationActor,
  tree: AccountClassificationTree,
): Promise<{ created: CreatedCategoryLedger[]; failed: number }> {
  const created: CreatedCategoryLedger[] = []
  let failed = 0
  for (const category of tree.categories) {
    if (!category.isActive) continue
    try {
      const ledger = await ensureCategoryLedgerAccount(actor, tree, category)
      if (ledger.created) {
        created.push({
          categoryId: category.id,
          categoryName: category.name,
          displayType: category.displayType,
          code: ledger.code,
          name: ledger.name,
        })
      }
    } catch {
      failed += 1
    }
  }
  return { created, failed }
}

/**
 * Rename the category and keep its automatic account in step — but only while
 * that account still carries the category's old name, so a name deliberately
 * chosen in the Chart of Accounts is never overwritten. The RPC writes its own
 * ledger-rename audit row, so the change stays visible.
 */
export async function renameCategoryWithLedger(
  actor: ClassificationActor,
  tree: AccountClassificationTree,
  categoryId: string,
  name: string,
): Promise<{ category: ClassificationNode | null; ledgerRenamed: boolean }> {
  const before = tree.categories.find((node) => node.id === categoryId) ?? null
  const linked = linkedLedgerAccount(tree, categoryId)
  const { category } = await manageAccountCategory({ ...actor, action: 'rename', categoryId, name })
  if (!before || !linked || linked.name !== before.name) return { category, ledgerRenamed: false }
  await manageManualLedgerAccount({ ...actor, action: 'rename', accountId: linked.id, name })
  return { category, ledgerRenamed: true }
}
/**
 * Deactivate in the order the database expects: accounts, then subcategories,
 * then the category itself — the 00042 triggers refuse any other order. Only
 * manual accounts are deactivated; anything system-managed is left alone on
 * purpose, so the database's own refusal reaches the user unchanged instead of
 * this code quietly disabling an account it does not own.
 */
export async function deactivateCategoryWithLedger(
  actor: ClassificationActor,
  tree: AccountClassificationTree,
  categoryId: string,
): Promise<{ category: ClassificationNode | null }> {
  for (const account of manualAccountsUnder(tree, categoryId)) {
    if (!account.isActive) continue
    await manageManualLedgerAccount({ ...actor, action: 'deactivate', accountId: account.id })
  }
  for (const subcategory of subcategoriesOf(tree, categoryId)) {
    if (!subcategory.isActive) continue
    await manageAccountSubcategory({ ...actor, action: 'deactivate', subcategoryId: subcategory.id })
  }
  return manageAccountCategory({ ...actor, action: 'deactivate', categoryId })
}

/** The reverse order: a child may only be active under an active parent. */
export async function reactivateCategoryWithLedger(
  actor: ClassificationActor,
  tree: AccountClassificationTree,
  categoryId: string,
): Promise<{ category: ClassificationNode | null }> {
  const result = await manageAccountCategory({ ...actor, action: 'reactivate', categoryId })
  for (const subcategory of subcategoriesOf(tree, categoryId)) {
    if (subcategory.isActive) continue
    await manageAccountSubcategory({ ...actor, action: 'reactivate', subcategoryId: subcategory.id })
  }
  for (const account of manualAccountsUnder(tree, categoryId)) {
    if (account.isActive) continue
    await manageManualLedgerAccount({ ...actor, action: 'activate', accountId: account.id })
  }
  return result
}
/** Anything unreadable counts as "in use": an unused account is proven, never assumed. */
function hasBalance(raw: unknown): boolean {
  try {
    return BigInt(String(raw ?? 0)) !== 0n
  } catch {
    return true
  }
}

type UsageRow = {
  id: string
  balance_cache: string | number | null
  is_system: boolean
  is_business_account: boolean
  is_party_account: boolean
}

/**
 * Prove that every automatic account of a category can go: no voucher line, no
 * expense line, no child account, zero balance, and none of the system flags.
 * A failed query aborts the delete — the same answer as "in use" — so a database
 * problem can never be read as permission to delete.
 */
async function assertAccountsDeletable(businessId: string, accountIds: string[]): Promise<void> {
  const supabase = getAdminSupabase()
  const inUse = () => new AccountClassificationRejectedError(CATEGORY_IN_USE_MESSAGE)
  const [accounts, voucherLines, expenseLines, children] = await Promise.all([
    supabase.from('accounts')
      .select('id, balance_cache, is_system, is_business_account, is_party_account')
      .eq('business_id', businessId).in('id', accountIds),
    supabase.from('voucher_lines').select('id')
      .eq('business_id', businessId).in('account_id', accountIds).limit(1),
    supabase.from('expense_lines').select('id')
      .eq('business_id', businessId).in('expense_account_id', accountIds).limit(1),
    supabase.from('accounts').select('id')
      .eq('business_id', businessId).in('parent_id', accountIds).limit(1),
  ])
  for (const result of [accounts, voucherLines, expenseLines, children]) {
    if (result.error) throw inUse()
  }
  for (const result of [voucherLines, expenseLines, children]) {
    if ((result.data ?? []).length > 0) throw inUse()
  }
  const rows = (accounts.data ?? []) as UsageRow[]
  if (rows.length !== accountIds.length) throw inUse()
  for (const row of rows) {
    if (row.is_system || row.is_business_account || row.is_party_account) throw inUse()
    if (hasBalance(row.balance_cache)) throw inUse()
  }
}
/**
 * The delete repeats the flag checks as its own WHERE clause, so an account that
 * becomes system-managed between the proof and the delete is skipped by the
 * statement itself rather than by this process's view of the world.
 */
async function deleteDeletableAccounts(businessId: string, accountIds: string[]): Promise<void> {
  const { error } = await getAdminSupabase().from('accounts').delete()
    .eq('business_id', businessId)
    .in('id', accountIds)
    .eq('is_system', false)
    .eq('is_business_account', false)
    .eq('is_party_account', false)
  if (error) throw new AccountClassificationRejectedError(CATEGORY_IN_USE_MESSAGE)
}

/**
 * Delete a category and everything this workflow created under it, or refuse.
 * An account the client did not get automatically (a business, party or system
 * account classified here) is never removed on their behalf: that is a refusal,
 * with the deactivate hint the client can act on.
 */
export async function deleteCategoryIfSafe(
  actor: ClassificationActor,
  tree: AccountClassificationTree,
  categoryId: string,
): Promise<{ removedAccounts: Array<{ id: string; code: string; name: string }> }> {
  const foreign = tree.accounts.some((account) => account.categoryId === categoryId && !account.isManual)
  if (foreign) throw new AccountClassificationRejectedError(CATEGORY_IN_USE_MESSAGE)

  const accounts = manualAccountsUnder(tree, categoryId)
  if (accounts.length > 0) {
    const ids = accounts.map((account) => account.id)
    await assertAccountsDeletable(actor.businessId, ids)
    await deleteDeletableAccounts(actor.businessId, ids)
  }
  for (const subcategory of subcategoriesOf(tree, categoryId)) {
    await manageAccountSubcategory({ ...actor, action: 'delete', subcategoryId: subcategory.id })
  }
  await manageAccountCategory({ ...actor, action: 'delete', categoryId })
  return {
    removedAccounts: accounts.map(({ id, code, name }) => ({ id, code, name })),
  }
}
export type ResolvedCategoryLedger = {
  categoryId: string
  categoryName: string
  accountId: string
  accountCode: string
  accountName: string
}

export type CategoryLedgerResolution = {
  resolved: Map<string, ResolvedCategoryLedger>
  /** Real categories that have no ledger account behind them yet. */
  notReady: string[]
  /** Unknown, inactive, system-managed, or not a user category at all. */
  unavailable: string[]
}

type CategoryRow = { id: string; name: string; depth: number; is_active: boolean; is_system: boolean }

function readFailed(table: string, message: string): Error {
  return new Error(`Category ledger resolution failed reading ${table}: ${message}`)
}

/**
 * Category → ledger account for whoever is posting.
 *
 * Read with the service-role client scoped by business_id rather than through
 * list_account_classification, because that RPC asserts a classification
 * *manager* — which a user who may only post an expense batch is not. Read-only
 * and same-business, and a query error throws instead of answering
 * "unavailable", so a database fault is never reported to the user as a bad
 * category.
 */
export async function resolveCategoryLedgerAccounts(
  businessId: string,
  categoryIds: string[],
): Promise<CategoryLedgerResolution> {
  const wanted = [...new Set(categoryIds)]
  const resolved = new Map<string, ResolvedCategoryLedger>()
  if (wanted.length === 0) return { resolved, notReady: [], unavailable: [] }

  const supabase = getAdminSupabase()
  const categories = await supabase.from('account_categories')
    .select('id, name, depth, is_active, is_system')
    .eq('business_id', businessId).in('id', wanted)
  if (categories.error) throw readFailed('account_categories', categories.error.message)

  const usable = new Map<string, string>()
  for (const row of (categories.data ?? []) as CategoryRow[]) {
    if (row.depth === 1 && row.is_active && !row.is_system) usable.set(row.id, row.name)
  }
  const unavailable = wanted.filter((id) => !usable.has(id))
  if (usable.size === 0) return { resolved, notReady: [], unavailable }
  // A preserved subcategory row still posts through its parent category, so the
  // account may hang off either level.
  const owners = new Map<string, string>()
  for (const id of usable.keys()) owners.set(id, id)
  const children = await supabase.from('account_categories')
    .select('id, parent_id')
    .eq('business_id', businessId).eq('depth', 2).in('parent_id', [...usable.keys()])
  if (children.error) throw readFailed('account_categories', children.error.message)
  for (const row of (children.data ?? []) as Array<{ id: string; parent_id: string | null }>) {
    if (row.parent_id) owners.set(row.id, row.parent_id)
  }

  const accounts = await supabase.from('accounts')
    .select('id, code, name, category_id')
    .eq('business_id', businessId).in('category_id', [...owners.keys()])
    .eq('is_active', true).eq('is_system', false)
    .eq('is_business_account', false).eq('is_party_account', false)
    .order('code', { ascending: true })
  if (accounts.error) throw readFailed('accounts', accounts.error.message)

  const settled = new Set<string>()
  for (const row of (accounts.data ?? []) as Array<{ id: string; code: string; name: string; category_id: string }>) {
    const owner = owners.get(row.category_id)
    if (!owner) continue
    const categoryName = usable.get(owner)
    if (categoryName === undefined) continue
    const direct = row.category_id === owner
    if (resolved.has(owner) && (!direct || settled.has(owner))) continue
    resolved.set(owner, {
      categoryId: owner,
      categoryName,
      accountId: row.id,
      accountCode: row.code,
      accountName: row.name,
    })
    if (direct) settled.add(owner)
  }
  const notReady = [...usable.keys()].filter((id) => !resolved.has(id))
  return { resolved, notReady, unavailable }
}

/**
 * An audit row that describes work the user has already completed successfully.
 * Losing it must not turn that success into a failure, so the write is
 * best-effort; writeAudit already logs the underlying database error.
 */
export async function safeAudit(entry: Parameters<typeof writeAudit>[0]): Promise<void> {
  try {
    await writeAudit(entry)
  } catch {
    return
  }
}
