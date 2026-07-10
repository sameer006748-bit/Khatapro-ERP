/**
 * POST /api/sales/ofc — post an OFC (Out-of-City) Sale (shell).
 * Fully advance-paid. Customer name/phone/city/address required.
 * Courier/vendor fields are simple placeholders (vendors module is Phase 5).
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postSale } from '@/lib/sales/data-access'
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

const OfcSaleSchema = z.object({
  invoiceType: z.literal('OFC'),
  invoiceDate: z.string(),
  items: z.array(ItemSchema).min(1),
  payments: z.array(PaymentSchema).min(1),  // advance payment
  salesmanId: z.string().nullable().optional(),
  customerName: z.string().min(1),
  customerPhone: z.string().min(1),
  customerAddress: z.string().min(1),
  customerCity: z.string().min(1),
  memo: z.string().optional(),
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

  let items, payments
  try {
    items = parsed.data.items.map((i) => {
      const up = parseMoney(i.unitPrice)
      if (up === null) throw new Error('Invalid unit price')
      return { ...i, unitPrice: up }
    })
    payments = parsed.data.payments.map((p) => {
      const amt = parseMoney(p.amount)
      if (amt === null) throw new Error('Invalid amount')
      return { ...p, amount: amt }
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  try {
    const result = await postSale({
      businessId: su.businessId,
      invoiceType: 'OFC',
      invoiceDate: new Date(parsed.data.invoiceDate),
      items,
      payments,
      salesmanId: parsed.data.salesmanId ?? null,
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone,
      customerAddress: parsed.data.customerAddress,
      customerCity: parsed.data.customerCity,
      memo: parsed.data.memo ?? null,
      createdBy: su.userId,
    })
    return NextResponse.json({ ok: true, invoiceId: result.invoiceId, invoiceNo: result.invoiceNo })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
