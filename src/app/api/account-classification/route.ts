/**
 * GET  /api/account-classification — the classification tree (fixed roots,
 *      user categories, subcategories and every ledger account's placement).
 * POST /api/account-classification — category, subcategory and manual ledger
 *      account management.
 *
 * Both paths delegate to the service-role RPCs from migration 00042, which
 * re-check the actor's business and permissions inside Postgres. The checks
 * here only keep the API honest about status codes; the database stays
 * authoritative. There is no local/Prisma equivalent of this classification, so
 * a non-legacy deployment reports the feature as unavailable instead of
 * silently answering with different data.
 *
 * Category actions also maintain the ledger account behind the category, so a
 * client who only ever names a category ("Expense → Lunch Expense") still ends
 * up with a complete, postable chart of accounts.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { hasPermission, loadSessionUser, type SessionUser } from '@/lib/auth/permissions'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { usesLegacyTransactionSchema } from '@/lib/identity/legacy-bridge'
import {
  ACCOUNT_CLASSIFICATION_UNAVAILABLE_MESSAGE,
  AccountClassificationDeniedError,
  AccountClassificationRejectedError,
  AccountClassificationUnavailableError,
  listAccountClassification,
  manageAccountCategory,
  manageAccountSubcategory,
  manageManualLedgerAccount,
  type AccountClassificationTree,
} from '@/lib/accounting/legacy-account-classification'
import {
  deactivateCategoryWithLedger,
  deleteCategoryIfSafe,
  ensureCategoryLedgerAccount,
  ensureCategoryLedgerAccounts,
  reactivateCategoryWithLedger,
  renameCategoryWithLedger,
  safeAudit,
  type ClassificationActor,
} from '@/lib/accounting/category-ledger'
import { resolveRequestId, safeApiError, safeMutationError, withObservability } from '@/lib/observability'

const MANAGE_PERMISSIONS = ['can_manage_setup', 'can_manage_account_categories', 'can_manage_chart_of_accounts'] as const
const VIEW_PERMISSIONS = [
  ...MANAGE_PERMISSIONS,
  'can_view_account_balances', 'can_view_reports', 'can_view_trial_balance',
  'can_view_balance_sheet', 'can_view_pl',
] as const

function isPrivilegedRole(user: SessionUser): boolean {
  return user.roleName === 'Owner' || user.roleName === 'Admin' || user.roleName === 'Owner/Admin'
}

function canManageClassification(user: SessionUser): boolean {
  return isPrivilegedRole(user) || MANAGE_PERMISSIONS.some((code) => hasPermission(user, code))
}

function canViewClassification(user: SessionUser): boolean {
  return isPrivilegedRole(user) || VIEW_PERMISSIONS.some((code) => hasPermission(user, code))
}

function unavailableResponse() {
  return NextResponse.json(
    { error: 'FEATURE_UNAVAILABLE', message: ACCOUNT_CLASSIFICATION_UNAVAILABLE_MESSAGE },
    { status: 503 },
  )
}

/** The classification only exists in the legacy production accounting schema. */
async function classificationAvailable(): Promise<boolean> {
  return isSupabaseConfigured() && await usesLegacyTransactionSchema()
}

async function sessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  return loadSessionUser((session.user as any).id)
}

const Identifier = z.string().trim().min(1).max(64)
const NodeName = z.string().trim().min(1).max(80)
const NodeAction = z.enum(['create', 'rename', 'deactivate', 'reactivate', 'delete'])

const MutationSchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('category'),
    action: NodeAction,
    categoryId: Identifier.optional(),
    rootId: Identifier.optional(),
    name: NodeName.optional(),
  }),
  z.object({
    scope: z.literal('subcategory'),
    action: NodeAction,
    subcategoryId: Identifier.optional(),
    categoryId: Identifier.optional(),
    name: NodeName.optional(),
  }),
  z.object({
    scope: z.literal('account'),
    action: z.enum(['create', 'rename', 'activate', 'deactivate', 'classify']),
    accountId: Identifier.optional(),
    accountCode: z.string().trim().min(2).max(32).optional(),
    name: NodeName.optional(),
    categoryId: Identifier.optional(),
  }),
])

