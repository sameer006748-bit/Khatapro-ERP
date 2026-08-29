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
import { allocateDocumentNumber } from '@/lib/identity/generate'
import {
  assertPhase9SaleFeatures,
  assertMixedSaleReturnSupport,
  salePostingRpcName,
} from '@/lib/supabase/rpc-compatibility'
import { probeTable } from '@/lib/supabase/phase-probe'
import { resolveSupabaseUuid } from '@/lib/accounting/voucher-supabase'
import {
  normalizeSaleLines,
  computeSaleTotals,
  validateSaleTotals,
  computeStockEffects,
  resolveSellerAttribution,
  computeEarnedCommission,
  computeHistoricalReturnCommissionAdjustment,
  SaleLineError,
  type NormalizedSaleLine,
  type SellerRole,
} from '@/lib/sales/sale-engine'
import { missingProductOptionalColumn } from '@/lib/products/schema-compatibility'
import {
  callLegacyIdentityRpc,
  callRequiredLegacyIdentityRpc,
  usesLegacyTransactionSchema,
} from '@/lib/identity/legacy-bridge'

const _p4cache = { lastChecked: 0, lastResult: false }

async function isPhase4Live(): Promise<boolean> {
  return probeTable(_p4cache, 'invoices')
}

export type SalesmanRow = { id: string; name: string; phone: string | null; commissionPct: number; isActive: boolean }
export type CustomerRow = {
  id: string
  name: string
  phone: string | null
  address: string | null
  city: string | null
  isActive: boolean
}
export type InvoiceReturnRow = { returnNo: string; returnDate: string; total: string; settlementStatus: string }
export type InvoiceRow = { id: string; invoiceNo: string; invoiceType: string; invoiceDate: string; customerName: string | null; customerPhone?: string | null; customerAddress?: string | null; customerCity?: string | null; salesmanName: string | null; subtotal: string; discount?: string; total: string; paidAmount: string; status?: string; isCancelled: boolean; isReturned: boolean; memo?: string | null; items?: InvoiceItemRow[]; payments?: PaymentAllocationRow[]; returns?: InvoiceReturnRow[] }
export type InvoiceItemRow = { id: string; productId: string | null; productName: string; qty: number; returnedQty?: number; unitPrice: string; lineTotal: string; isTemporary: boolean }
export type InvoiceCommissionRow = {
  invoiceItemId: string
  productId: string | null
  productName: string
  soldQty: number
  returnedQty: number
  netEligibleQty: number
  ratePaisas: string
  commissionPaisas: string
  status: string
  eventType: string
  sellerName: string | null
  sellerRole: SellerRole
  paymentReference: string | null
  createdAt: string | null
}
export type PaymentAllocationRow = { id: string; accountId?: string; accountCode?: string; accountName: string; amount: string; isChange?: boolean; direction?: string | null; paymentMode?: string | null }

/**
 * The deployed Phase-2 trigger writes its own event vocabulary
 * (`eligibility` / `return_adjustment`, migration 00016) while the local engine
 * writes `calculated` / `reversal`. Readers must not have to know which
 * database they are on, so both are folded to the engine's names here. Anything
 * unrecognised is passed through untouched rather than guessed at.
 */
function canonicalCommissionEventType(raw: string | null | undefined): string {
  switch (raw) {
    case 'eligibility': return 'calculated'
    case 'return_adjustment': return 'reversal'
    default: return raw ?? 'calculated'
  }
}

export type PostSaleItemInput = {
  productId?: string | null
  productName: string
  /** Pieces sold. Zero only for a referenced historical-return row. */
  qty: number
  /** Pieces handed back on this same bill, or against the referenced invoice item. */
  returnedQty?: number
  unitPrice: bigint
  isTemporary?: boolean
  /** Audit link when this row settles a return against an earlier invoice item. */
  originalInvoiceItemId?: string | null
}

export type PostSaleInput = {
  businessId: string; invoiceType: string; invoiceDate: Date
  items: PostSaleItemInput[]
  payments: Array<{ accountId: string; amount: bigint; isChange?: boolean }>
  salesmanId?: string | null; customerId?: string | null
  /** Who earns the commission. OWNER means the Owner sold it personally. */
  sellerRole?: SellerRole
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

/**
 * Server-authoritative seller attribution for every sale channel.
 *
 * An Owner/Admin must say explicitly whether the sale is their own or a named
 * salesman's; there is no implicit fallback, so an Owner sale can never create
 * a payable for an unrelated salesman. A salesman-scoped user always sells as
 * themselves regardless of what the client sends.
 */
export async function resolveSaleSeller(
  su: SessionUserInfo,
  input: { sellerRole?: SellerRole | null; salesmanId?: string | null },
): Promise<{ ok: true; salesmanId: string | null; sellerRole: SellerRole } | { ok: false; error: string; status: number }> {
  const canAttributeAnySeller = su.permissions.has('can_view_sales')
  const actorSalesmanId = canAttributeAnySeller
    ? null
    : await resolveSalesmanIdForUser(su.businessId, su.supabaseUserUuid, su.userId)

  const resolved = resolveSellerAttribution({
    sellerMode: input.sellerRole ?? null,
    requestedSalesmanId: input.salesmanId ?? null,
    actorCanAttributeAnySeller: canAttributeAnySeller,
    actorSalesmanId,
  })
  if (!resolved.ok) return resolved
  return { ok: true, salesmanId: resolved.attribution.salesmanId, sellerRole: resolved.attribution.role }
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

/**
 * Resolve the per-piece commission rate (paisas) for each product on the bill.
 *
 * When the migration-dependent `commission_rate` column is absent in
 * production the rate is reported as unavailable (null) rather than silently
 * rewritten to zero, so the caller can surface a precise setup message instead
 * of a fabricated figure.
 */
export async function resolveProductCommissionRates(
  businessId: string,
  productIds: readonly string[],
): Promise<{ rates: Map<string, bigint>; available: boolean }> {
  const unique = [...new Set(productIds)]
  const rates = new Map<string, bigint>()
  if (unique.length === 0) return { rates, available: true }

  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('products')
      .select('id, commission_rate')
      .eq('business_id', businessId)
      .in('id', unique)
    if (error) {
      if (missingProductOptionalColumn(error) === 'commissionRate') return { rates, available: false }
      throw new Error(`Supabase product commission rates: ${error.message}`)
    }
    for (const row of (data ?? []) as Array<{ id: string; commission_rate: unknown }>) {
      rates.set(row.id, BigInt(Math.round(Number(row.commission_rate ?? 0))))
    }
    return { rates, available: true }
  }

  const products = await db.product.findMany({
    where: { businessId, id: { in: unique } },
    select: { id: true, commissionRate: true },
  })
  for (const product of products) rates.set(product.id, product.commissionRate ?? 0n)
  return { rates, available: true }
}

/**
 * Normalize a bill through the shared engine: same-bill/referenced returns,
 * net quantities, totals, stock effects and commission all come from one place
 * so Counter, Online, OFC and Other cannot drift apart.
 */
async function prepareSaleLines(input: PostSaleInput): Promise<{
  lines: NormalizedSaleLine[]
  commissionRatesAvailable: boolean
}> {
  const productIds = input.items.map((i) => i.productId).filter((id): id is string => Boolean(id))
  const { rates, available } = await resolveProductCommissionRates(input.businessId, productIds)

  // Referenced historical returns need the remaining returnable quantity of the
  // original invoice item, which the engine enforces against.
  const referencedIds = input.items
    .map((i) => i.originalInvoiceItemId)
    .filter((id): id is string => Boolean(id))
  const remainingByItem = referencedIds.length > 0
    ? await loadRemainingReturnableQty(input.businessId, referencedIds)
    : new Map<string, number>()

  const lines = normalizeSaleLines(
    input.items.map((item) => ({
      productId: item.productId ?? null,
      productName: item.productName,
      soldQty: item.qty,
      returnedQty: item.returnedQty ?? 0,
      unitPricePaisas: item.unitPrice,
      commissionRatePaisas: item.productId ? (rates.get(item.productId) ?? 0n) : 0n,
      isTemporary: item.isTemporary ?? false,
      originalInvoiceItemId: item.originalInvoiceItemId ?? null,
      remainingReturnableQty: item.originalInvoiceItemId
        ? (remainingByItem.get(item.originalInvoiceItemId) ?? null)
        : null,
    })),
  )
  return { lines, commissionRatesAvailable: available }
}

async function loadRemainingReturnableQty(
  businessId: string,
  invoiceItemIds: readonly string[],
): Promise<Map<string, number>> {
  const remaining = new Map<string, number>()
  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('invoice_items')
      .select('id, qty, returned_qty')
      .eq('business_id', businessId)
      .in('id', [...invoiceItemIds])
    if (error) throw new Error(`Supabase referenced invoice items: ${error.message}`)
    for (const row of (data ?? []) as Array<{ id: string; qty: number; returned_qty: number | null }>) {
      remaining.set(row.id, row.qty - (row.returned_qty ?? 0))
    }
    return remaining
  }
  const items = await db.invoiceItem.findMany({
    where: { businessId, id: { in: [...invoiceItemIds] } },
    select: { id: true, qty: true, returnedQty: true },
  })
  for (const item of items) remaining.set(item.id, item.qty - item.returnedQty)
  return remaining
}

