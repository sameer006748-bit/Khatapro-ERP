/**
 * Smart data-access helpers for the Phase 4 Sales module.
 *
 * Dual-path: uses Supabase RPC when Phase 4 is applied, Prisma otherwise.
 *
 * Money is BigInt paisas throughout — passed as string over JSON to preserve
 * precision.
 */
import 'server-only'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { bizDateString } from '@/lib/dates'
import { getAccountByCode } from '@/lib/accounting/data-access'
import {
  assertPhase9SaleFeatures,
} from '@/lib/supabase/rpc-compatibility'
import { probeTable } from '@/lib/supabase/phase-probe'
import { resolveSupabaseUuid } from '@/lib/accounting/voucher-supabase'

const _p4cache = { lastChecked: 0, lastResult: false }

async function isPhase4Live(): Promise<boolean> {
  return probeTable(_p4cache, 'invoices')
}

export type SalesmanRow = { id: string; name: string; phone: string | null; commissionPct: number; isActive: boolean }
export type InvoiceRow = { id: string; invoiceNo: string; invoiceType: string; invoiceDate: string; customerName: string | null; customerPhone?: string | null; customerAddress?: string | null; customerCity?: string | null; salesmanName: string | null; subtotal: string; discount?: string; total: string; paidAmount: string; status?: string; isCancelled: boolean; isReturned: boolean; memo?: string | null; items?: InvoiceItemRow[]; payments?: PaymentAllocationRow[] }
export type InvoiceItemRow = { id: string; productId: string | null; productName: string; qty: number; returnedQty?: number; unitPrice: string; lineTotal: string; isTemporary: boolean }
export type PaymentAllocationRow = { id: string; accountId?: string; accountCode?: string; accountName: string; amount: string; isChange?: boolean; direction?: string | null; paymentMode?: string | null }

export type PostSaleInput = {
  businessId: string; invoiceType: 'COUNTER' | 'ONLINE' | 'OFC'; invoiceDate: Date
  items: Array<{ productId?: string | null; productName: string; qty: number; unitPrice: bigint; isTemporary?: boolean }>
  payments: Array<{ accountId: string; amount: bigint; isChange?: boolean }>
  salesmanId?: string | null; customerId?: string | null
  customerName?: string | null; customerPhone?: string | null; customerAddress?: string | null; customerCity?: string | null
  memo?: string | null; createdBy?: string | null; discount?: bigint; idempotencyKey?: string | null
}

export async function listSalesmen(businessId: string): Promise<SalesmanRow[]> {
  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin.from('salesmen').select('id, name, phone, commission_pct, is_active').eq('business_id', businessId).order('name')
    if (error) throw new Error(`Supabase: ${error.message}`)
    return (data ?? []).map((s: any) => ({ id: s.id, name: s.name, phone: s.phone, commissionPct: Number(s.commission_pct), isActive: s.is_active }))
  }
  const salesmen = await db.salesman.findMany({ where: { businessId }, orderBy: { name: 'asc' } })
  return salesmen.map((s) => ({ id: s.id, name: s.name, phone: s.phone, commissionPct: s.commissionPct, isActive: s.isActive }))
}

export async function resolveSalesmanIdForUser(businessId: string, supabaseUserUuid: string | null, prismaUserId: string): Promise<string | null> {
  if (await isPhase4Live()) {
    // Phase 4 is live → the salesmen table lives in Supabase. Resolve there and
    // stop: falling through to Prisma/SQLite would crash on serverless (no DB
    // file). A missing row simply means "no linked salesman" → return null.
    if (supabaseUserUuid) {
      const admin = getAdminSupabase()
      const { data, error } = await admin.from('salesmen').select('id').eq('business_id', businessId).eq('user_id', supabaseUserUuid).maybeSingle()
      if (!error && data) return data.id
    }
    return null
  }
  const sm = await db.salesman.findFirst({ where: { businessId, userId: prismaUserId }, select: { id: true } })
  return sm?.id ?? null
}

