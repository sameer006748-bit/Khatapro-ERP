import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { vendorLedger } from '@/lib/purchases/data-access'

export async function GET(_req: Request, { params }: { params: Promise<{ vendorId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_view_vendor_ledger')
  const { vendorId } = await params
  const rows = await vendorLedger(su.businessId, vendorId)
  return NextResponse.json({ rows })
}
