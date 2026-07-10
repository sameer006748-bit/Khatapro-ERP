import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postPurchaseReturn } from '@/lib/purchases/data-access'

const ItemSchema = z.object({ purchaseItemId: z.string().min(1), productId: z.string().nullable().optional(), productName: z.string().min(1), quantity: z.number().int().positive(), unitCostPaisas: z.string().min(1) })
const Schema = z.object({ returnItems: z.array(ItemSchema).min(1), settlementType: z.enum(['reduce_payable', 'vendor_refund', 'vendor_credit']), settlementAccountId: z.string().nullable().optional(), notes: z.string().optional() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_return_purchases')
  const { id: purchaseId } = await params
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  try {
    const result = await postPurchaseReturn({
      businessId: su.businessId, purchaseId,
      returnItems: parsed.data.returnItems.map(i => ({ purchaseItemId: i.purchaseItemId, productId: i.productId ?? null, productName: i.productName, quantity: i.quantity, unitCostPaisas: BigInt(i.unitCostPaisas) })),
      settlementType: parsed.data.settlementType, settlementAccountId: parsed.data.settlementAccountId ?? null, notes: parsed.data.notes ?? null, createdBy: su.userId,
    })
    return NextResponse.json({ ok: true, returnId: result.returnId, returnNo: result.returnNo })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}
