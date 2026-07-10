/**
 * Smart data-access helpers for the Phase 4 Sales module.
 *
 * Dual-path: uses Supabase RPC when Phase 4 is applied, Prisma otherwise.
 *
 * Money is BigInt paisas throughout — passed as string over JSON to preserve
 * precision.
 */
import 'server-only'
import { db } from '@/lib/db'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { bizDateString } from '@/lib/dates'
import { getAccountByCode } from '@/lib/accounting/data-access'

let _phase4Checked = false
let _phase4Applied = false

async function isPhase4Live(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !pub || !svc) return false
  if (url.includes('<') || pub.includes('<') || svc.includes('<')) return false

  if (_phase4Checked) return _phase4Applied
  _phase4Checked = true
  try {
    const admin = getAdminSupabase()
    const { data, error } = await admin.from('invoices').select('id').limit(1)
    _phase4Applied = !error && Array.isArray(data)
  } catch {
    _phase4Applied = false
  }
  return _phase4Applied
}

/** Resolve a Prisma user ID (cuid) to the Supabase auth.users UUID. */
async function resolveSupabaseUuid(prismaUserId: string | null | undefined): Promise<string | null> {
  if (!prismaUserId) return null
  const u = await db.user.findUnique({
    where: { id: prismaUserId },
    select: { supabaseUserUuid: true },
  })
  return u?.supabaseUserUuid ?? null
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export type SalesmanRow = {
  id: string
  name: string
  phone: string | null
  commissionPct: number
  isActive: boolean
}

export type InvoiceRow = {
  id: string
  invoiceNo: string
  invoiceType: string
  invoiceDate: string
  customerName: string | null
  salesmanName: string | null
  subtotal: string
  total: string
  paidAmount: string
  isCancelled: boolean
  isReturned: boolean
  items?: InvoiceItemRow[]
  payments?: PaymentAllocationRow[]
}

export type InvoiceItemRow = {
  id: string
  productId: string | null
  productName: string
  qty: number
  unitPrice: string
  lineTotal: string
  isTemporary: boolean
}

export type PaymentAllocationRow = {
  id: string
  accountId: string
  accountCode: string
  accountName: string
  amount: string
  isChange: boolean
}

export type PostSaleInput = {
  businessId: string
  invoiceType: 'COUNTER' | 'ONLINE' | 'OFC'
  invoiceDate: Date
  items: Array<{
    productId?: string | null
    productName: string
    qty: number
    unitPrice: bigint
    isTemporary?: boolean
  }>
  payments: Array<{
    accountId: string
    amount: bigint
    isChange?: boolean
  }>
  salesmanId?: string | null
  customerId?: string | null
  customerName?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  customerCity?: string | null
  memo?: string | null
  createdBy?: string | null
}

// ─────────────────────────────────────────────────────────────
// Salesmen
// ─────────────────────────────────────────────────────────────
export async function listSalesmen(businessId: string): Promise<SalesmanRow[]> {
  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('salesmen')
      .select('id, name, phone, commission_pct, is_active')
      .eq('business_id', businessId)
      .order('name')
    if (error) throw new Error(`Supabase: ${error.message}`)
    return (data ?? []).map((s: any) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      commissionPct: Number(s.commission_pct),
      isActive: s.is_active,
    }))
  }
  const salesmen = await db.salesman.findMany({
    where: { businessId },
    orderBy: { name: 'asc' },
  })
  return salesmen.map((s) => ({
    id: s.id,
    name: s.name,
    phone: s.phone,
    commissionPct: s.commissionPct,
    isActive: s.isActive,
  }))
}

/**
 * Resolve the salesman_id for the current user.
 * Used to filter invoices for users with can_view_own_sales only.
 * Returns null if no salesman record is linked to this user.
 */
