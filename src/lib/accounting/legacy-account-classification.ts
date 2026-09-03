/**
 * Custom account classification — server-side seam over the production RPCs
 * shipped by 00042_legacy_account_classification.sql:
 *   list_account_classification, manage_account_category,
 *   manage_account_subcategory, manage_manual_ledger_account.
 *
 * Those RPCs are service-role only and enforce business isolation, actor
 * permissions and every hierarchy / lifecycle / system-account invariant inside
 * Postgres. This module never re-implements those rules: it maps the payload to
 * the fields the UI needs and turns database errors into user-facing copy.
 */
import 'server-only'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { usesLegacyTransactionSchema } from '@/lib/identity/legacy-bridge'
import { classifyPostgrestCompatibilityError, type PostgrestLikeError } from '@/lib/dashboard/compatibility'

export const ACCOUNT_CLASSIFICATION_UNAVAILABLE_MESSAGE = 'Account classification is currently unavailable.'
export const ACCOUNT_CLASSIFICATION_DENIED_MESSAGE = 'You do not have permission to manage account classifications.'
export const ACCOUNT_CLASSIFICATION_GENERIC_MESSAGE = 'This classification change could not be saved.'

export class AccountClassificationUnavailableError extends Error {
  readonly code = 'FEATURE_UNAVAILABLE'
  constructor(message = ACCOUNT_CLASSIFICATION_UNAVAILABLE_MESSAGE) {
    super(message)
    this.name = 'AccountClassificationUnavailableError'
  }
}

export class AccountClassificationDeniedError extends Error {
  readonly code = 'FORBIDDEN'
  constructor(message = ACCOUNT_CLASSIFICATION_DENIED_MESSAGE) {
    super(message)
    this.name = 'AccountClassificationDeniedError'
  }
}

export class AccountClassificationRejectedError extends Error {
  readonly code = 'CLASSIFICATION_REJECTED'
  constructor(message = ACCOUNT_CLASSIFICATION_GENERIC_MESSAGE) {
    super(message)
    this.name = 'AccountClassificationRejectedError'
  }
}

/** Stored accounting types are fixed; only the label shown to users differs. */
export function classificationDisplayType(type: string): string {
  return type === 'Income' ? 'Revenue' : type
}

/** One of the five fixed accounting roots. */
export type ClassificationRoot = {
  id: string
  code: string
  name: string
  type: string
  displayType: string
  isActive: boolean
}

/** A user-created category (under a root) or subcategory (under a category). */
export type ClassificationNode = {
  id: string
  name: string
  type: string
  displayType: string
  rootId: string
  parentId: string
  isActive: boolean
}

export type ClassificationAccount = {
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
  /** True when this account may be renamed / reclassified from the setup UI. */
  isManual: boolean
}

export type AccountClassificationTree = {
  roots: ClassificationRoot[]
  categories: ClassificationNode[]
  subcategories: ClassificationNode[]
  accounts: ClassificationAccount[]
}

export type CategoryAction = 'create' | 'rename' | 'deactivate' | 'reactivate' | 'delete'
export type ManualAccountAction = 'create' | 'rename' | 'activate' | 'deactivate' | 'classify'

/**
 * Database guard messages are already plain English, but they are written for
 * accountants reading a server log. Every rejection the UI can trigger is
 * mapped to setup-screen copy so no trigger, RPC or schema wording reaches the
 * user; anything unmapped falls back to the generic message.
 */
const FRIENDLY_MESSAGES: Array<[RegExp, string]> = [
  [/roots cannot be deleted|roots cannot be created|roots are immutable|accounting root are immutable/i,
    'The five main accounting types are fixed and cannot be changed.'],
  [/child subcategories cannot be deleted/i,
    'Delete or move the subcategories inside this category first.'],
  [/linked to ledger accounts cannot be deleted/i,
    'Accounts still use this category. Move those accounts first, or deactivate the category instead.'],
  [/Deactivate active child subcategories first/i,
    'Deactivate the subcategories inside this category first.'],
  [/Deactivate or reclassify active ledger accounts first/i,
    'Deactivate or move the accounts in this category first.'],
  [/Reactivate the parent category first/i, 'Reactivate the parent category first.'],
  [/cannot move across fixed accounting roots/i,
    'An account cannot be moved to a different accounting type.'],
  [/System-managed ledger accounts cannot|managed by a dedicated system workflow/i,
    'This account is maintained by the system and cannot be changed here.'],
  [/require an active classification|Reactivate the account classification first/i,
    'Reactivate the category of this account first.'],
  [/name must contain 1 to 80 characters/i, 'Enter a name of 1 to 80 characters.'],
  [/Account code must contain 2 to 32/i,
    'Enter an account code of 2 to 32 letters, numbers, dots, underscores or hyphens.'],
  [/Active fixed root is required/i, 'Select an accounting type.'],
  [/Active parent category is required|active parent/i, 'Select an active category.'],
  [/Active category or subcategory is required/i, 'Select an active category or subcategory.'],
  [/(Category|Subcategory|Ledger account) not found/i,
    'That entry no longer exists. Refresh the page and try again.'],
  [/must agree|hierarchy is invalid|Same-business/i, 'That classification is not valid.'],
]

