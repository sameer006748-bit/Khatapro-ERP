/**
 * GET /api/sales/[id] — invoice detail with items + payments.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { getInvoice } from '@/lib/sales/data-access'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  await requirePermission(su, 'can_view_sales')

  const { id } = await params
  const invoice = await getInvoice(su.businessId, id)
  if (!invoice) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ invoice })
}