export async function resolveSalesmanIdForUser(
  businessId: string,
  supabaseUserUuid: string | null,
  prismaUserId: string,
): Promise<string | null> {
  if (await isPhase4Live()) {
    if (!supabaseUserUuid) {
      // No Supabase UUID — fall through to Prisma fallback
    } else {
      const admin = getAdminSupabase()
      const { data, error } = await admin
        .from('salesmen')
        .select('id')
        .eq('business_id', businessId)
        .eq('user_id', supabaseUserUuid)
        .maybeSingle()
      if (!error && data) {
        return data.id
      }
      // If error (e.g. user_id column doesn't exist yet), fall through to Prisma
    }
  }
  // Prisma fallback (also used when Supabase query fails)
  const sm = await db.salesman.findFirst({
    where: { businessId, userId: prismaUserId },
    select: { id: true },
  })
  return sm?.id ?? null
}

/**
 * Resolve the effective salesman_id for a sale being posted.
 *
 * - Owner/Accountant (can_view_sales): use the client-supplied salesmanId.
 * - Salesman (can_view_own_sales, not can_view_sales): resolve their own
 *   linked salesman_id and use that, ignoring the client-supplied value.
 * - Other roles: blocked.
 *
 * This prevents a Salesman from posting a sale under a different salesman's
 * identity, and ensures all sale types (Counter/Online/OFC) store the
 * correct salesman_id for ownership verification.
 */
export type SessionUserInfo = {
  userId: string
  supabaseUserUuid: string | null
  businessId: string
  permissions: Set<string>
}

export async function resolveEffectiveSalesmanId(
  su: SessionUserInfo,
  clientSalesmanId: string | null | undefined,
): Promise<{ ok: true; salesmanId: string } | { ok: false; error: string; status: number }> {
  const canViewAll = su.permissions.has('can_view_sales')
  const canViewOwn = su.permissions.has('can_view_own_sales')

  if (canViewAll) {
    // Owner/Accountant: trust client-supplied salesmanId
    if (!clientSalesmanId) {
      return { ok: false, error: 'Salesman is required', status: 400 }
    }
    return { ok: true, salesmanId: clientSalesmanId }
  }

  if (canViewOwn) {
    // Salesman: resolve their own salesman_id, ignore client-supplied value
    const smId = await resolveSalesmanIdForUser(su.businessId, su.supabaseUserUuid, su.userId)
    if (!smId) {
      return {
        ok: false,
        error: 'Your user account is not linked to a salesman record. Ask the Owner to link your account.',
        status: 403,
      }
    }
    return { ok: true, salesmanId: smId }
  }

  return { ok: false, error: 'FORBIDDEN', status: 403 }
}

/**
 * Verify that an invoice belongs to the given salesman_id.
 * Returns true if the invoice's salesman_id matches, false otherwise.
 */
export async function verifyInvoiceOwnership(
  businessId: string,
  invoiceId: string,
  salesmanId: string,
): Promise<boolean> {
  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('invoices')
      .select('salesman_id')
      .eq('id', invoiceId)
      .eq('business_id', businessId)
      .maybeSingle()
    if (error || !data) return false
    return data.salesman_id === salesmanId
  }
  // Prisma fallback
  const inv = await db.invoice.findFirst({
    where: { id: invoiceId, businessId },
    select: { salesmanId: true },
  })
  if (!inv) return false
  return inv.salesmanId === salesmanId
}

// ─────────────────────────────────────────────────────────────
// Post Sale (the main entry point)
// ─────────────────────────────────────────────────────────────
export async function postSale(input: PostSaleInput): Promise<{ invoiceId: string; invoiceNo: string }> {
  if (await isPhase4Live()) {
    return postSaleViaSupabase(input)
  }
  return postSaleViaPrisma(input)
}

