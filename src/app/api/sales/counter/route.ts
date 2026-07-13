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
import { loadSessionUser, requirePermission, hasPermission } from '@/lib/auth/permissions'
import { postSale, listInvoices, resolveSalesmanIdForUser, resolveEffectiveSalesmanId } from '@/lib/sales/data-access'
import { parseMoney } from '@/lib/format'
import { parseDiscountPaisas } from '@/lib/sales/discount'
import { assertPhase8SaleFeatures } from '@/lib/supabase/rpc-compatibility'

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

const PostSaleSchema = z.object({
  invoiceType: z.literal('COUNTER'),
  invoiceDate: z.string(),
  items: z.array(ItemSchema).min(1),
  payments: z.array(PaymentSchema).min(1),
  salesmanId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  memo: z.string().optional(),
  discount: z.string().optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
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
  // Items: unitPrice is in RUPEES (e.g. "1800") → parseMoney converts to paisas (180000).
  // Payments: amount is already in PAISAS (e.g. "180000") → BigInt directly, no parseMoney.
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

  // Defensive: validate all payment account IDs are UUIDs (not Prisma cuids)
  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  for (const p of payments) {
    if (!isUuid(p.accountId)) {
      return NextResponse.json(
        { error: `Invalid account ID (not a UUID): ${p.accountId}. Payment accounts must be Supabase UUIDs. Refresh the page.` },
        { status: 400 },
      )
    }
  }

  let discountPaisas: bigint
  try {
    discountPaisas = parseDiscountPaisas(parsed.data.discount)
    assertPhase8SaleFeatures({
      discountPaisas,
      idempotencyKey: parsed.data.idempotencyKey,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  try {
    // Resolve the effective salesman_id (salesmen get their own, owners can assign)
    const smResult = await resolveEffectiveSalesmanId(su, parsed.data.salesmanId ?? null)
    if (!smResult.ok) {
      return NextResponse.json({ error: smResult.error }, { status: smResult.status })
    }

    const result = await postSale({
      businessId: su.businessId,
      invoiceType: 'COUNTER',
      invoiceDate: new Date(parsed.data.invoiceDate),
      items,
      payments,
      salesmanId: smResult.salesmanId,
      customerId: parsed.data.customerId ?? null,
      customerName: parsed.data.customerName ?? null,
      customerPhone: parsed.data.customerPhone ?? null,
      memo: parsed.data.memo ?? null,
      createdBy: su.userId,
      discount: discountPaisas,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
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

  // Allow both can_view_sales (full) and can_view_own_sales (salesman)
  const canViewAll = hasPermission(su, 'can_view_sales')
  const canViewOwn = hasPermission(su, 'can_view_own_sales')
  if (!canViewAll && !canViewOwn) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const url = new URL(req.url)
  const type = url.searchParams.get('type') || undefined

  // If user can only view own sales, resolve their salesman_id and filter
  let salesmanId: string | undefined
  if (!canViewAll && canViewOwn) {
    const smId = await resolveSalesmanIdForUser(su.businessId, su.supabaseUserUuid, su.userId)
    if (!smId) {
      return NextResponse.json({ rows: [] })
    }
    salesmanId = smId
  }

  const rows = await listInvoices(su.businessId, { type, salesmanId })
  return NextResponse.json({ rows })
}