export type SessionUserInfo = { userId: string; supabaseUserUuid: string | null; businessId: string; permissions: Set<string> }

export async function resolveEffectiveSalesmanId(su: SessionUserInfo, clientSalesmanId: string | null | undefined): Promise<{ ok: true; salesmanId: string } | { ok: false; error: string; status: number }> {
  const canViewAll = su.permissions.has('can_view_sales')
  const canViewOwn = su.permissions.has('can_view_own_sales')
  if (canViewAll) {
    if (!clientSalesmanId) return { ok: false, error: 'Salesman is required', status: 400 }
    return { ok: true, salesmanId: clientSalesmanId }
  }
  if (canViewOwn) {
    const smId = await resolveSalesmanIdForUser(su.businessId, su.supabaseUserUuid, su.userId)
    if (!smId) return { ok: false, error: 'Your user account is not linked to a salesman record.', status: 403 }
    return { ok: true, salesmanId: smId }
  }
  return { ok: false, error: 'FORBIDDEN', status: 403 }
}

export async function verifyInvoiceOwnership(businessId: string, invoiceId: string, salesmanId: string): Promise<boolean> {
  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin.from('invoices').select('salesman_id').eq('id', invoiceId).eq('business_id', businessId).maybeSingle()
    if (error || !data) return false
    return data.salesman_id === salesmanId
  }
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, businessId }, select: { salesmanId: true } })
  if (!inv) return false
  return inv.salesmanId === salesmanId
}

export async function postSale(input: PostSaleInput): Promise<{ invoiceId: string; invoiceNo: string }> {
  assertPhase9SaleFeatures({ discountPaisas: input.discount, idempotencyKey: input.idempotencyKey })
  if (await isPhase4Live()) return postSaleViaSupabase(input)
  return postSaleViaPrisma(input)
}

async function postSaleViaSupabase(input: PostSaleInput): Promise<{ invoiceId: string; invoiceNo: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
  const itemsJson = input.items.map((i) => ({ product_id: i.productId ?? null, product_name: i.productName, qty: i.qty, unit_price: i.unitPrice.toString(), is_temporary: i.isTemporary ?? false }))
  const paymentsJson = input.payments.map((p) => ({ account_id: p.accountId, amount: p.amount.toString(), is_change: p.isChange ?? false }))
  const payload = { p_business_id: input.businessId, p_invoice_type: input.invoiceType, p_invoice_date: bizDateString(input.invoiceDate), p_items: itemsJson, p_payments: paymentsJson, p_salesman_id: input.salesmanId ?? null, p_customer_id: input.customerId ?? null, p_customer_name: input.customerName ?? null, p_customer_phone: input.customerPhone ?? null, p_customer_address: input.customerAddress ?? null, p_customer_city: input.customerCity ?? null, p_memo: input.memo ?? null, p_created_by: supabaseCreatedBy, p_idempotency_key: input.idempotencyKey ?? randomUUID() }
  const { data, error } = await admin.rpc('post_sale_phase2', payload)
  if (error) throw new Error(`Supabase post_sale_phase2: ${error.message}`)
  const invoiceId = data as string
  const { data: inv, error: invErr } = await admin.from('invoices').select('invoice_no').eq('id', invoiceId).single()
  if (invErr) throw new Error(`Supabase fetch invoice_no: ${invErr.message}`)
  return { invoiceId, invoiceNo: (inv as { invoice_no: string }).invoice_no }
}

