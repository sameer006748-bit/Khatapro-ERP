/**
 * Default Chart of Accounts — list (categories with their accounts).
 * Reads from Supabase when env vars are configured, Prisma otherwise.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser } from '@/lib/auth/permissions'
import { getChartOfAccounts } from '@/lib/accounting/data-access'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const cats = await getChartOfAccounts(su.businessId)

  return NextResponse.json({
    categories: cats.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      type: c.type,
      accounts: c.accounts.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        isActive: a.isActive,
        isBusinessAccount: a.isBusinessAccount,
        isPartyAccount: a.isPartyAccount,
        partyType: a.partyType,
        balancePaisas: a.balanceCache.toString(),
      })),
    })),
  })
}
