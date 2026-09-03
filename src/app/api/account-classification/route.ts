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
} from '@/lib/accounting/legacy-account-classification'
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

async function applyMutation(user: SessionUser, input: Mutation) {
  const actor = { businessId: user.businessId, actorProfileId: user.profileId }
  if (input.scope === 'category') {
    return manageAccountCategory({
      ...actor,
      action: input.action,
      categoryId: input.categoryId,
      rootId: input.rootId,
      name: input.name,
    })
  }
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

export const GET = withObservability('/api/account-classification', async (req: Request) => {
  const requestId = resolveRequestId(req)
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!canViewClassification(user)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (!await classificationAvailable()) return unavailableResponse()
  try {
    const tree = await listAccountClassification(user.businessId, user.profileId)
    return NextResponse.json({ ...tree, canManage: canManageClassification(user) })
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