async function postSaleViaPrisma(input: PostSaleInput): Promise<{ invoiceId: string; invoiceNo: string }> {
  let subtotal = 0n
  for (const item of input.items) { subtotal += item.unitPrice * BigInt(item.qty) }
  const discount = input.discount ?? 0n
  if (discount < 0n) throw new Error('Discount cannot be negative')
  if (discount > subtotal) throw new Error('Discount cannot exceed subtotal')
  const total = subtotal - discount
  let paidAmount = 0n
  for (const p of input.payments) { if (!p.isChange) paidAmount += p.amount }
  let changeTotal = 0n
  for (const p of input.payments) { if (p.isChange) changeTotal += p.amount }

  const salesAccount = await getAccountByCode(input.businessId, '4010')
  if (!salesAccount) throw new Error('Sales account (4010) not found')
  const arAccount = await getAccountByCode(input.businessId, '1200')

  const voucherLines: Array<{ accountId: string; debit: bigint; credit: bigint; memo?: string }> = [
    { accountId: salesAccount.id, debit: 0n, credit: total, memo: `Sale INV-XXXX` },
  ]
  for (const p of input.payments) { if (!p.isChange) voucherLines.push({ accountId: p.accountId, debit: p.amount, credit: 0n, memo: 'Payment' }) }
  for (const p of input.payments) { if (p.isChange) voucherLines.push({ accountId: p.accountId, debit: 0n, credit: p.amount, memo: 'Change' }) }
  const outstanding = total - paidAmount + changeTotal
  if (outstanding > 0n && arAccount) voucherLines.push({ accountId: arAccount.id, debit: outstanding, credit: 0n, memo: 'Outstanding' })

  const result = await db.$transaction(async (tx) => {
    const last = await tx.invoice.findFirst({ where: { businessId: input.businessId }, orderBy: { invoiceNo: 'desc' } })
    let nextNum = 1
    if (last) { const m = last.invoiceNo.match(/^INV-(\d+)$/); if (m) nextNum = parseInt(m[1], 10) + 1 }
    const invoiceNo = `INV-${String(nextNum).padStart(4, '0')}`

    const vch = await tx.voucher.create({
      data: { businessId: input.businessId, voucherType: 'SI', voucherDate: input.invoiceDate, memo: input.memo ?? `Sale ${invoiceNo}`, postedBy: input.createdBy ?? null, totalDebit: total, totalCredit: total },
    })
    await tx.voucherLine.createMany({ data: voucherLines.map((l, i) => ({ businessId: input.businessId, voucherId: vch.id, accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo ?? null, lineOrder: i })) })
    const deltas = new Map<string, bigint>()
    for (const l of voucherLines) { const d = l.debit - l.credit; deltas.set(l.accountId, (deltas.get(l.accountId) ?? 0n) + d) }
    for (const [accountId, delta] of deltas) {
      const acc = await tx.account.findUnique({ where: { id: accountId }, select: { balanceCache: true } })
      if (acc) await tx.account.update({ where: { id: accountId }, data: { balanceCache: acc.balanceCache + delta } })
    }

    const invoice = await tx.invoice.create({
      data: { businessId: input.businessId, invoiceNo, invoiceType: input.invoiceType, invoiceDate: input.invoiceDate, customerId: input.customerId ?? null, salesmanId: input.salesmanId ?? null, customerName: input.customerName ?? null, customerPhone: input.customerPhone ?? null, customerAddress: input.customerAddress ?? null, customerCity: input.customerCity ?? null, subtotal, discount, total, paidAmount, voucherId: vch.id, memo: input.memo ?? null, createdBy: input.createdBy ?? null },
    })

    for (const item of input.items) {
      let smId: string | undefined
      if (item.productId) {
        const product = await tx.product.findFirst({ where: { id: item.productId, businessId: input.businessId }, select: { currentStock: true } })
        if (!product) throw new Error(`Product not found: ${item.productName}`)
        const newStock = product.currentStock - item.qty
        const sm = await tx.stockMovement.create({ data: { businessId: input.businessId, productId: item.productId, movementType: 'adjustment_out', quantity: item.qty, balanceAfter: newStock, reason: `Sale ${invoiceNo}`, createdBy: input.createdBy ?? null } })
        smId = sm.id
        await tx.product.update({ where: { id: item.productId }, data: { currentStock: { decrement: item.qty } } })
      }
      await tx.invoiceItem.create({ data: { businessId: input.businessId, invoiceId: invoice.id, productId: item.productId ?? null, productName: item.productName, qty: item.qty, unitPrice: item.unitPrice, lineTotal: item.unitPrice * BigInt(item.qty), isTemporary: item.isTemporary ?? false, stockMovementId: smId ?? null } })
    }

    let salesman: { id: string; commissionPct: number } | null = null
    if (input.salesmanId) salesman = await tx.salesman.findUnique({ where: { id: input.salesmanId }, select: { id: true, commissionPct: true } })
    for (const p of input.payments) {
      if (!p.isChange) {
        const alloc = await tx.paymentAllocation.create({ data: { businessId: input.businessId, invoiceId: invoice.id, accountId: p.accountId, amount: p.amount, isChange: false, voucherId: vch.id, createdBy: input.createdBy ?? null } })
        if (salesman && p.amount > 0n) {
          const commAmount = (p.amount * BigInt(Math.round(salesman.commissionPct * 100))) / 10000n
          await tx.salesmanCommission.upsert({ where: { allocationId_salesmanId: { allocationId: alloc.id, salesmanId: salesman.id } }, create: { businessId: input.businessId, salesmanId: salesman.id, invoiceId: invoice.id, allocationId: alloc.id, collectedAmount: p.amount, commissionPct: salesman.commissionPct, commissionAmount: commAmount }, update: {} })
        }
      }
    }

    return { invoiceId: invoice.id, invoiceNo }
  })

  return result
}

