import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, hasPermission } from '@/lib/auth/permissions'
import { postPurchase, listPurchases } from '@/lib/purchases/data-access'
import { withObservability } from '@/lib/observability'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

const ItemSchema = z.object({ productId: z.string().nullable().optional(), productName: z.string().min(1), quantity: z.number().int().positive(), unitCostPaisas: z.string().min(1) })
const PaySchema = z.object({
  accountId: z.string().optional(),
  amountPaisas: z.string().optional(),
  paymentType: z.string().optional(),
}).refine((p) => {
  // If paymentType is 'credit', accountId/amountPaisas can be empty.
  // Otherwise, both must be non-empty.
  if (p.paymentType === 'credit') return true
  return !!(p.accountId && p.amountPaisas && p.accountId.length >= 1 && p.amountPaisas.length >= 1)
}, { message: 'Non-credit payments require accountId and amountPaisas' })
const Schema = z.object({ vendorId: z.string().min(1), purchaseDate: z.string(), supplierBillNo: z.string().optional(), items: z.array(ItemSchema).min(1), payments: z.array(PaySchema).min(1), discountPaisas: z.string().optional(), additionalChargesPaisas: z.string().optional(), notes: z.string().optional() })

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_purchases')
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  // Validate payment account UUIDs
  for (const p of parsed.data.payments) { if (p.paymentType !== 'credit' && (!p.accountId || !isUuid(p.accountId))) return NextResponse.json({ error: `Invalid account ID (not UUID): ${p.accountId ?? ''}` }, { status: 400 }) }
  try {
    const result = await postPurchase({
      businessId: su.businessId, vendorId: parsed.data.vendorId, purchaseDate: new Date(parsed.data.purchaseDate),
      supplierBillNo: parsed.data.supplierBillNo ?? null,
      items: parsed.data.items.map(i => ({ productId: i.productId ?? null, productName: i.productName, quantity: i.quantity, unitCostPaisas: BigInt(i.unitCostPaisas) })),
      payments: parsed.data.payments.map(p => ({ accountId: p.accountId ?? '', amountPaisas: p.paymentType === 'credit' ? 0n : BigInt(p.amountPaisas ?? '0'), paymentType: p.paymentType })),
      discountPaisas: parsed.data.discountPaisas ? BigInt(parsed.data.discountPaisas) : 0n,
      additionalChargesPaisas: parsed.data.additionalChargesPaisas ? BigInt(parsed.data.additionalChargesPaisas) : 0n,
      notes: parsed.data.notes ?? null, createdBy: su.userId,
    })
    return NextResponse.json({ ok: true, purchaseId: result.purchaseId, purchaseNo: result.purchaseNo })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}

export const GET = withObservability('/api/purchases', async () => {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!hasPermission(su, 'can_view_purchases') && !hasPermission(su, 'can_create_purchases')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const rows = await listPurchases(su.businessId)
  return NextResponse.json({ rows })
})