export async function postSale(input: PostSaleInput): Promise<{ invoiceId: string; invoiceNo: string }> {
  assertPhase9SaleFeatures({ discountPaisas: input.discount, idempotencyKey: input.idempotencyKey })
  const { lines } = await prepareSaleLines(input)
  const totals = computeSaleTotals(lines, {
    invoiceDiscountPaisas: input.discount ?? 0n,
    paidPaisas: input.payments.filter((p) => !p.isChange).reduce((sum, p) => sum + p.amount, 0n),
    changePaisas: input.payments.filter((p) => p.isChange).reduce((sum, p) => sum + p.amount, 0n),
  })
  const invalid = validateSaleTotals(totals)
  if (invalid) throw new SaleLineError(invalid, -1)

  if (await isPhase4Live()) return postSaleViaSupabase(input, lines)
  return postSaleViaPrisma(input, lines)
}

async function postSaleViaSupabase(
  input: PostSaleInput,
  lines: NormalizedSaleLine[],
): Promise<{ invoiceId: string; invoiceNo: string }> {
  // Until migration 00033 is applied the deployed sale RPC carries no
  // returned-quantity argument. Rather than post a mixed bill as a plain sale
  // (which would overstate stock-out, revenue and commission), fail closed with
  // an owner-actionable message.
  assertMixedSaleReturnSupport({ hasReturnLines: lines.some((line) => line.returnedQty > 0) })

  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
  // qty is the GROSS sold quantity and returned_qty the same-bill return, which
  // is how 00033 keeps invoice_items.qty / returned_qty and sale_return_lines
  // truthful. On the pre-00033 RPC no line can carry a return (asserted above),
  // so netQty === soldQty and the extra key is ignored by the older function.
  const itemsJson = lines.map((i) => ({ product_id: i.productId, product_name: i.productName, qty: i.soldQty, returned_qty: i.returnedQty, unit_price: i.unitPricePaisas.toString(), is_temporary: i.isTemporary }))
  const paymentsJson = input.payments.map((p) => ({ account_id: p.accountId, amount: p.amount.toString(), is_change: p.isChange ?? false }))
  if (await usesLegacyTransactionSchema()) {
    const { data, bridgeApplied } = await callLegacyIdentityRpc('post_sale', {
      p_business_id: input.businessId,
      p_invoice_type: input.invoiceType,
      p_invoice_date: bizDateString(input.invoiceDate),
      p_items: lines.map(item => ({
        product_id: item.productId,
        product_name: item.productName,
        qty: item.soldQty,
        unit_price: item.unitPricePaisas.toString(),
        is_temporary: item.isTemporary,
      })),
      p_payments: paymentsJson,
      p_salesman_id: input.salesmanId ?? null,
      p_customer_id: input.customerId ?? null,
      p_customer_name: input.customerName ?? null,
      p_customer_phone: input.customerPhone ?? null,
      p_customer_address: input.customerAddress ?? null,
      p_customer_city: input.customerCity ?? null,
      p_memo: input.memo ?? null,
      p_created_by: supabaseCreatedBy,
    }, input.idempotencyKey)
    const invoiceId = bridgeApplied ? (data as any).invoice_id : data as string
    const invoiceNo = bridgeApplied ? (data as any).invoice_no : null
    if (invoiceNo) return { invoiceId, invoiceNo }
    const { data: inv, error: invErr } = await admin.from('invoices')
      .select('invoice_no').eq('id', invoiceId).eq('business_id', input.businessId).single()
    if (invErr) throw new Error(`Supabase fetch invoice_no: ${invErr.message}`)
    return { invoiceId, invoiceNo: (inv as { invoice_no: string }).invoice_no }
  }
  const payload = { p_business_id: input.businessId, p_invoice_type: input.invoiceType, p_invoice_date: bizDateString(input.invoiceDate), p_items: itemsJson, p_payments: paymentsJson, p_salesman_id: input.salesmanId ?? null, p_customer_id: input.customerId ?? null, p_customer_name: input.customerName ?? null, p_customer_phone: input.customerPhone ?? null, p_customer_address: input.customerAddress ?? null, p_customer_city: input.customerCity ?? null, p_memo: input.memo ?? null, p_created_by: supabaseCreatedBy, p_idempotency_key: input.idempotencyKey ?? randomUUID() }
  const rpcName = salePostingRpcName()
  const { data, error } = await admin.rpc(rpcName, payload)
  if (error) throw new Error(`Supabase ${rpcName}: ${error.message}`)
  const invoiceId = data as string
  const { data: inv, error: invErr } = await admin.from('invoices').select('invoice_no').eq('id', invoiceId).single()
  if (invErr) throw new Error(`Supabase fetch invoice_no: ${invErr.message}`)
  return { invoiceId, invoiceNo: (inv as { invoice_no: string }).invoice_no }
}

