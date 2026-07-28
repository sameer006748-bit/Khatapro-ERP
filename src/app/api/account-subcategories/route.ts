import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { hasPermission, loadSessionUser } from '@/lib/auth/permissions'
import {
  listPersistedAccountSubcategories,
  managePersistedAccountSubcategory,
} from '@/lib/money/persisted-account-subcategories'
import { getAccountingAvailability, unavailableAccountingPayload } from '@/lib/accounting/availability'
import { resolveRequestId, safeApiError, safeMutationError } from '@/lib/observability'

const ActionSchema = z.object({
  action: z.enum(['create', 'rename', 'archive', 'assign', 'move', 'uncategorize']),
  parentCode: z.enum([
    'sales', 'expenses', 'accounts-receivable', 'accounts-payable',
    'capital', 'current-assets', 'purchases', 'salesman',
  ]).optional(),
  subcategoryId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  accountId: z.string().uuid().optional(),
})

async function sessionUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  return loadSessionUser((session.user as any).id)
}

export async function GET(req: Request) {
  const requestId = resolveRequestId(req)
  const loaded = await sessionUser()
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!hasPermission(loaded, 'can_view_account_balances') && !hasPermission(loaded, 'can_view_reports')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  try {
    const capability = await getAccountingAvailability(loaded.businessId)
    if (capability.path === 'operational-fallback') {
      return NextResponse.json(unavailableAccountingPayload(
        { categories: [], assignments: [] },
        capability.reason,
      ))
    }
    return NextResponse.json(await listPersistedAccountSubcategories(loaded.businessId, loaded.userId))
  } catch (error) {
    return safeApiError({ route: '/api/account-subcategories', requestId, errorCode: 'CATEGORY_LOAD_FAILED', userMessage: 'Account categories could not be loaded.', error })
  }
}

export async function POST(req: Request) {
  const requestId = resolveRequestId(req)
  const loaded = await sessionUser()
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const canManage = loaded.roleName === 'Owner' || loaded.roleName === 'Admin'
    || hasPermission(loaded, 'can_manage_account_categories')
    || hasPermission(loaded, 'can_manage_chart_of_accounts')
  if (!canManage) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const parsed = ActionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  try {
    return NextResponse.json(await managePersistedAccountSubcategory({
      businessId: loaded.businessId,
      actorId: loaded.userId,
      ...parsed.data,
    }))
  } catch (error) {
    return safeMutationError({ route: '/api/account-subcategories', requestId, errorCode: 'CATEGORY_MUTATION_FAILED', userMessage: 'Account category change could not be saved.', error })
  }
}