export async function listInvoices(businessId: string, opts?: { type?: string; salesmanId?: string }): Promise<InvoiceRow[]> {
  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    let query = admin.from('invoices').select('id, invoice_no, invoice_type, invoice_date, customer_name, subtotal, total, paid, status, salesmen(name)').eq('business_id', businessId).order('invoice_date', { ascending: false }).order('created_at', { ascending: false }).limit(100)
    if (opts?.type) query = query.eq('invoice_type', opts.type)
    if (opts?.salesmanId) query = query.eq('salesman_id', opts.salesmanId)
    const { data, error } = await query
    if (error) throw new Error(`Supabase: ${error.message}`)
    return (data ?? []).map((r: any) => ({ id: r.id, invoiceNo: r.invoice_no, invoiceType: r.invoice_type, invoiceDate: r.invoice_date, customerName: r.customer_name, salesmanName: r.salesmen?.name ?? null, subtotal: String(r.subtotal), total: String(r.total), paidAmount: String(r.paid), status: r.status, isCancelled: r.status === 'Cancelled', isReturned: r.status === 'Returned' }))
  }
  const invoices = await db.invoice.findMany({ where: { businessId, ...(opts?.type ? { invoiceType: opts.type } : {}), ...(opts?.salesmanId ? { salesmanId: opts.salesmanId } : {}) }, include: { salesman: true }, orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }], take: 100 })
  return invoices.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, invoiceType: i.invoiceType, invoiceDate: i.invoiceDate.toISOString(), customerName: i.customerName, salesmanName: i.salesman?.name ?? null, subtotal: i.subtotal.toString(), total: i.total.toString(), paidAmount: i.paidAmount.toString(), isCancelled: i.isCancelled, isReturned: i.isReturned }))
}