async function postSaleViaPrisma(
  input: PostSaleInput,
  lines: NormalizedSaleLine[],
): Promise<{ invoiceId: string; invoiceNo: string }> {
  const engineTotals = computeSaleTotals(lines, {
    invoiceDiscountPaisas: input.discount ?? 0n,
    paidPaisas: input.payments.filter((p) => !p.isChange).reduce((sum, p) => sum + p.amount, 0n),
    changePaisas: input.payments.filter((p) => p.isChange).reduce((sum, p) => sum + p.amount, 0n),
  })

  // `subtotal` stays the gross sold value so the returns deduction remains a
  // visible, auditable line on the document; `total` is the net payable.
  const subtotal = engineTotals.grossSalesPaisas
  const discount = engineTotals.invoiceDiscountPaisas
  const total = engineTotals.netSalePaisas
  const paidAmount = engineTotals.paidPaisas
  const changeTotal = engineTotals.changePaisas

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
    // ── Idempotency: a replayed submission must not create a second invoice,
    //    a second stock movement or a second commission event. ──
    if (input.idempotencyKey) {
      const replay = await tx.commissionEvent.findFirst({
        where: { businessId: input.businessId, idempotencyKey: `sale-${input.idempotencyKey}` },
        select: { invoiceId: true },
      })
      if (replay) {
        const existingInvoice = await tx.invoice.findFirst({
          where: { id: replay.invoiceId, businessId: input.businessId },
          select: { id: true, invoiceNo: true },
        })
        if (existingInvoice) return { invoiceId: existingInvoice.id, invoiceNo: existingInvoice.invoiceNo }
      }
    }

    const invoiceNo = await allocateDocumentNumber(tx, input.businessId, 'INV')

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

    // ── Inventory: one net movement per product line ──
    // Sold pieces decrease stock, returned pieces restore it; only the NET is
    // applied, inside this same transaction, so a mixed bill can never leave a
    // half-applied stock position behind.
    const stockMovementByProduct = new Map<string, string>()
    for (const effect of computeStockEffects(lines)) {
      const product = await tx.product.findFirst({
        where: { id: effect.productId, businessId: input.businessId },
        select: { currentStock: true },
      })
      if (!product) throw new Error(`Product not found: ${effect.productName}`)
      if (effect.netChange === 0) continue
      const newStock = product.currentStock + effect.netChange
      const movement = await tx.stockMovement.create({
        data: {
          businessId: input.businessId,
          productId: effect.productId,
          movementType: effect.netChange < 0 ? 'adjustment_out' : 'adjustment_in',
          quantity: Math.abs(effect.netChange),
          balanceAfter: newStock,
          reason: effect.returnedQty > 0
            ? `Sale ${invoiceNo} (sold ${effect.soldQty}, returned ${effect.returnedQty})`
            : `Sale ${invoiceNo}`,
          createdBy: input.createdBy ?? null,
        },
      })
      stockMovementByProduct.set(effect.productId, movement.id)
      await tx.product.update({
        where: { id: effect.productId },
        data: { currentStock: { increment: effect.netChange } },
      })
    }

    const invoiceItemsCreated: Array<{ id: string; line: NormalizedSaleLine }> = []
    for (const line of lines) {
      const invItem = await tx.invoiceItem.create({
        data: {
          businessId: input.businessId,
          invoiceId: invoice.id,
          productId: line.productId,
          productName: line.productName,
          qty: line.soldQty,
          // Same-bill returns are recorded on the row itself so the invoice,
          // the print document and the commission engine all agree on net qty.
          returnedQty: line.kind === 'SALE' ? line.returnedQty : 0,
          unitPrice: line.unitPricePaisas,
          lineTotal: line.lineTotalPaisas,
          isTemporary: line.isTemporary,
          stockMovementId: line.productId ? (stockMovementByProduct.get(line.productId) ?? null) : null,
        },
      })
      invoiceItemsCreated.push({ id: invItem.id, line })
    }

    // ── Referenced historical returns: preserve the audit linkage ──
    const historicalReturns = lines.filter((line) => line.kind === 'HISTORICAL_RETURN')
    if (historicalReturns.length > 0) {
      const returnDocs = new Map<string, string>()
      for (const line of historicalReturns) {
        const originalItem = await tx.invoiceItem.findFirst({
          where: { id: line.originalInvoiceItemId!, businessId: input.businessId },
          select: { id: true, invoiceId: true, qty: true, returnedQty: true },
        })
        if (!originalItem) throw new Error(`Referenced invoice item not found: ${line.productName}`)
        if (originalItem.returnedQty + line.returnedQty > originalItem.qty) {
          throw new SaleLineError(
            `${line.productName}: returned quantity exceeds the remaining returnable quantity on the referenced invoice.`,
            -1,
          )
        }
        let returnDocId = returnDocs.get(originalItem.invoiceId)
        if (!returnDocId) {
          const doc = await tx.salesReturn.create({
            data: {
              businessId: input.businessId,
              originalInvoiceId: originalItem.invoiceId,
              returnDate: input.invoiceDate,
              returnNo: `${invoiceNo}-RET`,
              status: 'posted',
              reason: `Adjusted on ${invoiceNo}`,
              createdBy: input.createdBy ?? null,
              idempotencyKey: `mixed-${invoice.id}-${originalItem.invoiceId}`,
            },
          })
          returnDocId = doc.id
          returnDocs.set(originalItem.invoiceId, returnDocId)
        }
        await tx.saleReturnLine.create({
          data: {
            businessId: input.businessId,
            saleReturnId: returnDocId,
            originalInvoiceItemId: originalItem.id,
            returnedQty: line.returnedQty,
            reason: `Adjusted on ${invoiceNo}`,
          },
        })
        await tx.invoiceItem.update({
          where: { id: originalItem.id },
          data: { returnedQty: { increment: line.returnedQty } },
        })
        await tx.salesReturn.update({
          where: { id: returnDocId },
          data: { total: { increment: line.returnAmountPaisas } },
        })
      }
    }

    // ── Product-wise per-piece commission eligibility ──
    // Recorded per invoice item against the NET eligible quantity. These rows
    // are the server-authoritative source for later payment-based earning;
    // commission is earned on collection, never on invoice creation alone.
    for (const { id, line } of invoiceItemsCreated) {
      const idempotencyKey = `elig-${invoice.id}-${id}`
      const existingElig = await tx.commissionEvent.findFirst({
        where: { businessId: input.businessId, idempotencyKey },
      })
      if (!existingElig) {
        await tx.commissionEvent.create({
          data: {
            businessId: input.businessId,
            salesmanId: input.salesmanId ?? null,
            invoiceId: invoice.id,
            invoiceItemId: id,
            originalInvoiceItemId: line.originalInvoiceItemId,
            eventType: 'calculated',
            quantity: line.commissionUnits,
            ratePaisas: line.commissionRatePaisas,
            grossAmount: line.commissionRatePaisas * BigInt(line.soldQty),
            eligibleAmount: line.commissionAmountPaisas,
            payableAmount: 0n,
            paidAmount: 0n,
            status: 'calculated',
            idempotencyKey,
            // Owner-made sales are attributed to the Owner, never to a salesman.
            isOwnerOnly: input.salesmanId ? false : true,
          },
        })
      }
    }

    // Replay marker for this submission — see the idempotency guard above.
    if (input.idempotencyKey && invoiceItemsCreated.length > 0) {
      await tx.commissionEvent.create({
        data: {
          businessId: input.businessId,
          salesmanId: input.salesmanId ?? null,
          invoiceId: invoice.id,
          invoiceItemId: invoiceItemsCreated[0].id,
          eventType: 'submission',
          quantity: 0,
          ratePaisas: 0n,
          grossAmount: 0n,
          eligibleAmount: 0n,
          payableAmount: 0n,
          paidAmount: 0n,
          status: 'submitted',
          idempotencyKey: `sale-${input.idempotencyKey}`,
          isOwnerOnly: input.salesmanId ? false : true,
        },
      })
    }

    // ── Payment allocations ──
    // Always recorded, independent of the commission model in force.
    const hasPerPieceEligibility = lines.some((line) => line.commissionAmountPaisas > 0n)
    let salesman: { id: string; commissionPct: number } | null = null
    if (!hasPerPieceEligibility && input.salesmanId) {
      salesman = await tx.salesman.findUnique({ where: { id: input.salesmanId }, select: { id: true, commissionPct: true } })
    }
    for (const p of input.payments) {
      if (p.isChange) continue
      const alloc = await tx.paymentAllocation.create({ data: { businessId: input.businessId, invoiceId: invoice.id, accountId: p.accountId, amount: p.amount, isChange: false, voucherId: vch.id, createdBy: input.createdBy ?? null } })
      // Legacy percentage commission only runs when NO product carries a
      // per-piece rate, so the two models can never double-pay.
      if (salesman && p.amount > 0n) {
        const commAmount = (p.amount * BigInt(Math.round(salesman.commissionPct * 100))) / 10000n
        await tx.salesmanCommission.upsert({ where: { allocationId_salesmanId: { allocationId: alloc.id, salesmanId: salesman.id } }, create: { businessId: input.businessId, salesmanId: salesman.id, invoiceId: invoice.id, allocationId: alloc.id, collectedAmount: p.amount, commissionPct: salesman.commissionPct, commissionAmount: commAmount }, update: {} })
      }
    }

    // ── Collection-triggered commission ──
    // Only money actually received earns commission. An unpaid invoice leaves
    // the eligibility rows at status 'calculated' and earns nothing.
    if (paidAmount - changeTotal > 0n && total > 0n) {
      const collected = paidAmount - changeTotal
      for (const { id, line } of invoiceItemsCreated) {
        if (line.commissionAmountPaisas <= 0n) continue
        const earned = computeEarnedCommission({
          totalEligibilityPaisas: line.commissionAmountPaisas,
          invoiceTotalPaisas: total,
          collectedAmountPaisas: collected,
          priorEarnedPaisas: 0n,
        })
        if (earned <= 0n) continue
        await tx.commissionEvent.create({
          data: {
            businessId: input.businessId,
            salesmanId: input.salesmanId ?? null,
            invoiceId: invoice.id,
            invoiceItemId: id,
            eventType: 'collection',
            quantity: line.commissionUnits,
            ratePaisas: line.commissionRatePaisas,
            grossAmount: line.commissionAmountPaisas,
            eligibleAmount: line.commissionAmountPaisas,
            payableAmount: earned,
            paidAmount: 0n,
            status: 'payable',
            idempotencyKey: `coll-${invoice.id}-${id}-0`,
            isOwnerOnly: input.salesmanId ? false : true,
          },
        })
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
  const invoices = await db.invoice.findMany({
    where: {
      businessId,
      ...(opts?.type ? { invoiceType: opts.type } : {}),
      ...(opts?.salesmanId ? { salesmanId: opts.salesmanId } : {}),
    },
    select: {
      id: true,
      invoiceNo: true,
      invoiceType: true,
      invoiceDate: true,
      customerName: true,
      subtotal: true,
      total: true,
      paidAmount: true,
      isCancelled: true,
      isReturned: true,
      salesman: { select: { name: true } },
    },
    orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  })
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
    const { data: returns, error: returnError } = await admin.from('sales_returns').select('*').eq('business_id', businessId).eq('original_invoice_id', invoiceId).order('return_date')
    if (returnError) throw new Error(`Supabase invoice returns: ${returnError.message}`)
    return { id: r.id, invoiceNo: r.invoice_no, invoiceType: r.invoice_type, invoiceDate: r.invoice_date, customerName: r.customer_name, customerPhone: r.customer_phone, customerAddress: r.customer_address, customerCity: r.customer_city, salesmanName: r.salesmen?.name ?? null, subtotal: String(r.subtotal), discount: String(r.discount ?? 0), total: String(r.total), paidAmount: String(r.paid), status: r.status, isCancelled: r.status === 'Cancelled', isReturned: r.status === 'Returned', memo: r.memo, items: (r.invoice_items ?? []).map((it: any) => ({ id: it.id, productId: it.product_id, productName: it.product_name, qty: it.qty, returnedQty: it.returned_qty, unitPrice: String(it.unit_price), lineTotal: String(it.line_total), isTemporary: it.is_temporary })), payments: (payments ?? []).map((p: any) => ({ id: p.id, accountName: p.payment_mode ?? 'Payment', amount: String(p.amount), direction: p.direction, paymentMode: p.payment_mode })), returns: (returns ?? []).map((sr: any) => ({ returnNo: sr.return_no, returnDate: sr.return_date, total: String(sr.total), settlementStatus: sr.settlement_status ?? 'POSTED' })) }
  }
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, businessId }, include: { salesman: true, items: true, paymentAllocations: { include: { account: true } }, salesReturns: true } })
  if (!inv) return null
  return { id: inv.id, invoiceNo: inv.invoiceNo, invoiceType: inv.invoiceType, invoiceDate: inv.invoiceDate.toISOString(), customerName: inv.customerName, customerPhone: inv.customerPhone, customerAddress: inv.customerAddress, customerCity: inv.customerCity, salesmanName: inv.salesman?.name ?? null, subtotal: inv.subtotal.toString(), discount: inv.discount.toString(), total: inv.total.toString(), paidAmount: inv.paidAmount.toString(), isCancelled: inv.isCancelled, isReturned: inv.isReturned, memo: inv.memo, items: inv.items.map((it) => ({ id: it.id, productId: it.productId, productName: it.productName, qty: it.qty, returnedQty: it.returnedQty, unitPrice: it.unitPrice.toString(), lineTotal: it.lineTotal.toString(), isTemporary: it.isTemporary })), payments: inv.paymentAllocations.map((pa) => ({ id: pa.id, accountId: pa.accountId, accountCode: pa.account.code, accountName: pa.account.name, amount: pa.amount.toString(), isChange: pa.isChange })), returns: inv.salesReturns.map((sr) => ({ returnNo: sr.returnNo, returnDate: sr.returnDate.toISOString(), total: sr.total.toString(), settlementStatus: sr.status === 'refunded' ? 'REFUNDED' : sr.status === 'credit_due' ? 'CREDIT_DUE' : 'POSTED' })) }
}

