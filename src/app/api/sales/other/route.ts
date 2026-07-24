/**
 * POST /api/sales/other — post an Other Sale.
 *
 * Other Sale is a customer-account/credit sale where the customer takes goods
 * now and pays later (or partially now). Customer selection is mandatory.
 * Paid amount may be zero, partial, or full.
 * Zero payment requires no payment account.
 * Positive payment requires an operational money account.
 * No rider, no COD, no courier, no delivery fee, no Online/OFC-specific fields.
 *
 * Server-side enforcement:
 * - invoiceType forced to 'OTHER'
 * - customer required
 * - salesman from session/permissions (server-controlled)
 * - totals recalculated server-side
 * - shared invoice sequence
 * - shared stock/accounting engine
 * - product-wise per-piece commission eligibility
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postSale, resolveEffectiveSalesmanId } from '@/lib/sales/data-access'
import { parseMoney } from '@/lib/format'
import { assertPhase9SaleFeatures } from '@/lib/supabase/rpc-compatibility'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

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

const OtherSaleSchema = z.object({
  invoiceDate: z.string(),
  items: z.array(ItemSchema).min(1),
  payments: z.array(PaymentSchema).optional().default([]),
  salesmanId: z.string().nullable().optional(),
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  customerPhone: z.string().optional(),
  customerAddress: z.string().optional(),
  customerCity: z.string().optional(),
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
  const parsed = OtherSaleSchema.safeParse(body)
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
    payments = (parsed.data.payments ?? []).map((p) => {
      const amt = BigInt(p.amount)
      if (amt <= 0n) throw new Error('Invalid payment amount')
      return { ...p, amount: amt }
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  // Validate customer required
  if (!parsed.data.customerId) {
    return NextResponse.json({ error: 'Customer is required for Other Sale' }, { status: 400 })
  }

  // Validate payment: positive payment requires an account, zero payment is fine without
  const totalPaid = payments.filter(p => !p.isChange).reduce((s, p) => s + p.amount, 0n)
  if (totalPaid > 0n && payments.length === 0) {
    return NextResponse.json({ error: 'Positive payment requires a money account' }, { status: 400 })
  }

  let discountPaisas = 0n
  try {
    const rawDiscount = parsed.data.discountPaisas
    if (rawDiscount !== undefined && rawDiscount !== null && rawDiscount !== '') {
      discountPaisas = BigInt(rawDiscount)
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

  const requestId = resolveRequestId(req)

  try {
    const smResult = await resolveEffectiveSalesmanId(su, parsed.data.salesmanId ?? null)
    if (!smResult.ok) {
      return NextResponse.json({ error: smResult.error }, { status: smResult.status })
    }

    const result = await postSale({
      businessId: su.businessId,
      invoiceType: 'OTHER',
      invoiceDate: new Date(parsed.data.invoiceDate),
      items,
      payments,
      salesmanId: smResult.salesmanId,
      customerId: parsed.data.customerId,
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone ?? null,
      customerAddress: parsed.data.customerAddress ?? null,
      customerCity: parsed.data.customerCity ?? null,
      memo: parsed.data.memo ?? null,
      createdBy: su.userId,
      discount: discountPaisas,
      idempotencyKey,
    })
    return NextResponse.json({ ok: true, invoiceId: result.invoiceId, invoiceNo: result.invoiceNo })
  } catch (e) {
    return safeMutationError({
      route: '/api/sales/other',
      requestId,
      errorCode: 'OTHER_SALE_POST_FAILED',
      userMessage: 'Other Sale could not be posted.',
      error: e,
    })
  }
}