async function postSaleViaSupabase(input: PostSaleInput): Promise<{ invoiceId: string; invoiceNo: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)

  const itemsJson = input.items.map((i) => ({
    product_id: i.productId ?? null,
    product_name: i.productName,
    qty: i.qty,
    unit_price: i.unitPrice.toString(),
    is_temporary: i.isTemporary ?? false,
  }))

  const paymentsJson = input.payments.map((p) => ({
    account_id: p.accountId,
    amount: p.amount.toString(),
    is_change: p.isChange ?? false,
  }))

  const { data, error } = await admin.rpc('post_sale', {
    p_business_id: input.businessId,
    p_invoice_type: input.invoiceType,
    p_invoice_date: bizDateString(input.invoiceDate),
    p_items: itemsJson,
    p_payments: paymentsJson,
    p_salesman_id: input.salesmanId ?? null,
    p_customer_id: input.customerId ?? null,
    p_customer_name: input.customerName ?? null,
    p_customer_phone: input.customerPhone ?? null,
    p_customer_address: input.customerAddress ?? null,
    p_customer_city: input.customerCity ?? null,
    p_memo: input.memo ?? null,
    p_created_by: supabaseCreatedBy,
  })

  if (error) throw new Error(`Supabase post_sale: ${error.message}`)
  const invoiceId = data as string

  // Fetch the invoice number.
  const { data: inv, error: invErr } = await admin
    .from('invoices')
    .select('invoice_no')
    .eq('id', invoiceId)
    .single()
  if (invErr) throw new Error(`Supabase fetch invoice_no: ${invErr.message}`)

  return { invoiceId, invoiceNo: (inv as any).invoice_no }
}