/**
 * Item-level commission detail for one invoice.
 *
 * Individual entries are preserved — a single opaque invoice-level figure is
 * deliberately NOT returned. When the migration-dependent commission schema is
 * absent the caller receives `available: false` and a precise reason rather
 * than a fabricated zero.
 */
export async function getInvoiceCommissionDetail(
  businessId: string,
  invoiceId: string,
): Promise<{ available: boolean; reason: string | null; rows: InvoiceCommissionRow[]; totalPaisas: string }> {
  const unavailable = (reason: string) => ({ available: false, reason, rows: [], totalPaisas: '0' })

  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('commission_events')
      .select('invoice_item_id, event_type, quantity, rate_paisas, eligible_amount, payable_amount, status, created_at, salesman_id, salesmen(name), invoice_items(product_id, product_name, qty, returned_qty)')
      .eq('business_id', businessId)
      .eq('invoice_id', invoiceId)
      .order('created_at')
    if (error) {
      return unavailable(
        'Commission detail needs the Phase 2 commission tables on this database. Ask the owner to apply the pending commission migration.',
      )
    }
    const rows: InvoiceCommissionRow[] = (data ?? [])
      .filter((r: any) => r.event_type !== 'submission')
      .map((r: any) => {
        const eventType = canonicalCommissionEventType(r.event_type)
        return {
          invoiceItemId: r.invoice_item_id,
          productId: r.invoice_items?.product_id ?? null,
          productName: r.invoice_items?.product_name ?? 'Item',
          soldQty: r.invoice_items?.qty ?? r.quantity ?? 0,
          returnedQty: r.invoice_items?.returned_qty ?? 0,
          netEligibleQty: r.quantity ?? 0,
          ratePaisas: String(r.rate_paisas ?? 0),
          commissionPaisas: String(eventType === 'collection' ? (r.payable_amount ?? 0) : (r.eligible_amount ?? 0)),
          status: r.status ?? 'calculated',
          eventType,
          sellerName: r.salesmen?.name ?? null,
          sellerRole: r.salesman_id ? 'SALESMAN' : 'OWNER',
          paymentReference: eventType === 'collection' ? 'Collection' : null,
          createdAt: r.created_at ?? null,
        }
      })
    return {
      available: true,
      reason: null,
      rows,
      totalPaisas: rows
        .filter((r) => r.eventType === 'calculated')
        .reduce((sum, r) => sum + BigInt(r.commissionPaisas), 0n)
        .toString(),
    }
  }

  const events = await db.commissionEvent.findMany({
    where: { businessId, invoiceId, eventType: { not: 'submission' } },
    include: { invoiceItem: true, salesman: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const rows: InvoiceCommissionRow[] = events.map((event) => ({
    invoiceItemId: event.invoiceItemId,
    productId: event.invoiceItem?.productId ?? null,
    productName: event.invoiceItem?.productName ?? 'Item',
    soldQty: event.invoiceItem?.qty ?? event.quantity,
    returnedQty: event.invoiceItem?.returnedQty ?? 0,
    netEligibleQty: event.quantity,
    ratePaisas: event.ratePaisas.toString(),
    commissionPaisas: (event.eventType === 'calculated' ? event.eligibleAmount : event.payableAmount).toString(),
    status: event.status,
    eventType: event.eventType,
    sellerName: event.salesman?.name ?? null,
    sellerRole: event.salesmanId ? 'SALESMAN' : 'OWNER',
    paymentReference: event.eventType === 'collection' ? 'Collection' : null,
    createdAt: event.createdAt.toISOString(),
  }))
  return {
    available: true,
    reason: null,
    rows,
    totalPaisas: rows
      .filter((r) => r.eventType === 'calculated')
      .reduce((sum, r) => sum + BigInt(r.commissionPaisas), 0n)
      .toString(),
  }
}

/** One period-scoped commission entry, carrying its own invoice reference. */
export type SalesmanCommissionRow = InvoiceCommissionRow & {
  invoiceId: string
  invoiceNo: string
  invoiceDate: string
}

/**
 * Item-level commission entries earned by one salesman inside a date window.
 *
 * Individual entries are preserved so the report can show product, sold,
 * returned and net quantities per line instead of one opaque invoice figure.
 */
export async function getSalesmanCommissionDetail(
  businessId: string,
  salesmanId: string,
  fromDate: string,
  toDate: string,
): Promise<{ available: boolean; reason: string | null; rows: SalesmanCommissionRow[]; totalPaisas: string }> {
  const unavailable = (reason: string) => ({ available: false, reason, rows: [], totalPaisas: '0' })

  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('commission_events')
      .select('invoice_id, invoice_item_id, event_type, quantity, rate_paisas, eligible_amount, payable_amount, status, created_at, salesman_id, salesmen(name), invoices!inner(invoice_no, invoice_date), invoice_items(product_id, product_name, qty, returned_qty)')
      .eq('business_id', businessId)
      .eq('salesman_id', salesmanId)
      .gte('invoices.invoice_date', fromDate)
      .lte('invoices.invoice_date', toDate)
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) {
      return unavailable(
        'Product-wise commission detail needs the Phase 2 commission tables on this database. Ask the owner to apply the pending commission migration.',
      )
    }
    const rows: SalesmanCommissionRow[] = (data ?? [])
      .filter((r: any) => r.event_type !== 'submission')
      .map((r: any) => {
        const eventType = canonicalCommissionEventType(r.event_type)
        return {
          invoiceId: r.invoice_id,
          invoiceNo: r.invoices?.invoice_no ?? '—',
          invoiceDate: r.invoices?.invoice_date ?? '',
          invoiceItemId: r.invoice_item_id,
          productId: r.invoice_items?.product_id ?? null,
          productName: r.invoice_items?.product_name ?? 'Item',
          soldQty: r.invoice_items?.qty ?? r.quantity ?? 0,
          returnedQty: r.invoice_items?.returned_qty ?? 0,
          netEligibleQty: r.quantity ?? 0,
          ratePaisas: String(r.rate_paisas ?? 0),
          commissionPaisas: String(eventType === 'collection' ? (r.payable_amount ?? 0) : (r.eligible_amount ?? 0)),
          status: r.status ?? 'calculated',
          eventType,
          sellerName: r.salesmen?.name ?? null,
          sellerRole: (r.salesman_id ? 'SALESMAN' : 'OWNER') as SellerRole,
          paymentReference: eventType === 'collection' ? 'Collection' : null,
          createdAt: r.created_at ?? null,
        }
      })
    return { available: true, reason: null, rows, totalPaisas: sumEarnedCommission(rows) }
  }

  const events = await db.commissionEvent.findMany({
    where: {
      businessId,
      salesmanId,
      eventType: { not: 'submission' },
      invoice: {
        invoiceDate: {
          gte: new Date(`${fromDate}T00:00:00+05:00`),
          lte: new Date(`${toDate}T23:59:59.999+05:00`),
        },
      },
    },
    include: { invoice: { select: { invoiceNo: true, invoiceDate: true } }, invoiceItem: true, salesman: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  const rows: SalesmanCommissionRow[] = events.map((event) => ({
    invoiceId: event.invoiceId,
    invoiceNo: event.invoice?.invoiceNo ?? '—',
    invoiceDate: event.invoice ? bizDateString(event.invoice.invoiceDate) : '',
    invoiceItemId: event.invoiceItemId,
    productId: event.invoiceItem?.productId ?? null,
    productName: event.invoiceItem?.productName ?? 'Item',
    soldQty: event.invoiceItem?.qty ?? event.quantity,
    returnedQty: event.invoiceItem?.returnedQty ?? 0,
    netEligibleQty: event.quantity,
    ratePaisas: event.ratePaisas.toString(),
    commissionPaisas: (event.eventType === 'calculated' ? event.eligibleAmount : event.payableAmount).toString(),
    status: event.status,
    eventType: event.eventType,
    sellerName: event.salesman?.name ?? null,
    sellerRole: (event.salesmanId ? 'SALESMAN' : 'OWNER') as SellerRole,
    paymentReference: event.eventType === 'collection' ? 'Collection' : null,
    createdAt: event.createdAt.toISOString(),
  }))
  return { available: true, reason: null, rows, totalPaisas: sumEarnedCommission(rows) }
}

/**
 * Totals only the eligibility rows: a collection event repeats the same money
 * as its `calculated` parent, so adding both would double-count.
 */
function sumEarnedCommission(rows: InvoiceCommissionRow[]): string {
  return rows
    .filter((r) => r.eventType === 'calculated')
    .reduce((sum, r) => sum + BigInt(r.commissionPaisas), 0n)
    .toString()
}

export type BusinessIdentity = { name: string; phone: string | null; address: string | null }

/**
 * Business letterhead for printed documents.
 *
 * Production column availability on `businesses` varies, so the row is read
 * whole and each optional field is picked defensively. A failure returns null
 * and the caller falls back to a neutral heading rather than breaking print.
 */
export async function getBusinessIdentity(businessId: string): Promise<BusinessIdentity | null> {
  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin.from('businesses').select('*').eq('id', businessId).maybeSingle()
    if (error || !data) return null
    const row = data as Record<string, any>
    const name = row.name ?? row.legal_name
    if (!name) return null
    return { name: String(name), phone: row.phone ?? null, address: row.address ?? null }
  }

  const biz = await db.business.findFirst({ where: { id: businessId }, select: { name: true, legalName: true, phone: true, address: true } })
  if (!biz) return null
  return { name: biz.name || biz.legalName || '', phone: biz.phone ?? null, address: biz.address ?? null }
}

export type LinkedReturnInput = {
  businessId: string
  invoiceId: string
  items: Array<{ invoiceItemId: string; qty: number }>
  refundMode: 'CREDIT' | 'CASH' | 'BANK'
  /** Required for an immediate refund; this is a ledger Account ID, not a label. */
  refundAccountId?: string | null
  reason?: string | null
  idempotencyKey: string
  actorId: string
}

export type LinkedReturnResult = {
  returnId: string
  returnNo: string
  total: string
  status: string
  settlementStatus: 'CREDIT_DUE' | 'REFUNDED'
  idempotent: boolean
}

export async function postLinkedSaleReturn(input: LinkedReturnInput): Promise<LinkedReturnResult> {
  if (input.items.length === 0) throw new Error('At least one return item is required')
  if (input.items.some((item) => !Number.isInteger(item.qty) || item.qty <= 0)) {
    throw new Error('Return quantities must be positive whole numbers')
  }
  const requestedIds = input.items.map((item) => item.invoiceItemId)
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new Error('A duplicate invoice item cannot be returned twice in one request')
  }
  if (input.refundMode !== 'CREDIT' && !input.refundAccountId) {
    throw new Error('A refund account is required for an immediate refund')
  }

  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const actorId = await resolveSupabaseUuid(input.actorId)
    if (!actorId) throw new Error('Server-attributed return actor is unavailable')
    if (await usesLegacyTransactionSchema()) {
      const data = await callRequiredLegacyIdentityRpc('post_sales_return', {
        p_business_id: input.businessId,
        p_invoice_id: input.invoiceId,
        p_return_date: bizDateString(new Date()),
        p_return_items: input.items.map((item) => ({ invoice_item_id: item.invoiceItemId, qty: item.qty })),
        p_refund_mode: input.refundMode,
        p_refund_account_id: input.refundAccountId ?? null,
        p_reason: input.reason ?? null,
        p_created_by: actorId,
      }, input.idempotencyKey, 'Historical Sales Return', '00037_legacy_historical_sales_returns.sql')
      const result = data as any
      return {
        returnId: result.return_id,
        returnNo: result.return_no,
        total: String(result.total),
        status: result.status,
        settlementStatus: result.settlement_status ?? (input.refundMode === 'CREDIT' ? 'CREDIT_DUE' : 'REFUNDED'),
        idempotent: Boolean(result.idempotent),
      }
    }
    const { data, error } = await admin.rpc('post_sale_return_ledger', {
      p_business_id: input.businessId,
      p_original_invoice_id: input.invoiceId,
      p_items: input.items.map((item) => ({ invoice_item_id: item.invoiceItemId, qty: item.qty })),
      p_refund_mode: input.refundMode,
      p_reason: input.reason ?? null,
      p_idempotency_key: input.idempotencyKey,
      p_actor_id: actorId,
    })
    if (error) throw new Error(`Supabase post_sale_return_ledger: ${error.message}`)
    const result = data as any
    return {
      returnId: result.return_id,
      returnNo: result.return_no,
      total: String(result.total),
      status: result.status,
      settlementStatus: input.refundMode === 'CREDIT' ? 'CREDIT_DUE' : 'REFUNDED',
      idempotent: Boolean(result.idempotent),
    }
  }
  return postLinkedSaleReturnViaPrisma(input)
}