function friendlyMessage(code: string, text: string): string {
  if (code === '23505') {
    return /sibling_name|categor/i.test(text)
      ? 'A category with this name already exists here.'
      : 'This account code is already used.'
  }
  for (const [pattern, message] of FRIENDLY_MESSAGES) {
    if (pattern.test(text)) return message
  }
  return ACCOUNT_CLASSIFICATION_GENERIC_MESSAGE
}

function fail(error: PostgrestLikeError | null): never {
  const kind = classifyPostgrestCompatibilityError(error)
  if (kind === 'missing-rpc' || kind === 'missing-table' || kind === 'missing-column') {
    throw new AccountClassificationUnavailableError()
  }
  const code = String(error?.code ?? '')
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ')
  if (code === '42501' || /access denied/i.test(text)) throw new AccountClassificationDeniedError()
  throw new AccountClassificationRejectedError(friendlyMessage(code, text))
}

type RawRoot = { id: string; code: string; name: string; type: string; displayType?: string; isActive: boolean }
type RawNode = RawRoot & { rootId: string; parentId: string; depth: number }
type RawAccount = {
  id: string
  code: string
  name: string
  rootId: string
  rootType: string
  categoryId: string | null
  subcategoryId: string | null
  classificationDepth: number
  isActive: boolean
  isSystem: boolean
  isBusinessAccount: boolean
  isPartyAccount: boolean
}

function mapRoot(row: RawRoot): ClassificationRoot {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    displayType: row.displayType ?? classificationDisplayType(row.type),
    isActive: row.isActive,
  }
}

function mapNode(row: RawNode): ClassificationNode {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    displayType: classificationDisplayType(row.type),
    rootId: row.rootId,
    parentId: row.parentId,
    isActive: row.isActive,
  }
}

function mapAccount(row: RawAccount): ClassificationAccount {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    rootId: row.rootId,
    rootType: row.rootType,
    displayType: classificationDisplayType(row.rootType),
    categoryId: row.categoryId,
    subcategoryId: row.subcategoryId,
    isActive: row.isActive,
    isSystem: row.isSystem,
    isManual: !row.isSystem && !row.isBusinessAccount && !row.isPartyAccount,
  }
}

/**
 * Full classification tree for a business. Inactive categories, subcategories
 * and accounts are included on purpose so historical rows and report drill-downs
 * still resolve; screens that offer new selections filter on `isActive`.
 */
export async function listAccountClassification(
  businessId: string,
  actorProfileId: string,
): Promise<AccountClassificationTree> {
  const { data, error } = await getAdminSupabase().rpc('list_account_classification', {
    p_business_id: businessId,
    p_actor_profile_id: actorProfileId,
  })
  if (error) fail(error)
  const payload = (data ?? {}) as {
    roots?: RawRoot[]
    categories?: RawNode[]
    subcategories?: RawNode[]
    accounts?: RawAccount[]
  }
  return {
    roots: (payload.roots ?? []).map(mapRoot),
    categories: (payload.categories ?? []).map(mapNode),
    subcategories: (payload.subcategories ?? []).map(mapNode),
    accounts: (payload.accounts ?? []).map(mapAccount),
  }
}

export async function manageAccountCategory(input: {
  businessId: string
  actorProfileId: string
  action: CategoryAction
  categoryId?: string | null
  rootId?: string | null
  name?: string | null
}): Promise<{ action: string; category: ClassificationNode | null }> {
  const { data, error } = await getAdminSupabase().rpc('manage_account_category', {
    p_business_id: input.businessId,
    p_actor_profile_id: input.actorProfileId,
    p_action: input.action,
    p_category_id: input.categoryId ?? null,
    p_root_id: input.rootId ?? null,
    p_name: input.name ?? null,
  })
  if (error) fail(error)
  const result = (data ?? {}) as { action?: string; category?: RawNode | null }
  return {
    action: result.action ?? input.action,
    category: result.category ? mapNode(result.category) : null,
  }
}

export async function manageAccountSubcategory(input: {
  businessId: string
  actorProfileId: string
  action: CategoryAction
  subcategoryId?: string | null
  categoryId?: string | null
  name?: string | null
}): Promise<{ action: string; subcategory: ClassificationNode | null }> {
  const { data, error } = await getAdminSupabase().rpc('manage_account_subcategory', {
    p_business_id: input.businessId,
    p_actor_profile_id: input.actorProfileId,
    p_action: input.action,
    p_subcategory_id: input.subcategoryId ?? null,
    p_category_id: input.categoryId ?? null,
    p_name: input.name ?? null,
  })
  if (error) fail(error)
  const result = (data ?? {}) as { action?: string; subcategory?: RawNode | null }
  return {
    action: result.action ?? input.action,
    subcategory: result.subcategory ? mapNode(result.subcategory) : null,
  }
}

