/**
 * Client-side view of the account classification served by
 * /api/account-classification (fixed accounting roots → categories →
 * subcategories → ledger accounts).
 *
 * The server RPCs stay authoritative for every rule; these helpers only shape
 * that payload into the cascades the screens render, so no screen re-derives
 * the hierarchy on its own.
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
  /** True when the account may be renamed / reclassified from the setup screen. */
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
export const NO_CATEGORIES_MESSAGE = 'No categories created yet.'
export const NO_SUBCATEGORIES_MESSAGE = 'No subcategories — you can select a direct expense account.'
export const NO_MANUAL_ACCOUNTS_MESSAGE = 'No manual expense accounts are available in this category.'

/**
 * Accounts that hang off a fixed root instead of a user category (every account
 * that existed before categories were introduced). They stay selectable through
 * this pseudo-category so no existing posting flow loses its destination.
 */
export const DIRECT_ACCOUNT_GROUP = '__direct__'
export const DIRECT_ACCOUNT_GROUP_LABEL = 'Direct expense accounts'

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

/** Every category under a root, inactive included — the management screen shows both. */
export function categoriesForRoot(tree: ClassificationTree | null, rootId: string | null): ClassificationNodeDto[] {
  if (!tree || !rootId) return []
  return tree.categories.filter((node) => node.rootId === rootId).sort(byName)
}

export function subcategoriesForCategory(
  tree: ClassificationTree | null,
  categoryId: string | null,
): ClassificationNodeDto[] {
  if (!tree || !categoryId) return []
  return tree.subcategories.filter((node) => node.parentId === categoryId).sort(byName)
}

/** Only these may be picked for something new; inactive nodes stay visible in history. */
export function activeCategories(tree: ClassificationTree | null, rootId: string | null): ClassificationNodeDto[] {
  return categoriesForRoot(tree, rootId).filter((node) => node.isActive)
}

export function activeSubcategories(
  tree: ClassificationTree | null,
  categoryId: string | null,
): ClassificationNodeDto[] {
  return subcategoriesForCategory(tree, categoryId).filter((node) => node.isActive)
}

export type ManualAccountOption = {
  id: string
  code: string
  name: string
  subcategoryId: string | null
  subcategoryName: string | null
}

function toOption(
  account: ClassificationAccountDto,
  subcategoryNames: Map<string, string>,
): ManualAccountOption {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    subcategoryId: account.subcategoryId,
    subcategoryName: account.subcategoryId ? subcategoryNames.get(account.subcategoryId) ?? null : null,
  }
}

function manualAccounts(tree: ClassificationTree, rootId: string): ClassificationAccountDto[] {
  return tree.accounts.filter((account) => account.rootId === rootId && account.isActive && account.isManual)
}

/**
 * Manual, active accounts inside one category — linked to the category itself or
 * to one of its subcategories. Pass DIRECT_ACCOUNT_GROUP for the accounts that
 * hang off the fixed root.
 */
export function manualAccountsInCategory(
  tree: ClassificationTree | null,
  rootId: string | null,
  categoryId: string | null,
): ManualAccountOption[] {
  if (!tree || !rootId || !categoryId) return []
  const names = new Map(tree.subcategories.map((node) => [node.id, node.name]))
  return manualAccounts(tree, rootId)
    .filter((account) => categoryId === DIRECT_ACCOUNT_GROUP
      ? !account.categoryId && !account.subcategoryId
      : account.categoryId === categoryId)
    .sort(byCode)
    .map((account) => toOption(account, names))
}

/** Every manual, active account under a root — used when a business has no categories yet. */
export function manualAccountsInRoot(
  tree: ClassificationTree | null,
  rootId: string | null,
): ManualAccountOption[] {
  if (!tree || !rootId) return []
  const names = new Map(tree.subcategories.map((node) => [node.id, node.name]))
  return manualAccounts(tree, rootId).sort(byCode).map((account) => toOption(account, names))
}

/** True when manual accounts still hang off the fixed root itself. */
export function hasDirectAccounts(tree: ClassificationTree | null, rootId: string | null): boolean {
  return manualAccountsInCategory(tree, rootId, DIRECT_ACCOUNT_GROUP).length > 0
}

/**
 * Group account options under their subcategory, so a single dropdown can show
 * the subcategories of a category and the accounts inside them at once.
 */
export function groupBySubcategory(
  options: ManualAccountOption[],
  directLabel: string,
): Array<{ key: string; label: string; accounts: ManualAccountOption[] }> {
  const groups: Array<{ key: string; label: string; accounts: ManualAccountOption[] }> = []
  const positions = new Map<string, number>()
  for (const option of options) {
    const key = option.subcategoryId ?? 'direct'
    let at = positions.get(key)
    if (at === undefined) {
      at = groups.length
      positions.set(key, at)
      groups.push({ key, label: option.subcategoryName ?? directLabel, accounts: [] })
    }
    groups[at].accounts.push(option)
  }
  return groups
}

/** "Category › Subcategory" for a row label; empty when the account sits on a root. */
export function classificationPath(
  tree: ClassificationTree | null,
  account: { categoryId: string | null; subcategoryId: string | null },
): string {
  if (!tree) return ''
  const category = account.categoryId
    ? tree.categories.find((node) => node.id === account.categoryId)
    : null
  const subcategory = account.subcategoryId
    ? tree.subcategories.find((node) => node.id === account.subcategoryId)
    : null
  return [category?.name, subcategory?.name].filter(Boolean).join(' › ')
}
