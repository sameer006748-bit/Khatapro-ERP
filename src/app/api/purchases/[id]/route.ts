import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { getPurchase } from '@/lib/purchases/data-access'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!hasPermission(su, 'can_view_purchases') && !hasPermission(su, 'can_create_purchases')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const { id } = await params
  const purchase = await getPurchase(su.businessId, id)
  if (!purchase) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ purchase })
}