/**
 * Transactional local/runtime adapter for a pure historical return.
 *
 * The original invoice and its sold quantities are immutable. The auditable
 * return line is the source of truth; InvoiceItem.returnedQty is only updated as
 * a guarded cache after the exact line is recorded.
 */
async function postLinkedSaleReturnViaPrisma(input: LinkedReturnInput): Promise<LinkedReturnResult> {
  const requestedIds = input.items.map((item) => item.invoiceItemId)
  return db.$transaction(async (tx) => {
    const replay = await tx.salesReturn.findUnique({
      where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: input.idempotencyKey } },
      include: { lines: true },
    })
    if (replay) {
      const sameInvoice = replay.originalInvoiceId === input.invoiceId
      const replayLines = new Map(replay.lines.map((line) => [line.originalInvoiceItemId, line.returnedQty]))
      const sameLines = replayLines.size === input.items.length
        && input.items.every((item) => replayLines.get(item.invoiceItemId) === item.qty)
      if (!sameInvoice || !sameLines) throw new Error('The idempotency key was already used for a different sales return')
      return {
        returnId: replay.id,
        returnNo: replay.returnNo,
        total: replay.total.toString(),
        status: replay.status,
        settlementStatus: replay.status === 'refunded' ? 'REFUNDED' : 'CREDIT_DUE',
        idempotent: true,
      }
    }

    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId, businessId: input.businessId },
      select: { id: true, invoiceNo: true, isCancelled: true },
    })
    if (!invoice) throw new Error('Original invoice not found for this business')
    if (invoice.isCancelled) throw new Error('A cancelled invoice cannot be returned')

    const sourceItems = await tx.invoiceItem.findMany({
      where: { id: { in: requestedIds }, invoiceId: invoice.id, businessId: input.businessId },
      select: {
        id: true, productId: true, productName: true, qty: true, returnedQty: true,
        unitPrice: true,
      },
    })
    if (sourceItems.length !== input.items.length) {
      throw new Error('A referenced invoice item was not found or does not belong to the original invoice and business')
    }
    const sourceById = new Map(sourceItems.map((item) => [item.id, item]))
    let total = 0n
    for (const requested of input.items) {
      const source = sourceById.get(requested.invoiceItemId)!
      const remaining = source.qty - source.returnedQty
      if (requested.qty > remaining) {
        throw new Error(`${source.productName}: return quantity exceeds remaining returnable quantity (${remaining})`)
      }
      total += source.unitPrice * BigInt(requested.qty)
    }

    const salesAccount = await tx.account.findFirst({
      where: { businessId: input.businessId, code: '4010', isActive: true },
      select: { id: true, balanceCache: true },
    })
    if (!salesAccount) throw new Error('Sales account (4010) not found')

    const settlementAccount = input.refundMode === 'CREDIT'
      ? await tx.account.findFirst({
          where: { businessId: input.businessId, code: '1200', isActive: true },
          select: { id: true, balanceCache: true },
        })
      : await tx.account.findFirst({
          where: {
            id: input.refundAccountId!, businessId: input.businessId,
            isActive: true, isBusinessAccount: true,
          },
          select: { id: true, balanceCache: true },
        })
    if (!settlementAccount) {
      throw new Error(input.refundMode === 'CREDIT'
        ? 'Accounts Receivable (1200) is required to record customer credit'
        : 'The selected refund account was not found or is inactive')
    }

    const returnNo = await allocateDocumentNumber(tx, input.businessId, 'SRT')
    const settlementStatus = input.refundMode === 'CREDIT' ? 'CREDIT_DUE' : 'REFUNDED'
    const doc = await tx.salesReturn.create({
      data: {
        businessId: input.businessId,
        originalInvoiceId: invoice.id,
        returnDate: new Date(),
        total,
        returnNo,
        status: settlementStatus === 'REFUNDED' ? 'refunded' : 'credit_due',
        reason: input.reason ?? null,
        createdBy: input.actorId,
        idempotencyKey: input.idempotencyKey,
      },
    })

    const voucher = await tx.voucher.create({
      data: {
        businessId: input.businessId,
        voucherType: 'SR',
        voucherDate: new Date(),
        memo: `Historical return ${returnNo} against ${invoice.invoiceNo}`,
        referenceId: doc.id,
        referenceType: 'sales_return',
        postedBy: input.actorId,
        totalDebit: total,
        totalCredit: total,
      },
    })
    await tx.voucherLine.createMany({ data: [
      { businessId: input.businessId, voucherId: voucher.id, accountId: salesAccount.id, debit: total, credit: 0n, memo: `Return ${returnNo}`, lineOrder: 0 },
      { businessId: input.businessId, voucherId: voucher.id, accountId: settlementAccount.id, debit: 0n, credit: total, memo: settlementStatus === 'REFUNDED' ? `Refund ${returnNo}` : `Customer credit ${returnNo}`, lineOrder: 1 },
    ] })
    await tx.account.update({ where: { id: salesAccount.id }, data: { balanceCache: salesAccount.balanceCache + total } })
    await tx.account.update({ where: { id: settlementAccount.id }, data: { balanceCache: settlementAccount.balanceCache - total } })
    await tx.salesReturn.update({ where: { id: doc.id }, data: { returnVoucherId: voucher.id } })

    for (const requested of input.items) {
      const source = sourceById.get(requested.invoiceItemId)!
      await tx.saleReturnLine.create({
        data: {
          businessId: input.businessId,
          saleReturnId: doc.id,
          originalInvoiceItemId: source.id,
          returnedQty: requested.qty,
          reason: input.reason ?? null,
        },
      })
      const guarded = await tx.invoiceItem.updateMany({
        where: { id: source.id, businessId: input.businessId, returnedQty: source.returnedQty },
        data: { returnedQty: { increment: requested.qty } },
      })
      if (guarded.count !== 1) throw new Error(`${source.productName}: return quantity changed concurrently; retry the return`)

      if (source.productId) {
        const product = await tx.product.findFirst({
          where: { id: source.productId, businessId: input.businessId },
          select: { currentStock: true },
        })
        if (!product) throw new Error(`Product not found: ${source.productName}`)
        const balanceAfter = product.currentStock + requested.qty
        await tx.stockMovement.create({
          data: {
            businessId: input.businessId,
            productId: source.productId,
            movementType: 'adjustment_in',
            quantity: requested.qty,
            balanceAfter,
            reason: `Historical return ${returnNo} against ${invoice.invoiceNo}`,
            createdBy: input.actorId,
          },
        })
        await tx.product.update({ where: { id: source.productId }, data: { currentStock: { increment: requested.qty } } })
      }

      const eligibility = await tx.commissionEvent.findFirst({
        where: { businessId: input.businessId, invoiceId: invoice.id, invoiceItemId: source.id, eventType: 'calculated' },
      })
      if (eligibility) {
        const earned = await tx.commissionEvent.aggregate({
          where: {
            businessId: input.businessId,
            invoiceId: invoice.id,
            invoiceItemId: source.id,
            eventType: { in: ['collection', 'reversal'] },
          },
          _sum: { payableAmount: true },
        })
        const earnedRemaining = earned._sum.payableAmount ?? 0n
        const adjustment = computeHistoricalReturnCommissionAdjustment({
          ratePaisas: eligibility.ratePaisas,
          returnedQty: requested.qty,
          earnedRemainingPaisas: earnedRemaining,
        })
        await tx.commissionEvent.create({
          data: {
            businessId: input.businessId,
            salesmanId: eligibility.salesmanId,
            invoiceId: invoice.id,
            invoiceItemId: source.id,
            originalInvoiceItemId: source.id,
            returnEventId: doc.id,
            eventType: 'reversal',
            quantity: -requested.qty,
            ratePaisas: eligibility.ratePaisas,
            grossAmount: -(source.unitPrice * BigInt(requested.qty)),
            eligibleAmount: -adjustment.eligibleReversalPaisas,
            payableAmount: -adjustment.payableReversalPaisas,
            paidAmount: 0n,
            status: 'reversed',
            idempotencyKey: `return-${doc.id}-${source.id}`,
            isOwnerOnly: eligibility.isOwnerOnly,
          },
        })
      }
    }

    // Prisma cannot compare two columns in SQLite. Re-read the small invoice
    // item set and update only the status cache; sold quantities stay immutable.
    const updatedItems = await tx.invoiceItem.findMany({
      where: { invoiceId: invoice.id, businessId: input.businessId },
      select: { qty: true, returnedQty: true },
    })
    const allReturned = updatedItems.every((item) => item.returnedQty >= item.qty)
    await tx.invoice.update({ where: { id: invoice.id }, data: { isReturned: allReturned } })

    const refundAllocation = await tx.paymentAllocation.create({
      data: {
        businessId: input.businessId,
        invoiceId: invoice.id,
        accountId: settlementAccount.id,
        amount: total,
        isChange: true,
        voucherId: voucher.id,
        createdBy: input.actorId,
      },
    })

    // Older local invoices can use percentage-on-collection commission instead
    // of per-product events. Preserve those original rows and add a capped
    // negative adjustment through the existing allocation-linked model.
    const legacyCommissions = await tx.salesmanCommission.findMany({
      where: { businessId: input.businessId, invoiceId: invoice.id },
      select: { salesmanId: true, commissionPct: true, commissionAmount: true },
    })
    const legacyBySalesman = new Map<string, { commissionPct: number; earnedRemaining: bigint }>()
    for (const commission of legacyCommissions) {
      const current = legacyBySalesman.get(commission.salesmanId)
      legacyBySalesman.set(commission.salesmanId, {
        commissionPct: commission.commissionPct,
        earnedRemaining: (current?.earnedRemaining ?? 0n) + commission.commissionAmount,
      })
    }
    for (const [salesmanId, commission] of legacyBySalesman) {
      if (commission.earnedRemaining <= 0n) continue
      const eligible = (total * BigInt(Math.round(commission.commissionPct * 100))) / 10000n
      const reversal = commission.earnedRemaining < eligible ? commission.earnedRemaining : eligible
      if (reversal <= 0n) continue
      await tx.salesmanCommission.create({
        data: {
          businessId: input.businessId,
          salesmanId,
          invoiceId: invoice.id,
          allocationId: refundAllocation.id,
          collectedAmount: -total,
          commissionPct: commission.commissionPct,
          commissionAmount: -reversal,
        },
      })
    }

    return {
      returnId: doc.id,
      returnNo,
      total: total.toString(),
      status: allReturned ? 'Returned' : 'Partially Returned',
      settlementStatus,
      idempotent: false,
    }
  })
}

