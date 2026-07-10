import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postPurchaseReplacement } from '@/lib/purchases/data-access'

const ItemSchema = z.object({
  originalPurchaseItemId: z.string().min(1),
  outgoingProductId: z.string().nullable().optional(),
  outgoingProductName: z.string().min(1),
  outgoingQuantity: z.number().int().positive(),
  outgoingUnitCostPaisas: z.string().min(1),
  incomingProductId: z.string().nullable().optional(),
  incomingProductName: z.string().min(1),
  incomingQuantity: z.number().int().positive(),
  incomingUnitCostPaisas: z.string().min(1),
})
const Schema = z.object({
  replacementItems: z.array(ItemSchema).min(1),
  replacementDate: z.string().optional(),
  notes: z.string().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_return_purchases')
  const { id: purchaseId } = await params
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  try {
    const result = await postPurchaseReplacement({
      businessId: su.businessId, purchaseId,
      replacementItems: parsed.data.replacementItems.map(it => ({
        originalPurchaseItemId: it.originalPurchaseItemId,
        outgoingProductId: it.outgoingProductId ?? null,
        outgoingProductName: it.outgoingProductName,
        outgoingQuantity: it.outgoingQuantity,
        outgoingUnitCostPaisas: BigInt(it.outgoingUnitCostPaisas),
        incomingProductId: it.incomingProductId ?? null,
        incomingProductName: it.incomingProductName,
        incomingQuantity: it.incomingQuantity,
        incomingUnitCostPaisas: BigInt(it.incomingUnitCostPaisas),
      })),
      replacementDate: parsed.data.replacementDate ? new Date(parsed.data.replacementDate) : new Date(),
      notes: parsed.data.notes ?? null, createdBy: su.userId,
    })
    return NextResponse.json({ ok: true, replacementId: result.replacementId, replacementNo: result.replacementNo })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}
