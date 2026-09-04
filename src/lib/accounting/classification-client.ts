/**
 * Client-side view of the account classification served by
 * /api/account-classification: five fixed accounting roots, each holding the
 * categories the business created.
 *
 * The server stays authoritative for every rule — including which ledger account
 * a category posts to. These helpers only shape the payload into the lists the
 * screens render, so no screen re-derives the hierarchy or picks an account of
 * its own accord.
 */
import { ApiRequestError, apiFetchJson } from '@/lib/api-client'

export type ClassificationRootDto = {
  id: string
  code: string
  name: string
  type: string
  /** `Income` is stored, `Revenue` is shown. */
  displayType: string
  isActive: boolean
}

export type ClassificationNodeDto = {
  id: string
  name: string
  type: string
  displayType: string
  rootId: string
  parentId: string
  isActive: boolean
}

export type ClassificationAccountDto = {
  id: string
  code: string
  name: string
  rootId: string
  rootType: string
  displayType: string
  categoryId: string | null
  subcategoryId: string | null
  isActive: boolean
  isSystem: boolean
  /** True when the account is one a user may name and classify. */
  isManual: boolean
}

export type ClassificationTree = {
  roots: ClassificationRootDto[]
  categories: ClassificationNodeDto[]
  subcategories: ClassificationNodeDto[]
  accounts: ClassificationAccountDto[]
  /** Server's verdict on whether this user may change the classification. */
  canManage: boolean
}
export const CLASSIFICATION_LOAD_ERROR = 'Unable to load account classifications'
export const NO_CATEGORIES_MESSAGE = 'No categories yet.'
export const NO_EXPENSE_CATEGORIES_MESSAGE = 'No expense categories yet — add one under Account Categories.'
export const EXPENSE_CATEGORY_GROUP_LABEL = 'Expense categories'
export const OTHER_EXPENSE_ACCOUNTS_LABEL = 'Other expense accounts'

/**
 * Shared React Query key and cache lifetime for the tree. Every screen reads it
 * under the same key, so the classification is fetched once and reused instead
 * of once per screen; the setup screen invalidates that key after each change,
 * which overrides the lifetime, so a consumer never shows a stale list.
 */
export const CLASSIFICATION_QUERY_KEY = ['account-classification'] as const
export const CLASSIFICATION_STALE_TIME_MS = 300_000

/**
 * A deployment without the classification schema answers 503; the caller then
 * falls back to its plain account list instead of showing an error.
 */
export function isClassificationUnavailable(error: unknown): boolean {
  if (error instanceof ApiRequestError) return error.status === 503 || error.code === 'FEATURE_UNAVAILABLE'
  return false
}

/** Loads the tree, or null when this deployment has no classification layer. */
export async function fetchClassificationTree(signal?: AbortSignal): Promise<ClassificationTree | null> {
  try {
    const data = await apiFetchJson<Partial<ClassificationTree>>('/api/account-classification', { signal })
    return {
      roots: data.roots ?? [],
      categories: data.categories ?? [],
      subcategories: data.subcategories ?? [],
      accounts: data.accounts ?? [],
      canManage: data.canManage === true,
    }
  } catch (error) {
    if (isClassificationUnavailable(error)) return null
    throw error
  }
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code)

/** The fixed root for a stored accounting type ('Asset', 'Expense', 'Income', …). */
export function rootByType(tree: ClassificationTree | null, type: string): ClassificationRootDto | null {
  return tree?.roots.find((root) => root.type === type) ?? null
}

/** Every category under a root, inactive included — the setup screen shows both. */
export function categoriesForRoot(tree: ClassificationTree | null, rootId: string | null): ClassificationNodeDto[] {
  if (!tree || !rootId) return []
  return tree.categories.filter((node) => node.rootId === rootId).sort(byName)
}

/** Only these may be picked for something new; inactive ones stay visible in history. */
export function activeCategories(tree: ClassificationTree | null, rootId: string | null): ClassificationNodeDto[] {
  return categoriesForRoot(tree, rootId).filter((node) => node.isActive)
}
/** What an expense line is posted against: a category, or one plain account. */
export type ExpenseChoice = {
  value: string
  label: string
  /** Shown only for a plain account, so the chart of accounts stays recognisable. */
  code?: string
  categoryId?: string
  expenseAccountId?: string
}

export type ExpenseChoiceGroup = { key: string; label: string; choices: ExpenseChoice[] }

const CATEGORY_VALUE_PREFIX = 'category:'
const ACCOUNT_VALUE_PREFIX = 'account:'

/** Categories that already have a ledger account behind them, so they can post. */
function postableCategories(tree: ClassificationTree, rootId: string): ClassificationNodeDto[] {
  const linked = new Set(
    tree.accounts
      .filter((account) => account.isActive && account.isManual && account.categoryId)
      .map((account) => account.categoryId),
  )
  return activeCategories(tree, rootId).filter((node) => linked.has(node.id))
}

/**
 * The single choice an expense line needs. A category is the normal answer; the
 * second group only appears for manual accounts that never had a category, so no
 * destination that used to work quietly disappears. System-managed accounts
 * (Purchases / COGS, Salesman Commission Expense) are never offered.
 */
export function expenseChoiceGroups(
  tree: ClassificationTree | null,
  rootId: string | null,
): ExpenseChoiceGroup[] {
  if (!tree || !rootId) return []
  const groups: ExpenseChoiceGroup[] = []
  const categories = postableCategories(tree, rootId)
  if (categories.length > 0) {
    groups.push({
      key: 'categories',
      label: EXPENSE_CATEGORY_GROUP_LABEL,
      choices: categories.map((node) => ({
        value: `${CATEGORY_VALUE_PREFIX}${node.id}`,
        label: node.name,
        categoryId: node.id,
      })),
    })
  }
  const direct = tree.accounts
    .filter((account) => account.rootId === rootId && account.isActive && account.isManual
      && !account.categoryId && !account.subcategoryId)
    .sort(byCode)
  if (direct.length > 0) {
    groups.push({
      key: 'accounts',
      label: OTHER_EXPENSE_ACCOUNTS_LABEL,
      choices: expenseAccountChoices(direct),
    })
  }
  return groups
}

/**
 * The same picker shape for a plain account list — used on a deployment that has
 * no classification layer at all, so this screen keeps working there unchanged.
 */
export function expenseAccountChoices(
  accounts: Array<{ id: string; code: string; name: string }>,
): ExpenseChoice[] {
  return [...accounts].sort(byCode).map((account) => ({
    value: `${ACCOUNT_VALUE_PREFIX}${account.id}`,
    label: account.name,
    code: account.code,
    expenseAccountId: account.id,
  }))
}

/** The choice behind a stored value, so a line always posts what the user saw. */
export function findExpenseChoice(groups: ExpenseChoiceGroup[], value: string): ExpenseChoice | null {
  for (const group of groups) {
    const choice = group.choices.find((entry) => entry.value === value)
    if (choice) return choice
  }
  return null
}
