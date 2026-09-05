/**
 * Default Chart of Accounts — list (categories with their accounts).
 * Reads from Supabase when env vars are configured, Prisma otherwise.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { hasPermission, loadSessionUser } from '@/lib/auth/permissions'
import { getChartOfAccounts } from '@/lib/accounting/data-access'
import { getAccountingAvailability, unavailableAccountingPayload } from '@/lib/accounting/availability'
import { isSupabaseConfigured } from '@/lib/supabase/config'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const capability = await getAccountingAvailability(su.businessId)
  if (capability.path === 'operational-fallback' && !isSupabaseConfigured()) {
    return NextResponse.json(unavailableAccountingPayload(
      { categories: [] },
      capability.reason,
    ))
  }
  const cats = await getChartOfAccounts(su.businessId)

  // Every operational screen uses this route as an account picker - payment
  // accounts, expense heads, vendor and party ledgers - so the structure stays
  // available to any signed-in user of the business. Balances are a separate
  // question: they amount to the whole ledger in one response, so they travel
  // only to the roles the Accounts, Chart of Accounts and Trial Balance screens
  // are already gated on ('can_view_account_balances' is seeded as sensitive).
  // A Salesman or Rider gets the account list their screens need, and no
  // business-wide figures.
  const canSeeBalances = hasPermission(su, 'can_view_account_balances')
    || hasPermission(su, 'can_view_setup')
    || hasPermission(su, 'can_view_trial_balance')

  // Additive fields only. `depth`/`rootId`/`parentId` let a screen tell a fixed
  // accounting root apart from a user-created category or subcategory, and
  // `isSystem` marks accounts the posting engine maintains itself. Existing
  // consumers that read code/name/type/accounts are unaffected.
  return NextResponse.json({
    availability: { accounting: true },
    categories: cats.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      type: c.type,
      depth: c.depth ?? 0,
      parentId: c.parentId ?? null,
      rootId: c.rootId ?? c.id,
      accounts: c.accounts.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        isActive: a.isActive,
        isBusinessAccount: a.isBusinessAccount,
        isPartyAccount: a.isPartyAccount,
        isSystem: a.isSystem === true,
        partyType: a.partyType,
        ...(canSeeBalances ? { balancePaisas: a.balanceCache.toString() } : {}),
      })),
    })),
  })
}
