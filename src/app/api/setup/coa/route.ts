/**
 * Default Chart of Accounts — list (categories with their accounts).
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { db } from '@/lib/db'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser } from '@/lib/auth/permissions'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const cats = await db.accountCategory.findMany({
    where: { businessId: su.businessId },
    include: {
      accounts: {
        orderBy: { code: 'asc' },
      },
    },
    orderBy: [{ code: 'asc' }],
  })

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