type Mutation = z.infer<typeof MutationSchema>

/**
 * Required fields per action. The RPCs reject incomplete input too, but failing
 * here keeps the response a plain 400 instead of a database rejection.
 */
function hasRequiredFields(input: Mutation): boolean {
  if (input.scope === 'category') {
    if (input.action === 'create') return Boolean(input.rootId && input.name)
    if (input.action === 'rename') return Boolean(input.categoryId && input.name)
    return Boolean(input.categoryId)
  }
  if (input.scope === 'subcategory') {
    if (input.action === 'create') return Boolean(input.categoryId && input.name)
    if (input.action === 'rename') return Boolean(input.subcategoryId && input.name)
    return Boolean(input.subcategoryId)
  }
  if (input.action === 'create') return Boolean(input.accountCode && input.name && input.categoryId)
  if (input.action === 'rename') return Boolean(input.accountId && input.name)
  if (input.action === 'classify') return Boolean(input.accountId && input.categoryId)
  return Boolean(input.accountId)
}

type CategoryMutation = Extract<Mutation, { scope: 'category' }>
type CategoryResult = { action: string; category: unknown; ledgerCode?: string }

/** "Linked ledger created automatically", in the audit log's own vocabulary. */
async function auditLinkedLedger(user: SessionUser, link: {
  categoryId: string; categoryName: string; displayType: string; code: string; name: string
}) {
  await safeAudit({
    businessId: user.businessId,
    userId: user.userId,
    action: 'ACCOUNT_CATEGORY_LEDGER_LINKED',
    entity: 'account_category',
    entityId: link.categoryId,
    details: {
      name: link.categoryName,
      accounting_type: link.displayType,
      ledger_code: link.code,
      ledger_name: link.name,
    },
  })
}

/**
 * Every category action carries its ledger account with it: creating a category
 * creates the account behind it, renaming keeps the two in step, (de)activating
 * moves both, and deleting only succeeds when that account is provably unused.
 * The account itself is never offered here — ledger detail belongs to the Chart
 * of Accounts.
 */
async function applyCategoryMutation(
  user: SessionUser,
  actor: ClassificationActor,
  input: CategoryMutation,
): Promise<CategoryResult> {
  if (input.action === 'create') {
    const { category } = await manageAccountCategory({
      ...actor, action: 'create', rootId: input.rootId, name: input.name,
    })
    if (!category) return { action: 'create', category: null }
    // A failure here leaves a category without its account rather than hiding
    // the reason; the next load of this screen retries the link.
    const tree = await listAccountClassification(actor.businessId, actor.actorProfileId)
    const ledger = await ensureCategoryLedgerAccount(actor, tree, category)
    if (ledger.created) {
      await auditLinkedLedger(user, {
        categoryId: category.id,
        categoryName: category.name,
        displayType: category.displayType,
        code: ledger.code,
        name: ledger.name,
      })
    }
    return { action: 'create', category, ledgerCode: ledger.code }
  }
  return applyCategoryLifecycle(user, actor, input)
}
async function applyCategoryLifecycle(
  user: SessionUser,
  actor: ClassificationActor,
  input: CategoryMutation,
): Promise<CategoryResult> {
  const categoryId = input.categoryId
  // hasRequiredFields already answered 400 for a missing id; fail closed anyway.
  if (!categoryId) throw new AccountClassificationRejectedError()
  const tree: AccountClassificationTree = await listAccountClassification(
    actor.businessId, actor.actorProfileId,
  )
  if (input.action === 'rename') {
    if (!input.name) throw new AccountClassificationRejectedError()
    const { category } = await renameCategoryWithLedger(actor, tree, categoryId, input.name)
    return { action: 'rename', category }
  }
  if (input.action === 'deactivate') {
    const { category } = await deactivateCategoryWithLedger(actor, tree, categoryId)
    return { action: 'deactivate', category }
  }
  if (input.action === 'reactivate') {
    const { category } = await reactivateCategoryWithLedger(actor, tree, categoryId)
    return { action: 'reactivate', category }
  }
  const before = tree.categories.find((node) => node.id === categoryId) ?? null
  const { removedAccounts } = await deleteCategoryIfSafe(actor, tree, categoryId)
  for (const account of removedAccounts) {
    await safeAudit({
      businessId: user.businessId,
      userId: user.userId,
      action: 'MANUAL_LEDGER_ACCOUNT_REMOVED',
      entity: 'manual_ledger_account',
      entityId: account.id,
      details: { name: before?.name ?? '', ledger_code: account.code, ledger_name: account.name },
    })
  }
  return { action: 'delete', category: null }
}

