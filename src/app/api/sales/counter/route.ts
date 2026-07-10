/**
 * POST /api/sales/counter — post a Counter Sale.
 * GET  /api/sales/list — list all invoices (optional ?type=COUNTER|ONLINE|OFC).
 *
 * Counter Sale: customer optional, salesman required, multiple items,
 * temporary items allowed, negative stock allowed, multiple payment methods,
 * partial payment allowed, change/refund through different account allowed.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postSale, listInvoices } from '@/lib/sales/data-access'
import { parseMoney } from '@/lib/format'

const ItemSchema = z.object({
  productId: z.string().nullable().optional(),
  productName: z.string().min(1),
  qty: z.number().int().positive(),
  unitPrice: z.string().min(1),  // paisas as string
  isTemporary: z.boolean().optional(),
})

const PaymentSchema = z.object({
  accountId: z.string().min(1),
  amount: z.string().min(1),  // paisas as string
  isChange: z.boolean().optional(),
})

const PostSaleSchema = z.object({
  invoiceType: z.literal('COUNTER'),
  invoiceDate: z.string(),
  items: z.array(ItemSchema).min(1),
  payments: z.array(PaymentSchema).min(1),
  salesmanId: z.string().min(1),  // required for counter sale
  customerId: z.string().nullable().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  memo: z.string().optional(),
})

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_sales')

  const body = await req.json().catch(() => null)
  const parsed = PostSaleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  }

  // Parse money strings to BigInt.
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
      invoiceType: 'COUNTER',
      invoiceDate: new Date(parsed.data.invoiceDate),
      items,
      payments,
      salesmanId: parsed.data.salesmanId,
      customerId: parsed.data.customerId ?? null,
      customerName: parsed.data.customerName ?? null,
      customerPhone: parsed.data.customerPhone ?? null,
      memo: parsed.data.memo ?? null,
      createdBy: su.userId,
    })
    return NextResponse.json({ ok: true, invoiceId: result.invoiceId, invoiceNo: result.invoiceNo })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  await requirePermission(su, 'can_view_sales')

  const url = new URL(req.url)
  const type = url.searchParams.get('type') || undefined

  const rows = await listInvoices(su.businessId, type ? { type } : undefined)
  return NextResponse.json({ rows })
}