/**
 * Create / rename / (de)activate / reclassify a manual ledger account. System,
 * business and party accounts are refused by the RPC itself.
 */
export async function manageManualLedgerAccount(input: {
  businessId: string
  actorProfileId: string
  action: ManualAccountAction
  accountId?: string | null
  accountCode?: string | null
  name?: string | null
  categoryId?: string | null
}): Promise<{ action: string; account: { id: string; code: string; name: string; categoryId: string; isActive: boolean; isSystem: boolean } | null }> {
  const { data, error } = await getAdminSupabase().rpc('manage_manual_ledger_account', {
    p_business_id: input.businessId,
    p_actor_profile_id: input.actorProfileId,
    p_action: input.action,
    p_account_id: input.accountId ?? null,
    p_account_code: input.accountCode ?? null,
    p_name: input.name ?? null,
    p_category_id: input.categoryId ?? null,
  })
  if (error) fail(error)
  const result = (data ?? {}) as { action?: string; account?: { id: string; code: string; name: string; categoryId: string; isActive: boolean; isSystem: boolean } | null }
  return { action: result.action ?? input.action, account: result.account ?? null }
}

/**
 * Flat classification labels for one ledger account, ready to render in a
 * report row. Names stay populated for inactive categories so historical rows
 * keep resolving.
 */
export type AccountClassificationLabel = {
  accountId: string
  accountCode: string
  rootId: string
  rootType: string
  displayType: string
  categoryId: string | null
  categoryName: string | null
  subcategoryId: string | null
  subcategoryName: string | null
}

/**
 * Report-side view of the tree: selector options plus per-account labels keyed
 * both by id and by account code, because the legacy report RPCs return codes.
 */
export type ClassificationOverlay = {
  /** False when the business never created a category — reports then behave exactly as before. */
  hasCustomClassification: boolean
  roots: Array<{ id: string; name: string; type: string; displayType: string }>
  categories: Array<{ id: string; name: string; rootId: string; isActive: boolean }>
  subcategories: Array<{ id: string; name: string; rootId: string; categoryId: string; isActive: boolean }>
  byAccountId: Record<string, AccountClassificationLabel>
  byAccountCode: Record<string, AccountClassificationLabel>
}

/**
 * Best-effort tree for read-only report enrichment: returns null instead of
 * throwing when the deployment has no classification schema or the actor may
 * not read it, so an enriched report degrades to its original output.
 */
export async function tryListAccountClassification(
  businessId: string,
  actorProfileId: string,
): Promise<AccountClassificationTree | null> {
  if (!isSupabaseConfigured() || !await usesLegacyTransactionSchema()) return null
  try {
    return await listAccountClassification(businessId, actorProfileId)
  } catch {
    return null
  }
}

/** Index a classification tree for report rendering and cascade selectors. */
export function buildClassificationOverlay(tree: AccountClassificationTree): ClassificationOverlay {
  const categoryById = new Map(tree.categories.map((node) => [node.id, node]))
  const subcategoryById = new Map(tree.subcategories.map((node) => [node.id, node]))
  const byAccountId: Record<string, AccountClassificationLabel> = {}
  const byAccountCode: Record<string, AccountClassificationLabel> = {}
  for (const account of tree.accounts) {
    const subcategory = account.subcategoryId ? subcategoryById.get(account.subcategoryId) ?? null : null
    const category = account.categoryId ? categoryById.get(account.categoryId) ?? null : null
    const label: AccountClassificationLabel = {
      accountId: account.id,
      accountCode: account.code,
      rootId: account.rootId,
      rootType: account.rootType,
      displayType: account.displayType,
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? null,
      subcategoryId: subcategory?.id ?? null,
      subcategoryName: subcategory?.name ?? null,
    }
    byAccountId[account.id] = label
    byAccountCode[account.code] = label
  }
  return {
    hasCustomClassification: tree.categories.length > 0,
    roots: tree.roots.map((root) => ({
      id: root.id, name: root.name, type: root.type, displayType: root.displayType,
    })),
    categories: tree.categories.map((node) => ({
      id: node.id, name: node.name, rootId: node.rootId, isActive: node.isActive,
    })),
    subcategories: tree.subcategories.map((node) => ({
      id: node.id, name: node.name, rootId: node.rootId, categoryId: node.parentId, isActive: node.isActive,
    })),
    byAccountId,
    byAccountCode,
  }
}