export async function receiveInvoicePayment(input: { businessId: string; invoiceId: string; amount: bigint; mode: string; idempotencyKey: string; actorId: string }): Promise<{ paymentId: string; amount: string; idempotent: boolean }> {
  if (input.amount <= 0n) throw new Error('Collection amount must be positive')
  if (!(await isPhase4Live())) return receiveInvoicePaymentViaPrisma(input)
  const admin = getAdminSupabase()
  const actorId = await resolveSupabaseUuid(input.actorId)
  if (!actorId) throw new Error('Server-attributed collection actor is unavailable')
  const { data, error } = await admin.rpc('receive_invoice_payment_ledger', {
    p_business_id: input.businessId, p_invoice_id: input.invoiceId,
    p_amount: input.amount.toString(), p_mode: input.mode,
    p_idempotency_key: input.idempotencyKey,
    p_actor_id: actorId,
  })
  if (error) throw new Error(`Supabase receive_invoice_payment_ledger: ${error.message}`)
  const result = data as any
  return { paymentId: result.payment_id, amount: String(result.amount), idempotent: Boolean(result.idempotent) }
}

/**
 * Local (Prisma) invoice collection.
 *
 * Mirrors the production RPC contract: idempotent by business-scoped key,
 * never collects beyond the outstanding amount, and earns product-wise
 * commission proportionally to the money actually received.
 */
