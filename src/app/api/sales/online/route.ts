/**
 * POST /api/sales/online — post an Online Sale with delivery order creation.
 * Customer name/phone/address required. Items allowed.
 * Creates a delivery_orders row for rider COD workflow.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postSale, resolveEffectiveSalesmanId } from '@/lib/sales/data-access'
import { createDeliveryOrder } from '@/lib/delivery/data-access'
import { parseMoney } from '@/lib/format'

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

const OnlineSaleSchema = z.object({
  invoiceType: z.literal('ONLINE'),
  invoiceDate: z.string(),
  items: z.array(ItemSchema).min(1),
  payments: z.array(PaymentSchema).min(1),
  salesmanId: z.string().nullable().optional(),
  customerName: z.string().min(1),
  customerPhone: z.string().min(1),
  customerAddress: z.string().min(1),
  customerCity: z.string().optional(),
  memo: z.string().optional(),
  discount: z.string().optional(),  // paisas as string, default '0'
  // Phase 7 delivery fields (optional — if absent, no delivery order is created)
  deliveryCharge: z.string().optional(),
  riderEarning: z.string().optional(),
  companyDeliveryIncome: z.string().optional(),
  source: z.string().optional(),
})

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_sales')

  const body = await req.json().catch(() => null)
  const parsed = OnlineSaleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  }

  let items, payments
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

  try {
    const smResult = await resolveEffectiveSalesmanId(su, parsed.data.salesmanId ?? null)
    if (!smResult.ok) {
      return NextResponse.json({ error: smResult.error }, { status: smResult.status })
    }

    const result = await postSale({
      businessId: su.businessId,
      invoiceType: 'ONLINE',
      invoiceDate: new Date(parsed.data.invoiceDate),
      items,
      payments,
      salesmanId: smResult.salesmanId,
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone,
      customerAddress: parsed.data.customerAddress,
      customerCity: parsed.data.customerCity ?? null,
      memo: parsed.data.memo ?? null,
      createdBy: su.userId,
      discount: parsed.data.discount ? BigInt(parsed.data.discount) : 0n,
    })

    // Phase 7: Create delivery order if delivery charge is specified
    let deliveryOrderId: string | null = null
    const deliveryCharge = parsed.data.deliveryCharge ? parseMoney(parsed.data.deliveryCharge) : null
    if (deliveryCharge !== null && deliveryCharge > 0n) {
      const productAmount = items.reduce((s, i) => s + BigInt(i.unitPrice) * BigInt(i.qty), 0n)
      const riderEarning = parsed.data.riderEarning ? (parseMoney(parsed.data.riderEarning) ?? deliveryCharge) : deliveryCharge
      const companyIncome = parsed.data.companyDeliveryIncome
        ? (parseMoney(parsed.data.companyDeliveryIncome) ?? 0n)
        : (deliveryCharge - riderEarning)
      const totalCod = productAmount + deliveryCharge

      try {
        deliveryOrderId = await createDeliveryOrder({
          businessId: su.businessId,
          invoiceId: result.invoiceId,
          productAmount,
          customerDeliveryCharge: deliveryCharge,
          riderEarningAmount: riderEarning,
          companyDeliveryIncome: companyIncome,
          totalCodAmount: totalCod,
          source: parsed.data.source ?? null,
          createdBy: su.userId,
        })
      } catch (delivErr) {
        // Delivery order creation failed — return sale success but note delivery error
        return NextResponse.json({
          ok: true,
          invoiceId: result.invoiceId,
          invoiceNo: result.invoiceNo,
          deliveryOrderId: null,
          deliveryError: (delivErr as Error).message,
        })
      }
    }

    return NextResponse.json({ ok: true, invoiceId: result.invoiceId, invoiceNo: result.invoiceNo, deliveryOrderId })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
