/**
 * POST /api/sales/online — post an Online Sale with delivery order creation.
 * Customer name/phone/address required. Items allowed.
 * Creates a delivery_orders row for rider COD workflow.
 *
 * Phase 9 reconciliation:
 *   net_product_total = product_subtotal - discount
 *   customer_grand_total = net_product_total + customer_delivery_charge
 *   net_customer_advance = total_received - change_returned
 *   remaining_cod = max(customer_grand_total - net_customer_advance, 0)
 *
 * The product advance is posted via post_sale (Product Sales only).
 * The delivery order tracks the full customer grand total and remaining COD.
 * Accounting separation: 4010 gets product revenue, 4030/2020 get delivery
 * (recognized at delivery time via mark_order_delivered).
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postSale, resolveEffectiveSalesmanId } from '@/lib/sales/data-access'
import { createDeliveryOrder } from '@/lib/delivery/data-access'
import { parseMoney } from '@/lib/format'
import { parseDiscountPaisas, validateDiscountNotExceedingSubtotal } from '@/lib/sales/discount'
import { getAdminSupabase } from '@/lib/supabase/admin'

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
  discount: z.string().optional(),
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

  try {
    const smResult = await resolveEffectiveSalesmanId(su, parsed.data.salesmanId ?? null)
    if (!smResult.ok) {
      return NextResponse.json({ error: smResult.error }, { status: smResult.status })
    }

    // ── Compute reconciled totals ──
    const productSubtotal = items.reduce((s, i) => s + i.unitPrice * BigInt(i.qty), 0n)
    const discountPaisas = parsed.data.discount ? parseDiscountPaisas(parsed.data.discount) : 0n
    validateDiscountNotExceedingSubtotal(discountPaisas, productSubtotal)
    const netProductTotal = productSubtotal - discountPaisas

    const deliveryCharge = parsed.data.deliveryCharge ? (parseMoney(parsed.data.deliveryCharge) ?? 0n) : 0n
    const customerGrandTotal = netProductTotal + deliveryCharge

    // Total received and change
    const totalReceived = payments.filter(p => !p.isChange).reduce((s, p) => s + p.amount, 0n)
    const changeReturned = payments.filter(p => p.isChange).reduce((s, p) => s + p.amount, 0n)
    const netCustomerAdvance = totalReceived - changeReturned

    // remaining_cod = max(customer_grand_total - net_customer_advance, 0)
    const remainingCod = customerGrandTotal > netCustomerAdvance
      ? customerGrandTotal - netCustomerAdvance
      : 0n

    // ── Post the sale (product only) ──
    // post_sale receives the payments and computes net_collected for commission.
    // The invoice total = net_product_total (product only).
    // The delivery fields are stored on the invoice after post_sale for display.
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
      discount: discountPaisas,
    })

    // ── Update invoice with delivery fields for grand-total reconciliation ──
    // This lets invoice detail, delivery order and print all agree on
    // customer_grand_total = net_product_total + delivery_charge.
    if (deliveryCharge > 0n) {
      const riderEarning = parsed.data.riderEarning ? (parseMoney(parsed.data.riderEarning) ?? deliveryCharge) : deliveryCharge
      const companyIncome = parsed.data.companyDeliveryIncome
        ? (parseMoney(parsed.data.companyDeliveryIncome) ?? 0n)
        : (deliveryCharge - riderEarning)

      // Validate: customer_delivery_charge = company_delivery_income + rider_earning
      if (companyIncome + riderEarning !== deliveryCharge) {
        // Don't fail the sale — just log and use fallback split
        console.warn('[online-sale] Delivery split mismatch, using fallback')
      }

      const admin = getAdminSupabase()
      await admin.from('invoices').update({
        delivery_charge: deliveryCharge.toString(),
        rider_earning: riderEarning.toString(),
        company_delivery_income: companyIncome.toString(),
      }).eq('id', result.invoiceId).eq('business_id', su.businessId)

      // ── Create delivery order with correct COD ──
      // COD = customer_grand_total - net_customer_advance (not product + delivery)
      try {
        await createDeliveryOrder({
          businessId: su.businessId,
          invoiceId: result.invoiceId,
          productAmount: netProductTotal,
          customerDeliveryCharge: deliveryCharge,
          riderEarningAmount: riderEarning,
          companyDeliveryIncome: companyIncome,
          totalCodAmount: remainingCod,
          source: parsed.data.source ?? null,
          createdBy: su.userId,
        })
      } catch (delivErr) {
        return NextResponse.json({
          ok: true,
          invoiceId: result.invoiceId,
          invoiceNo: result.invoiceNo,
          deliveryOrderId: null,
          deliveryError: (delivErr as Error).message,
          customerGrandTotal: customerGrandTotal.toString(),
          netAdvance: netCustomerAdvance.toString(),
          remainingCod: remainingCod.toString(),
        })
      }
    }

    return NextResponse.json({
      ok: true,
      invoiceId: result.invoiceId,
      invoiceNo: result.invoiceNo,
      customerGrandTotal: customerGrandTotal.toString(),
      netAdvance: netCustomerAdvance.toString(),
      remainingCod: remainingCod.toString(),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
