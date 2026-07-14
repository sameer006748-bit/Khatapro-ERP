/**
 * POST /api/sales/ofc — post an OFC (Out-of-City) Sale.
 * Fully advance-paid. Customer name/phone/city/address required.
 *
 * Server-side enforcement (mirrors the DB-level check in post_sale):
 *   final_total = subtotal (discounts require the unapplied Phase 9 schema)
 *   net_collected = total_received - change_returned
 *   net_collected must equal final_total (full advance, zero outstanding)
 *   Underpayment rejected. Excessive/negative/malformed discount rejected.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postSale, resolveEffectiveSalesmanId } from '@/lib/sales/data-access'
import { parseMoney } from '@/lib/format'
import { assertPhase9SaleFeatures } from '@/lib/supabase/rpc-compatibility'

const ItemSchema = z.object({
  productId: z.string().nullable().optional(),
  productName: z.string().min(1),
  qty: z.number().int().positive(),
  unitPrice: z.string().min(1),
  isTemporary: z.boolean().optional(),
})

const PaymentSchema = z.object({
  accountId: z.string().min(1),
  amount: z.string().min(1),
  isChange: z.boolean().optional(),
})

const OfcSaleSchema = z.object({
  invoiceType: z.literal('OFC'),
  invoiceDate: z.string(),
  items: z.array(ItemSchema).min(1),
  payments: z.array(PaymentSchema).min(1),
  salesmanId: z.string().nullable().optional(),
  customerName: z.string().min(1),
  customerPhone: z.string().min(1),
  customerAddress: z.string().min(1),
  customerCity: z.string().min(1),
  memo: z.string().optional(),
  discountPaisas: z.string().optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
})

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_sales')

  const body = await req.json().catch(() => null)
  const parsed = OfcSaleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  }

  let items: Array<{ productId?: string | null; productName: string; qty: number; unitPrice: bigint; isTemporary?: boolean }>
  let payments: Array<{ accountId: string; amount: bigint; isChange?: boolean }>
  try {
    items = parsed.data.items.map((i) => {
      const up = parseMoney(i.unitPrice)
      if (up === null) throw new Error('Invalid unit price')
      return { ...i, unitPrice: up }
    })
    payments = parsed.data.payments.map((p) => {
      const amt = BigInt(p.amount)
      if (amt <= 0n) throw new Error('Invalid amount')
      return { ...p, amount: amt }
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  // ── Server-side OFC full-advance validation ──
  const subtotal = items.reduce((s, i) => s + i.unitPrice * BigInt(i.qty), 0n)
  let discountPaisas = 0n
  try {
    const raw = parsed.data.discountPaisas
    if (raw !== undefined && raw !== null && raw !== '') {
      discountPaisas = BigInt(raw)
      if (discountPaisas < 0n) throw new Error('Discount cannot be negative.')
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const idempotencyKey = parsed.data.idempotencyKey || null
  if (idempotencyKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return NextResponse.json({ error: 'Invalid idempotencyKey. Must be a valid UUID.' }, { status: 400 })
  }
  assertPhase9SaleFeatures({ discountPaisas, idempotencyKey })
  const finalTotal = subtotal - discountPaisas

  const totalReceived = payments.filter(p => !p.isChange).reduce((s, p) => s + p.amount, 0n)
  const changeReturned = payments.filter(p => p.isChange).reduce((s, p) => s + p.amount, 0n)
  const netCollected = totalReceived - changeReturned

  // OFC requires net_collected == final_total (full advance, zero outstanding)
  if (netCollected !== finalTotal) {
    const outstanding = finalTotal - netCollected
    return NextResponse.json({
      error: `OFC requires full advance payment. Net collected (Rs ${(Number(netCollected) / 100).toFixed(2)}) must equal final total (Rs ${(Number(finalTotal) / 100).toFixed(2)}). Outstanding: Rs ${(Number(outstanding) / 100).toFixed(2)}`,
    }, { status: 400 })
  }

  try {
    const smResult = await resolveEffectiveSalesmanId(su, parsed.data.salesmanId ?? null)
    if (!smResult.ok) {
      return NextResponse.json({ error: smResult.error }, { status: smResult.status })
    }

    const result = await postSale({
      businessId: su.businessId,
      invoiceType: 'OFC',
      invoiceDate: new Date(parsed.data.invoiceDate),
      items,
      payments,
      salesmanId: smResult.salesmanId,
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone,
      customerAddress: parsed.data.customerAddress,
      customerCity: parsed.data.customerCity,
      memo: parsed.data.memo ?? null,
      createdBy: su.userId,
      discount: discountPaisas,
      idempotencyKey,
    })
    return NextResponse.json({ ok: true, invoiceId: result.invoiceId, invoiceNo: result.invoiceNo })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
