/**
 * Default Chart of Accounts — list (categories with their accounts).
 * Reads from Supabase when env vars are configured, Prisma otherwise.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser } from '@/lib/auth/permissions'
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
        balancePaisas: a.balanceCache.toString(),
      })),
    })),
  })
}