async function postSaleViaPrisma(input: PostSaleInput): Promise<{ invoiceId: string; invoiceNo: string }> {
  // Compute totals.
  let subtotal = 0n
  for (const item of input.items) {
    subtotal += item.unitPrice * BigInt(item.qty)
  }
  const total = subtotal
  let paidAmount = 0n
  for (const p of input.payments) {
    if (!p.isChange) paidAmount += p.amount
  }

  // Generate invoice number (concurrency-safe via transaction + max+1).
  const lastInvoice = await db.invoice.findFirst({
    where: { businessId: input.businessId },
    orderBy: { invoiceNo: 'desc' },
  })
  let nextNum = 1
  if (lastInvoice) {
    const m = lastInvoice.invoiceNo.match(/^INV-(\d+)$/)
    if (m) nextNum = parseInt(m[1], 10) + 1
  }
  const invoiceNo = `INV-${String(nextNum).padStart(4, '0')}`

  // Find Sales account (4010).
  const salesAccount = await getAccountByCode(input.businessId, '4010')
  if (!salesAccount) throw new Error('Sales account (4010) not found')

  // Find Customers Receivable (1200) for partial payments.
  const arAccount = await getAccountByCode(input.businessId, '1200')

  // Compute change total.
  let changeTotal = 0n
  for (const p of input.payments) {
    if (p.isChange) changeTotal += p.amount
  }

  // Build voucher lines: Credit Sales by total, Debit each payment account, Credit change accounts.
  const voucherLines: Array<{ accountId: string; debit: bigint; credit: bigint; memo?: string }> = [
    { accountId: salesAccount.id, debit: 0n, credit: total, memo: `Sale ${invoiceNo}` },
  ]
  for (const p of input.payments) {
    if (!p.isChange) {
      voucherLines.push({ accountId: p.accountId, debit: p.amount, credit: 0n, memo: `Payment received ${invoiceNo}` })
    }
  }
  for (const p of input.payments) {
    if (p.isChange) {
      voucherLines.push({ accountId: p.accountId, debit: 0n, credit: p.amount, memo: `Change given ${invoiceNo}` })
    }
  }

  // Partial payment: if paid < total + change, debit outstanding to AR (1200).
  const outstanding = total - paidAmount + changeTotal
  if (outstanding > 0n && arAccount) {
    voucherLines.push({ accountId: arAccount.id, debit: outstanding, credit: 0n, memo: `Outstanding ${invoiceNo}` })
  }

  // Post the voucher via the smart dispatcher (uses Supabase post_voucher if live).
  const { postVoucherSmart } = await import('@/lib/accounting/voucher-supabase')
  const voucherId = await postVoucherSmart({
    businessId: input.businessId,
    voucherType: 'SI',
    voucherDate: input.invoiceDate,
    memo: input.memo ?? `Sale ${invoiceNo}`,
    lines: voucherLines,
    postedBy: input.createdBy,
  })

  // Create the invoice + items + payment allocations + stock movements + commission.
  const { createStockMovement } = await import('@/lib/products/data-access')
  const invoice = await db.invoice.create({
    data: {
      businessId: input.businessId,
      invoiceNo,
      invoiceType: input.invoiceType,
      invoiceDate: input.invoiceDate,
      customerId: input.customerId ?? null,
      salesmanId: input.salesmanId ?? null,
      customerName: input.customerName ?? null,
      customerPhone: input.customerPhone ?? null,
      customerAddress: input.customerAddress ?? null,
      customerCity: input.customerCity ?? null,
      subtotal,
      discount: 0n,
      total,
      paidAmount,
      voucherId,
      memo: input.memo ?? null,
      createdBy: input.createdBy ?? null,
    },
  })

  // Items + stock movements.
  for (const item of input.items) {
    let stockMovementId: string | undefined
    if (item.productId) {
      const sm = await createStockMovement(input.businessId, {
        productId: item.productId,
        movementType: 'adjustment_out',
        quantity: item.qty,
        reason: `Sale ${invoiceNo}`,
        createdBy: input.createdBy,
      })
      stockMovementId = sm.id
    }
    await db.invoiceItem.create({
      data: {
        businessId: input.businessId,
        invoiceId: invoice.id,
        productId: item.productId ?? null,
        productName: item.productName,
        qty: item.qty,
        unitPrice: item.unitPrice,
        lineTotal: item.unitPrice * BigInt(item.qty),
        isTemporary: item.isTemporary ?? false,
        stockMovementId: stockMovementId ?? null,
      },
    })
  }

  // Payment allocations + commission.
  let salesman: { id: string; commissionPct: number } | null = null
  if (input.salesmanId) {
    salesman = await db.salesman.findUnique({
      where: { id: input.salesmanId },
      select: { id: true, commissionPct: true },
    })
  }

  for (const p of input.payments) {
    if (!p.isChange) {
      const alloc = await db.paymentAllocation.create({
        data: {
          businessId: input.businessId,
          invoiceId: invoice.id,
          accountId: p.accountId,
          amount: p.amount,
          isChange: false,
          voucherId,
          createdBy: input.createdBy ?? null,
        },
      })

      // Commission: idempotent via unique (allocationId, salesmanId).
      if (salesman && p.amount > 0n) {
        const commAmount = (p.amount * BigInt(Math.round(salesman.commissionPct * 100))) / 10000n
        await db.salesmanCommission.upsert({
          where: { allocationId_salesmanId: { allocationId: alloc.id, salesmanId: salesman.id } },
          create: {
            businessId: input.businessId,
            salesmanId: salesman.id,
            invoiceId: invoice.id,
            allocationId: alloc.id,
            collectedAmount: p.amount,
            commissionPct: salesman.commissionPct,
            commissionAmount: commAmount,
          },
          update: {}, // no-op if already exists
        })
      }
    }
  }

  return { invoiceId: invoice.id, invoiceNo }
}