async function applyMutation(user: SessionUser, input: Mutation) {
  const actor: ClassificationActor = { businessId: user.businessId, actorProfileId: user.profileId }
  if (input.scope === 'category') return applyCategoryMutation(user, actor, input)
  if (input.scope === 'subcategory') {
    return manageAccountSubcategory({
      ...actor,
      action: input.action,
      subcategoryId: input.subcategoryId,
      categoryId: input.categoryId,
      name: input.name,
    })
  }
  return manageManualLedgerAccount({
    ...actor,
    action: input.action,
    accountId: input.accountId,
    accountCode: input.accountCode,
    name: input.name,
    categoryId: input.categoryId,
  })
}

/**
 * Categories that predate the automatic ledger workflow have no account behind
 * them, so nothing can be posted to them. A manager loading the tree finishes
 * that setup off — idempotent, and it writes nothing once every category is
 * linked. A repair that fails is never allowed to stop the tree from loading.
 */
async function healCategoryLedgers(user: SessionUser, tree: AccountClassificationTree): Promise<void> {
  const actor: ClassificationActor = { businessId: user.businessId, actorProfileId: user.profileId }
  try {
    const { created } = await ensureCategoryLedgerAccounts(actor, tree)
    for (const link of created) await auditLinkedLedger(user, link)
  } catch {
    return
  }
}

export const GET = withObservability('/api/account-classification', async (req: Request) => {
  const requestId = resolveRequestId(req)
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!canViewClassification(user)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (!await classificationAvailable()) return unavailableResponse()
  try {
    const tree = await listAccountClassification(user.businessId, user.profileId)
    const canManage = canManageClassification(user)
    if (canManage) await healCategoryLedgers(user, tree)
    return NextResponse.json({ ...tree, canManage })
  } catch (error) {
    if (error instanceof AccountClassificationUnavailableError) return unavailableResponse()
    if (error instanceof AccountClassificationDeniedError) {
      return NextResponse.json({ error: 'FORBIDDEN', message: error.message }, { status: 403 })
    }
    return safeApiError({
      route: '/api/account-classification',
      requestId,
      errorCode: 'ACCOUNT_CLASSIFICATION_LOAD_FAILED',
      userMessage: 'Account classifications could not be loaded.',
      error,
    })
  }
})

export async function POST(req: Request) {
  const requestId = resolveRequestId(req)
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!canManageClassification(user)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (!await classificationAvailable()) return unavailableResponse()
  const parsed = MutationSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success || !hasRequiredFields(parsed.data)) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  }
  try {
    return NextResponse.json({ ok: true, ...await applyMutation(user, parsed.data) })
  } catch (error) {
    if (error instanceof AccountClassificationUnavailableError) return unavailableResponse()
    if (error instanceof AccountClassificationDeniedError) {
      return NextResponse.json({ error: 'FORBIDDEN', message: error.message }, { status: 403 })
    }
    if (error instanceof AccountClassificationRejectedError) {
      return NextResponse.json({ error: 'CLASSIFICATION_REJECTED', message: error.message }, { status: 400 })
    }
    return safeMutationError({
      route: '/api/account-classification',
      requestId,
      errorCode: 'ACCOUNT_CLASSIFICATION_FAILED',
      userMessage: 'This classification change could not be saved.',
      error,
    })
  }
}