export async function getInvoice(businessId: string, invoiceId: string): Promise<InvoiceRow | null> {
  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const { data: inv, error } = await admin.from('invoices').select('id, invoice_no, invoice_type, invoice_date, customer_name, customer_phone, customer_address, customer_city, subtotal, discount, total, paid, status, memo, salesmen(name), invoice_items(id, product_id, product_name, qty, returned_qty, unit_price, line_total, is_temporary)').eq('id', invoiceId).eq('business_id', businessId).single()
    if (error || !inv) return null
    const r = inv as any
    const { data: payments, error: paymentError } = await admin.from('payments').select('id, amount, direction, payment_mode').eq('business_id', businessId).eq('invoice_id', invoiceId).order('created_at')
    if (paymentError) throw new Error(`Supabase invoice payments: ${paymentError.message}`)
    return { id: r.id, invoiceNo: r.invoice_no, invoiceType: r.invoice_type, invoiceDate: r.invoice_date, customerName: r.customer_name, customerPhone: r.customer_phone, customerAddress: r.customer_address, customerCity: r.customer_city, salesmanName: r.salesmen?.name ?? null, subtotal: String(r.subtotal), discount: String(r.discount ?? 0), total: String(r.total), paidAmount: String(r.paid), status: r.status, isCancelled: r.status === 'Cancelled', isReturned: r.status === 'Returned', memo: r.memo, items: (r.invoice_items ?? []).map((it: any) => ({ id: it.id, productId: it.product_id, productName: it.product_name, qty: it.qty, returnedQty: it.returned_qty, unitPrice: String(it.unit_price), lineTotal: String(it.line_total), isTemporary: it.is_temporary })), payments: (payments ?? []).map((p: any) => ({ id: p.id, accountName: p.payment_mode ?? 'Payment', amount: String(p.amount), direction: p.direction, paymentMode: p.payment_mode })) }
  }
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, businessId }, include: { salesman: true, items: true, paymentAllocations: { include: { account: true } } } })
  if (!inv) return null
  return { id: inv.id, invoiceNo: inv.invoiceNo, invoiceType: inv.invoiceType, invoiceDate: inv.invoiceDate.toISOString(), customerName: inv.customerName, salesmanName: inv.salesman?.name ?? null, subtotal: inv.subtotal.toString(), total: inv.total.toString(), paidAmount: inv.paidAmount.toString(), isCancelled: inv.isCancelled, isReturned: inv.isReturned, items: inv.items.map((it) => ({ id: it.id, productId: it.productId, productName: it.productName, qty: it.qty, unitPrice: it.unitPrice.toString(), lineTotal: it.lineTotal.toString(), isTemporary: it.isTemporary })), payments: inv.paymentAllocations.map((pa) => ({ id: pa.id, accountId: pa.accountId, accountCode: pa.account.code, accountName: pa.account.name, amount: pa.amount.toString(), isChange: pa.isChange })) }
}

export type LinkedReturnInput = {
  businessId: string
  invoiceId: string
  items: Array<{ invoiceItemId: string; qty: number }>
  refundMode: 'CREDIT' | 'CASH' | 'BANK'
  reason?: string | null
  idempotencyKey: string
}

export async function postLinkedSaleReturn(input: LinkedReturnInput): Promise<{ returnId: string; returnNo: string; total: string; status: string; idempotent: boolean }> {
  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin.rpc('post_sale_return', {
      p_business_id: input.businessId,
      p_original_invoice_id: input.invoiceId,
      p_items: input.items.map((item) => ({ invoice_item_id: item.invoiceItemId, qty: item.qty })),
      p_refund_mode: input.refundMode,
      p_reason: input.reason ?? null,
      p_idempotency_key: input.idempotencyKey,
    })
    if (error) throw new Error(`Supabase post_sale_return: ${error.message}`)
    const result = data as any
    return { returnId: result.return_id, returnNo: result.return_no, total: String(result.total), status: result.status, idempotent: Boolean(result.idempotent) }
  }
  throw new Error('Linked sales returns require the Phase 2 database migration.')
}

export async function receiveInvoicePayment(input: { businessId: string; invoiceId: string; amount: bigint; mode: string; idempotencyKey: string }): Promise<{ paymentId: string; amount: string; idempotent: boolean }> {
  if (!(await isPhase4Live())) throw new Error('Invoice collections require the Phase 2 database migration.')
  if (input.amount <= 0n) throw new Error('Collection amount must be positive')
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('receive_invoice_payment', {
    p_business_id: input.businessId, p_invoice_id: input.invoiceId,
    p_amount: input.amount.toString(), p_mode: input.mode,
    p_idempotency_key: input.idempotencyKey,
  })
  if (error) throw new Error(`Supabase receive_invoice_payment: ${error.message}`)
  const result = data as any
  return { paymentId: result.payment_id, amount: String(result.amount), idempotent: Boolean(result.idempotent) }
}