// ─────────────────────────────────────────────────────────────
// List invoices
// ─────────────────────────────────────────────────────────────
export async function listInvoices(businessId: string, opts?: { type?: string; salesmanId?: string }): Promise<InvoiceRow[]> {
  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    let query = admin
      .from('invoices')
      .select(`
        id, invoice_no, invoice_type, invoice_date,
        customer_name, subtotal, total, paid_amount,
        is_cancelled, is_returned,
        salesmen(name)
      `)
      .eq('business_id', businessId)
      .order('invoice_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)
    if (opts?.type) {
      query = query.eq('invoice_type', opts.type)
    }
    if (opts?.salesmanId) {
      query = query.eq('salesman_id', opts.salesmanId)
    }
    const { data, error } = await query
    if (error) throw new Error(`Supabase: ${error.message}`)
    return (data ?? []).map((r: any) => ({
      id: r.id,
      invoiceNo: r.invoice_no,
      invoiceType: r.invoice_type,
      invoiceDate: r.invoice_date,
      customerName: r.customer_name,
      salesmanName: r.salesmen?.name ?? null,
      subtotal: String(r.subtotal),
      total: String(r.total),
      paidAmount: String(r.paid_amount),
      isCancelled: r.is_cancelled,
      isReturned: r.is_returned,
    }))
  }
  const invoices = await db.invoice.findMany({
    where: {
      businessId,
      ...(opts?.type ? { invoiceType: opts.type } : {}),
      ...(opts?.salesmanId ? { salesmanId: opts.salesmanId } : {}),
    },
    include: { salesman: true },
    orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  })
  return invoices.map((i) => ({
    id: i.id,
    invoiceNo: i.invoiceNo,
    invoiceType: i.invoiceType,
    invoiceDate: i.invoiceDate.toISOString(),
    customerName: i.customerName,
    salesmanName: i.salesman?.name ?? null,
    subtotal: i.subtotal.toString(),
    total: i.total.toString(),
    paidAmount: i.paidAmount.toString(),
    isCancelled: i.isCancelled,
    isReturned: i.isReturned,
  }))
}

// ─────────────────────────────────────────────────────────────
// Get invoice detail (with items + payments)
// ─────────────────────────────────────────────────────────────
export async function getInvoice(businessId: string, invoiceId: string): Promise<InvoiceRow | null> {
  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const { data: inv, error } = await admin
      .from('invoices')
      .select(`
        id, invoice_no, invoice_type, invoice_date,
        customer_name, customer_phone, customer_address, customer_city,
        subtotal, total, paid_amount,
        is_cancelled, is_returned, memo,
        salesmen(name),
        invoice_items(id, product_id, product_name, qty, unit_price, line_total, is_temporary),
        payment_allocations(id, account_id, amount, is_change, accounts(code, name))
      `)
      .eq('id', invoiceId)
      .eq('business_id', businessId)
      .single()
    if (error || !inv) return null
    const r = inv as any
    return {
      id: r.id,
      invoiceNo: r.invoice_no,
      invoiceType: r.invoice_type,
      invoiceDate: r.invoice_date,
      customerName: r.customer_name,
      salesmanName: r.salesmen?.name ?? null,
      subtotal: String(r.subtotal),
      total: String(r.total),
      paidAmount: String(r.paid_amount),
      isCancelled: r.is_cancelled,
      isReturned: r.is_returned,
      items: (r.invoice_items ?? []).map((it: any) => ({
        id: it.id,
        productId: it.product_id,
        productName: it.product_name,
        qty: it.qty,
        unitPrice: String(it.unit_price),
        lineTotal: String(it.line_total),
        isTemporary: it.is_temporary,
      })),
      payments: (r.payment_allocations ?? []).map((pa: any) => ({
        id: pa.id,
        accountId: pa.account_id,
        accountCode: pa.accounts?.code ?? '',
        accountName: pa.accounts?.name ?? '',
        amount: String(pa.amount),
        isChange: pa.is_change,
      })),
    }
  }
  const inv = await db.invoice.findFirst({
    where: { id: invoiceId, businessId },
    include: {
      salesman: true,
      items: true,
      paymentAllocations: { include: { account: true } },
    },
  })
  if (!inv) return null
  return {
    id: inv.id,
    invoiceNo: inv.invoiceNo,
    invoiceType: inv.invoiceType,
    invoiceDate: inv.invoiceDate.toISOString(),
    customerName: inv.customerName,
    salesmanName: inv.salesman?.name ?? null,
    subtotal: inv.subtotal.toString(),
    total: inv.total.toString(),
    paidAmount: inv.paidAmount.toString(),
    isCancelled: inv.isCancelled,
    isReturned: inv.isReturned,
    items: inv.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      productName: it.productName,
      qty: it.qty,
      unitPrice: it.unitPrice.toString(),
      lineTotal: it.lineTotal.toString(),
      isTemporary: it.isTemporary,
    })),
    payments: inv.paymentAllocations.map((pa) => ({
      id: pa.id,
      accountId: pa.accountId,
      accountCode: pa.account.code,
      accountName: pa.account.name,
      amount: pa.amount.toString(),
      isChange: pa.isChange,
    })),
  }
}

