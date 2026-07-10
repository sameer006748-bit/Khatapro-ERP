import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postVendorPayment } from '@/lib/purchases/data-access'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const Schema = z.object({ vendorId: z.string().min(1), accountId: z.string().min(1), amountPaisas: z.string().min(1), purchaseId: z.string().nullable().optional(), notes: z.string().optional() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_pay_vendors')
  const { id: purchaseId } = await params
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  if (!isUuid(parsed.data.accountId)) return NextResponse.json({ error: 'Invalid account ID (not UUID)' }, { status: 400 })
  try {
    const ppId = await postVendorPayment({ businessId: su.businessId, vendorId: parsed.data.vendorId, accountId: parsed.data.accountId, amountPaisas: BigInt(parsed.data.amountPaisas), purchaseId: purchaseId ?? parsed.data.purchaseId ?? null, notes: parsed.data.notes ?? null, createdBy: su.userId })
    return NextResponse.json({ ok: true, paymentId: ppId })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}
