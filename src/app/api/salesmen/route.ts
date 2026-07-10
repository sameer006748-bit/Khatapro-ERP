/**
 * GET /api/salesmen — list salesmen for the current business.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser } from '@/lib/auth/permissions'
import { listSalesmen } from '@/lib/sales/data-access'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const rows = await listSalesmen(su.businessId)
  return NextResponse.json({ rows })
}