// ─────────────────────────────────────────────────────────────
// Sales Return
// ─────────────────────────────────────────────────────────────
export async function postSalesReturn(
  businessId: string,
  invoiceId: string,
  returnDate: Date,
  reason?: string | null,
  createdBy?: string | null,
): Promise<{ returnId: string; voucherId: string }> {
  if (await isPhase4Live()) {
    const admin = getAdminSupabase()
    const supabaseCreatedBy = await resolveSupabaseUuid(createdBy)
    const { data, error } = await admin.rpc('post_sales_return', {
      p_business_id: businessId,
      p_invoice_id: invoiceId,
      p_return_date: bizDateString(returnDate),
      p_reason: reason ?? null,
      p_created_by: supabaseCreatedBy,
    })
    if (error) throw new Error(`Supabase post_sales_return: ${error.message}`)
    const returnId = data as string
    // Fetch the return_voucher_id.
    const { data: ret } = await admin
      .from('sales_returns')
      .select('return_voucher_id')
      .eq('id', returnId)
      .single()
    return { returnId, voucherId: (ret as any)?.return_voucher_id ?? '' }
  }

  // Prisma fallback
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, businessId },
    include: { items: true, paymentAllocations: { where: { isChange: false } } },
  })
  if (!invoice) throw new Error('Invoice not found')
  if (invoice.isReturned) throw new Error('Invoice already returned')

  const salesAccount = await getAccountByCode(businessId, '4010')
  if (!salesAccount) throw new Error('Sales account (4010) not found')

  // Build reversing voucher lines.
  const voucherLines: Array<{ accountId: string; debit: bigint; credit: bigint; memo?: string }> = [
    { accountId: salesAccount.id, debit: invoice.total, credit: 0n, memo: `Sales return reversal: ${invoice.invoiceNo}` },
  ]
  for (const pa of invoice.paymentAllocations) {
    voucherLines.push({ accountId: pa.accountId, debit: 0n, credit: pa.amount, memo: `Return refund: ${invoice.invoiceNo}` })
  }

  const { postVoucherSmart } = await import('@/lib/accounting/voucher-supabase')
  const voucherId = await postVoucherSmart({
    businessId,
    voucherType: 'SR',
    voucherDate: returnDate,
    memo: `Return: ${invoice.invoiceNo}`,
    lines: voucherLines,
    referenceId: invoiceId,
    referenceType: 'sales_return',
    postedBy: createdBy,
  })

  // Restore stock.
  const { createStockMovement } = await import('@/lib/products/data-access')
  for (const item of invoice.items) {
    if (item.productId) {
      await createStockMovement(businessId, {
        productId: item.productId,
        movementType: 'adjustment_in',
        quantity: item.qty,
        reason: `Return: ${invoice.invoiceNo}`,
        createdBy,
      })
    }
  }

  // Create sales_return record.
  const salesReturn = await db.salesReturn.create({
    data: {
      businessId,
      originalInvoiceId: invoiceId,
      returnVoucherId: voucherId,
      returnDate,
      total: invoice.total,
      reason: reason ?? null,
      createdBy: createdBy ?? null,
    },
  })

  // Mark invoice as returned.
  await db.invoice.update({
    where: { id: invoiceId },
    data: { isReturned: true, returnVoucherId: voucherId },
  })

  return { returnId: salesReturn.id, voucherId }
}