async function receiveInvoicePaymentViaPrisma(input: {
  businessId: string; invoiceId: string; amount: bigint; mode: string; idempotencyKey: string; actorId: string
}): Promise<{ paymentId: string; amount: string; idempotent: boolean }> {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId, businessId: input.businessId },
      select: { id: true, total: true, paidAmount: true, salesmanId: true, voucherId: true },
    })
    if (!invoice) throw new Error('Invoice not found')

    const replay = await tx.commissionEvent.findFirst({
      where: { businessId: input.businessId, idempotencyKey: `recv-${input.idempotencyKey}` },
      select: { id: true },
    })
    if (replay) return { paymentId: replay.id, amount: input.amount.toString(), idempotent: true }

    const outstanding = invoice.total - invoice.paidAmount
    if (input.amount > outstanding) {
      throw new Error(`Collection exceeds the outstanding amount on this invoice.`)
    }

    const account = await getAccountByCode(input.businessId, input.mode === 'BANK' ? '1020' : '1010')
    if (!account) throw new Error(`Collection account for mode ${input.mode} was not found.`)

    const allocation = await tx.paymentAllocation.create({
      data: {
        businessId: input.businessId, invoiceId: invoice.id, accountId: account.id,
        amount: input.amount, isChange: false, voucherId: invoice.voucherId,
        createdBy: input.actorId,
      },
    })
    await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount: { increment: input.amount } } })

    // Commission is earned here — on money received — not at invoice creation.
    const collectedAfter = invoice.paidAmount + input.amount
    const items = await tx.invoiceItem.findMany({ where: { invoiceId: invoice.id }, select: { id: true } })
    for (const item of items) {
      const eligibility = await tx.commissionEvent.findFirst({
        where: { businessId: input.businessId, invoiceId: invoice.id, invoiceItemId: item.id, eventType: 'calculated' },
      })
      if (!eligibility || eligibility.eligibleAmount <= 0n) continue
      const prior = await tx.commissionEvent.aggregate({
        where: { businessId: input.businessId, invoiceId: invoice.id, invoiceItemId: item.id, eventType: 'collection' },
        _sum: { payableAmount: true },
      })
      const priorEarned = prior._sum.payableAmount ?? 0n
      const earned = computeEarnedCommission({
        totalEligibilityPaisas: eligibility.eligibleAmount,
        invoiceTotalPaisas: invoice.total,
        collectedAmountPaisas: collectedAfter,
        priorEarnedPaisas: priorEarned,
      })
      if (earned <= 0n) continue
      await tx.commissionEvent.create({
        data: {
          businessId: input.businessId, salesmanId: invoice.salesmanId,
          invoiceId: invoice.id, invoiceItemId: item.id,
          eventType: 'collection', quantity: eligibility.quantity,
          ratePaisas: eligibility.ratePaisas, grossAmount: eligibility.eligibleAmount,
          eligibleAmount: eligibility.eligibleAmount, payableAmount: earned, paidAmount: 0n,
          status: 'payable', allocationId: allocation.id,
          idempotencyKey: `coll-${invoice.id}-${item.id}-${allocation.id}`,
          isOwnerOnly: invoice.salesmanId ? false : true,
        },
      })
    }

    await tx.commissionEvent.create({
      data: {
        businessId: input.businessId, salesmanId: invoice.salesmanId,
        invoiceId: invoice.id, invoiceItemId: items[0]?.id ?? '',
        eventType: 'submission', quantity: 0, ratePaisas: 0n, grossAmount: 0n,
        eligibleAmount: 0n, payableAmount: 0n, paidAmount: 0n, status: 'submitted',
        allocationId: allocation.id, idempotencyKey: `recv-${input.idempotencyKey}`,
        isOwnerOnly: invoice.salesmanId ? false : true,
      },
    })

    return { paymentId: allocation.id, amount: input.amount.toString(), idempotent: false }
  })
}

export async function listCustomers(businessId: string): Promise<CustomerRow[]> {
  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('customers')
      .select('id, name, phone, address, city, is_active')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name')
    if (error) throw error
    return (data ?? []).map((customer: any) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      city: customer.city,
      isActive: customer.is_active,
    }))
  }
  const customers = await db.customer.findMany({
    where: { businessId, isActive: true },
    select: {
      id: true,
      name: true,
      phone: true,
      address: true,
      city: true,
      isActive: true,
    },
    orderBy: { name: 'asc' },
  })
  return customers.map((customer) => ({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    city: customer.city,
    isActive: customer.isActive,
  }))
}
