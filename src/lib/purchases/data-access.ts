/**
 * Phase 5 Purchases data-access — dual-path Supabase/Prisma.
 * All money is BigInt paisas. UI sends paisas as strings.
 */
import 'server-only'
import { db } from '@/lib/db'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { bizDateString } from '@/lib/dates'
import { getAccountByCode } from '@/lib/accounting/data-access'
import { resolveSupabaseUuid } from '@/lib/accounting/voucher-supabase'
import { writeAudit } from '@/lib/auth/permissions'

let _p5Checked = false
let _p5Live = false

async function isPhase5Live(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !svc || url.includes('<') || svc.includes('<')) return false
  if (_p5Checked) return _p5Live
  _p5Checked = true
  try {
    const admin = getAdminSupabase()
    const { data, error } = await admin.from('vendors').select('id').limit(1)
    _p5Live = !error && Array.isArray(data)
  } catch { _p5Live = false }
  return _p5Live
}

// Types
export type VendorRow = { id: string; name: string; phone: string | null; email: string | null; address: string | null; city: string | null; isActive: boolean; accountId: string }

export type PurchaseRow = {
  id: string; purchaseNo: string; vendorId: string; vendorName: string | null
  vendorPhone: string | null; vendorAddress: string | null; vendorCity: string | null
  supplierBillNo: string | null; purchaseDate: string; subtotal: string; discount: string
  additionalCharges: string; total: string; paidAmount: string; outstandingAmount: string
  status: string; notes: string | null; voucherId: string | null
  items?: PurchaseItemRow[]; payments?: PurchasePaymentRow[]
}

export type PurchaseItemRow = { id: string; productId: string | null; productName: string; quantity: number; unitCost: string; lineTotal: string; returnedQuantity: number }
export type PurchasePaymentRow = { id: string; accountId: string; amount: string; paymentType: string; paymentDate: string; notes: string | null }

// ─── Vendors ───
export async function listVendors(businessId: string): Promise<VendorRow[]> {
  if (await isPhase5Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin.from('vendors').select('id, name, phone, email, address, city, is_active, account_id').eq('business_id', businessId).order('name')
    if (error) throw new Error(`Supabase: ${error.message}`)
    return (data ?? []).map((v: any) => ({ id: v.id, name: v.name, phone: v.phone, email: v.email, address: v.address, city: v.city, isActive: v.is_active, accountId: v.account_id }))
  }
  const vendors = await db.vendor.findMany({ where: { businessId }, orderBy: { name: 'asc' } })
  return vendors.map(v => ({ id: v.id, name: v.name, phone: v.phone, email: v.email, address: v.address, city: v.city, isActive: v.isActive, accountId: v.accountId }))
}

export async function createVendor(businessId: string, name: string, phone?: string, email?: string, address?: string, city?: string): Promise<VendorRow> {
  if (await isPhase5Live()) {
    const admin = getAdminSupabase()
    // Find Vendors Payable account (2010) — we link vendor sub-accounts under Liability
    const { data: payableAcct } = await admin.from('accounts').select('id, category_id').eq('business_id', businessId).eq('code', '2010').single()
    if (!payableAcct) throw new Error('Vendors Payable account (2010) not found')
    // Create a sub-account for this vendor under the same category
    const { data: acct, error: acctErr } = await admin.from('accounts').insert({
      business_id: businessId, code: 'VEND-' + Date.now().toString(36).toUpperCase(), name: `Vendor: ${name}`,
      category_id: payableAcct.category_id, is_active: true, is_party_account: true, party_type: 'vendor', balance_cache: 0
    }).select('id').single()
    if (acctErr) throw new Error(`Create vendor account: ${acctErr.message}`)
    const { data: v, error: vErr } = await admin.from('vendors').insert({
      business_id: businessId, account_id: acct.id, name, phone: phone ?? null, email: email ?? null, address: address ?? null, city: city ?? null, is_active: true
    }).select('id, name, phone, email, address, city, is_active, account_id').single()
    if (vErr) throw new Error(`Create vendor: ${vErr.message}`)
    return { id: v.id, name: v.name, phone: v.phone, email: v.email, address: v.address, city: v.city, isActive: v.is_active, accountId: v.account_id }
  }
  // Prisma fallback
  const payableAcct = await getAccountByCode(businessId, '2010')
  if (!payableAcct) throw new Error('Vendors Payable account (2010) not found')
  const assetCat = await db.accountCategory.findFirst({ where: { businessId, code: 'LIABILITY' } })
  if (!assetCat) throw new Error('Liability category not found')
  const acct = await db.account.create({ data: { businessId, code: 'VEND-' + Date.now().toString(36), name: `Vendor: ${name}`, categoryId: assetCat.id, isPartyAccount: true, partyType: 'vendor', balanceCache: 0n } })
  const v = await db.vendor.create({ data: { businessId, accountId: acct.id, name, phone: phone ?? null, email: email ?? null, address: address ?? null, city: city ?? null } })
  return { id: v.id, name: v.name, phone: v.phone, email: v.email, address: v.address, city: v.city, isActive: v.isActive, accountId: v.accountId }
}

// ─── Post Purchase ───
export async function postPurchase(input: {
  businessId: string; vendorId: string; purchaseDate: Date; supplierBillNo?: string | null
  items: Array<{ productId?: string | null; productName: string; quantity: number; unitCostPaisas: bigint }>
  payments: Array<{ accountId: string; amountPaisas: bigint; paymentType?: string }>
  discountPaisas?: bigint; additionalChargesPaisas?: bigint; notes?: string | null
  createdBy?: string | null
}): Promise<{ purchaseId: string; purchaseNo: string }> {
  if (await isPhase5Live()) { return postPurchaseViaSupabase(input) }
  return postPurchaseViaPrisma(input)
}

async function postPurchaseViaSupabase(input: typeof postPurchase extends (x: infer T) => any ? T : never): Promise<{ purchaseId: string; purchaseNo: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
  const itemsJson = input.items.map(i => ({ product_id: i.productId ?? null, product_name: i.productName, quantity: i.quantity, unit_cost_paisas: i.unitCostPaisas.toString() }))
  const paymentsJson = input.payments.map(p => ({ account_id: p.accountId, amount_paisas: p.amountPaisas.toString(), payment_type: p.paymentType ?? 'purchase_payment' }))
  const { data, error } = await admin.rpc('post_purchase', {
    p_business_id: input.businessId, p_vendor_id: input.vendorId, p_purchase_date: bizDateString(input.purchaseDate),
    p_supplier_bill_no: input.supplierBillNo ?? null, p_items: itemsJson, p_payments: paymentsJson,
    p_discount_paisas: (input.discountPaisas ?? 0n).toString(), p_additional_charges_paisas: (input.additionalChargesPaisas ?? 0n).toString(),
    p_notes: input.notes ?? null, p_created_by: supabaseCreatedBy,
  })
  if (error) throw new Error(`Supabase post_purchase: ${error.message}`)
  const purchaseId = data as string
  const { data: inv } = await admin.from('purchases').select('purchase_no').eq('id', purchaseId).single()
  return { purchaseId, purchaseNo: (inv as any)?.purchase_no ?? '' }
}

async function postPurchaseViaPrisma(input: typeof postPurchase extends (x: infer T) => any ? T: never): Promise<{ purchaseId: string; purchaseNo: string }> {
  // Simplified Prisma fallback — generates purchase number, posts voucher via smart dispatcher
  const subtotal = input.items.reduce((s, i) => s + i.unitCostPaisas * BigInt(i.quantity), 0n)
  const discount = input.discountPaisas ?? 0n
  const additional = input.additionalChargesPaisas ?? 0n
  const total = subtotal - discount + additional
  const paid = input.payments.filter(p => p.paymentType !== 'credit').reduce((s, p) => s + p.amountPaisas, 0n)
  const outstanding = total - paid

  // Generate purchase number
  const last = await db.purchase.findFirst({ where: { businessId: input.businessId }, orderBy: { purchaseNo: 'desc' } })
  let nextNum = 1; if (last) { const m = last.purchaseNo.match(/^PUR-(\d+)$/); if (m) nextNum = parseInt(m[1], 10) + 1 }
  const purchaseNo = `PUR-${String(nextNum).padStart(4, '0')}`

  // Resolve accounts
  const purchasesAcct = await getAccountByCode(input.businessId, '5010')
  if (!purchasesAcct) throw new Error('Purchases account (5010) not found')
  const payableAcct = await getAccountByCode(input.businessId, '2010')
  if (!payableAcct) throw new Error('Vendors Payable account (2010) not found')

  // Build voucher lines
  const lines: Array<{ accountId: string; debit: bigint; credit: bigint; memo?: string }> = [
    { accountId: purchasesAcct.id, debit: total, credit: 0n, memo: `Purchase ${purchaseNo}` }
  ]
  for (const p of input.payments) {
    if (p.paymentType !== 'credit') { lines.push({ accountId: p.accountId, debit: 0n, credit: p.amountPaisas, memo: `Payment ${purchaseNo}` }) }
  }
  if (outstanding > 0n) { lines.push({ accountId: payableAcct.id, debit: 0n, credit: outstanding, memo: `Payable ${purchaseNo}` }) }

  // Post voucher
  const { postVoucherSmart } = await import('@/lib/accounting/voucher-supabase')
  const voucherId = await postVoucherSmart({ businessId: input.businessId, voucherType: 'PU', voucherDate: input.purchaseDate, memo: `Purchase ${purchaseNo}`, lines, postedBy: input.createdBy })

  // Create purchase
  const purchase = await db.purchase.create({ data: { businessId: input.businessId, purchaseNo, vendorId: input.vendorId, supplierBillNo: input.supplierBillNo ?? null, purchaseDate: input.purchaseDate, subtotal, discount, additionalCharges: additional, total, paidAmount: paid, outstandingAmount: outstanding, status: outstanding <= 0n ? 'paid' : paid > 0n ? 'partially_paid' : 'posted', notes: input.notes ?? null, voucherId, createdBy: input.createdBy ?? null } })

  // Items + stock-in
  const { createStockMovement } = await import('@/lib/products/data-access')
  for (const item of input.items) {
    let smId: string | undefined
    if (item.productId) { const sm = await createStockMovement(input.businessId, { productId: item.productId, movementType: 'adjustment_in', quantity: item.quantity, reason: `Purchase ${purchaseNo}`, createdBy: input.createdBy }); smId = sm.id }
    await db.purchaseItem.create({ data: { businessId: input.businessId, purchaseId: purchase.id, productId: item.productId ?? null, productName: item.productName, quantity: item.quantity, unitCost: item.unitCostPaisas, lineTotal: item.unitCostPaisas * BigInt(item.quantity), stockMovementId: smId ?? null } })
  }
  // Payment records
  for (const p of input.payments) {
    if (p.paymentType !== 'credit') { await db.purchasePayment.create({ data: { businessId: input.businessId, purchaseId: purchase.id, vendorId: input.vendorId, accountId: p.accountId, amount: p.amountPaisas, paymentType: p.paymentType ?? 'purchase_payment', voucherId, createdBy: input.createdBy ?? null } }) }
  }
  return { purchaseId: purchase.id, purchaseNo }
}

// ─── List Purchases ───
export async function listPurchases(businessId: string): Promise<PurchaseRow[]> {
  if (await isPhase5Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin.from('purchases').select('id, purchase_no, vendor_id, supplier_bill_no, purchase_date, subtotal, discount, additional_charges, total, paid_amount, outstanding_amount, status, notes, voucher_id, vendors(name, phone, address, city)').eq('business_id', businessId).order('purchase_date', { ascending: false }).limit(100)
    if (error) throw new Error(`Supabase: ${error.message}`)
    return (data ?? []).map((r: any) => ({ id: r.id, purchaseNo: r.purchase_no, vendorId: r.vendor_id, vendorName: r.vendors?.name ?? null, vendorPhone: r.vendors?.phone ?? null, vendorAddress: r.vendors?.address ?? null, vendorCity: r.vendors?.city ?? null, supplierBillNo: r.supplier_bill_no, purchaseDate: r.purchase_date, subtotal: String(r.subtotal), discount: String(r.discount), additionalCharges: String(r.additional_charges), total: String(r.total), paidAmount: String(r.paid_amount), outstandingAmount: String(r.outstanding_amount), status: r.status, notes: r.notes, voucherId: r.voucher_id }))
  }
  const purchases = await db.purchase.findMany({ where: { businessId }, include: { vendor: true }, orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }], take: 100 })
  return purchases.map(p => ({ id: p.id, purchaseNo: p.purchaseNo, vendorId: p.vendorId, vendorName: p.vendor?.name ?? null, vendorPhone: p.vendor?.phone ?? null, vendorAddress: p.vendor?.address ?? null, vendorCity: p.vendor?.city ?? null, supplierBillNo: p.supplierBillNo, purchaseDate: p.purchaseDate.toISOString(), subtotal: p.subtotal.toString(), discount: p.discount.toString(), additionalCharges: p.additionalCharges.toString(), total: p.total.toString(), paidAmount: p.paidAmount.toString(), outstandingAmount: p.outstandingAmount.toString(), status: p.status, notes: p.notes, voucherId: p.voucherId }))
}

// ─── Get Purchase Detail ───
export async function getPurchase(businessId: string, purchaseId: string): Promise<PurchaseRow | null> {
  if (await isPhase5Live()) {
    const admin = getAdminSupabase()
    const { data: inv, error } = await admin.from('purchases').select('id, purchase_no, vendor_id, supplier_bill_no, purchase_date, subtotal, discount, additional_charges, total, paid_amount, outstanding_amount, status, notes, voucher_id, vendors(name, phone, address, city), purchase_items(id, product_id, product_name, quantity, unit_cost, line_total, returned_quantity), purchase_payments(id, account_id, amount, payment_type, payment_date, notes)').eq('id', purchaseId).eq('business_id', businessId).single()
    if (error || !inv) return null
    const r = inv as any
    return { id: r.id, purchaseNo: r.purchase_no, vendorId: r.vendor_id, vendorName: r.vendors?.name ?? null, vendorPhone: r.vendors?.phone ?? null, vendorAddress: r.vendors?.address ?? null, vendorCity: r.vendors?.city ?? null, supplierBillNo: r.supplier_bill_no, purchaseDate: r.purchase_date, subtotal: String(r.subtotal), discount: String(r.discount), additionalCharges: String(r.additional_charges), total: String(r.total), paidAmount: String(r.paid_amount), outstandingAmount: String(r.outstanding_amount), status: r.status, notes: r.notes, voucherId: r.voucher_id,
      items: (r.purchase_items ?? []).map((it: any) => ({ id: it.id, productId: it.product_id, productName: it.product_name, quantity: it.quantity, unitCost: String(it.unit_cost), lineTotal: String(it.line_total), returnedQuantity: it.returned_quantity })),
      payments: (r.purchase_payments ?? []).map((pp: any) => ({ id: pp.id, accountId: pp.account_id, amount: String(pp.amount), paymentType: pp.payment_type, paymentDate: pp.payment_date, notes: pp.notes }))
    }
  }
  const p = await db.purchase.findFirst({ where: { id: purchaseId, businessId }, include: { vendor: true, items: true, payments: true } })
  if (!p) return null
  return { id: p.id, purchaseNo: p.purchaseNo, vendorId: p.vendorId, vendorName: p.vendor?.name ?? null, vendorPhone: p.vendor?.phone ?? null, vendorAddress: p.vendor?.address ?? null, vendorCity: p.vendor?.city ?? null, supplierBillNo: p.supplierBillNo, purchaseDate: p.purchaseDate.toISOString(), subtotal: p.subtotal.toString(), discount: p.discount.toString(), additionalCharges: p.additionalCharges.toString(), total: p.total.toString(), paidAmount: p.paidAmount.toString(), outstandingAmount: p.outstandingAmount.toString(), status: p.status, notes: p.notes, voucherId: p.voucherId,
    items: p.items.map(it => ({ id: it.id, productId: it.productId, productName: it.productName, quantity: it.quantity, unitCost: it.unitCost.toString(), lineTotal: it.lineTotal.toString(), returnedQuantity: it.returnedQuantity })),
    payments: p.payments.map(pp => ({ id: pp.id, accountId: pp.accountId, amount: pp.amount.toString(), paymentType: pp.paymentType, paymentDate: pp.paymentDate.toISOString(), notes: pp.notes }))
  }
}

// ─── Vendor Payment (later) ───
export async function postVendorPayment(input: { businessId: string; vendorId: string; accountId: string; amountPaisas: bigint; paymentDate?: Date; purchaseId?: string | null; notes?: string | null; createdBy?: string | null }): Promise<string> {
  if (await isPhase5Live()) {
    const admin = getAdminSupabase()
    const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
    const { data, error } = await admin.rpc('post_vendor_payment', {
      p_business_id: input.businessId, p_vendor_id: input.vendorId, p_account_id: input.accountId,
      p_amount_paisas: input.amountPaisas.toString(), p_payment_date: input.paymentDate ? bizDateString(input.paymentDate) : null,
      p_purchase_id: input.purchaseId ?? null, p_notes: input.notes ?? null, p_created_by: supabaseCreatedBy,
    })
    if (error) throw new Error(`Supabase: ${error.message}`)
    return data as string
  }
  // Prisma fallback — simplified
  const payableAcct = await getAccountByCode(input.businessId, '2010')
  if (!payableAcct) throw new Error('Vendors Payable account (2010) not found')
  const { postVoucherSmart } = await import('@/lib/accounting/voucher-supabase')
  const voucherId = await postVoucherSmart({ businessId: input.businessId, voucherType: 'PM', voucherDate: input.paymentDate ?? new Date(), memo: 'Vendor payment', lines: [{ accountId: payableAcct.id, debit: input.amountPaisas, credit: 0n }, { accountId: input.accountId, debit: 0n, credit: input.amountPaisas }], postedBy: input.createdBy })
  const pp = await db.purchasePayment.create({ data: { businessId: input.businessId, purchaseId: input.purchaseId ?? null, vendorId: input.vendorId, accountId: input.accountId, amount: input.amountPaisas, paymentType: 'later_payment', voucherId, notes: input.notes ?? null, createdBy: input.createdBy ?? null } })
  if (input.purchaseId) { await db.purchase.update({ where: { id: input.purchaseId }, data: { paidAmount: { increment: input.amountPaisas }, outstandingAmount: { decrement: input.amountPaisas } } }) }
  return pp.id
}

// ─── Vendor Advance ───
export async function postVendorAdvance(input: { businessId: string; vendorId: string; accountId: string; amountPaisas: bigint; advanceDate?: Date; notes?: string | null; createdBy?: string | null }): Promise<string> {
  if (await isPhase5Live()) {
    const admin = getAdminSupabase()
    const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
    const { data, error } = await admin.rpc('post_vendor_advance', {
      p_business_id: input.businessId, p_vendor_id: input.vendorId, p_account_id: input.accountId,
      p_amount_paisas: input.amountPaisas.toString(), p_advance_date: input.advanceDate ? bizDateString(input.advanceDate) : null,
      p_notes: input.notes ?? null, p_created_by: supabaseCreatedBy,
    })
    if (error) throw new Error(`Supabase: ${error.message}`)
    return data as string
  }
  // Prisma fallback
  const payableAcct = await getAccountByCode(input.businessId, '2010')
  if (!payableAcct) throw new Error('Vendors Payable account (2010) not found')
  const { postVoucherSmart } = await import('@/lib/accounting/voucher-supabase')
  const voucherId = await postVoucherSmart({ businessId: input.businessId, voucherType: 'PM', voucherDate: input.advanceDate ?? new Date(), memo: 'Vendor advance', lines: [{ accountId: payableAcct.id, debit: input.amountPaisas, credit: 0n }, { accountId: input.accountId, debit: 0n, credit: input.amountPaisas }], postedBy: input.createdBy })
  const pp = await db.purchasePayment.create({ data: { businessId: input.businessId, purchaseId: null, vendorId: input.vendorId, accountId: input.accountId, amount: input.amountPaisas, paymentType: 'vendor_advance', voucherId, notes: input.notes ?? null, createdBy: input.createdBy ?? null } })
  return pp.id
}

// ─── Purchase Return ───
export async function postPurchaseReturn(input: {
  businessId: string; purchaseId: string
  returnItems: Array<{ purchaseItemId: string; productId?: string | null; productName: string; quantity: number; unitCostPaisas: bigint }>
  settlementType: string; settlementAccountId?: string | null; returnDate?: Date; notes?: string | null; createdBy?: string | null
}): Promise<{ returnId: string; returnNo: string }> {
  if (await isPhase5Live()) {
    const admin = getAdminSupabase()
    const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
    const itemsJson = input.returnItems.map(i => ({ purchase_item_id: i.purchaseItemId, product_id: i.productId ?? null, product_name: i.productName, quantity: i.quantity, unit_cost_paisas: i.unitCostPaisas.toString() }))
    const { data, error } = await admin.rpc('post_purchase_return', {
      p_business_id: input.businessId, p_purchase_id: input.purchaseId, p_return_items: itemsJson,
      p_settlement_type: input.settlementType, p_settlement_account_id: input.settlementAccountId ?? null,
      p_return_date: input.returnDate ? bizDateString(input.returnDate) : null, p_notes: input.notes ?? null, p_created_by: supabaseCreatedBy,
    })
    if (error) throw new Error(`Supabase: ${error.message}`)
    const returnId = data as string
    const { data: ret } = await admin.from('purchase_returns').select('return_no').eq('id', returnId).single()
    return { returnId, returnNo: (ret as any)?.return_no ?? '' }
  }
  // Prisma fallback — simplified
  const purchasesAcct = await getAccountByCode(input.businessId, '5010')
  if (!purchasesAcct) throw new Error('Purchases account (5010) not found')
  const payableAcct = await getAccountByCode(input.businessId, '2010')
  if (!payableAcct) throw new Error('Vendors Payable account (2010) not found')
  const total = input.returnItems.reduce((s, i) => s + i.unitCostPaisas * BigInt(i.quantity), 0n)
  const last = await db.purchaseReturn.findFirst({ where: { businessId: input.businessId }, orderBy: { returnNo: 'desc' } })
  let nextNum = 1; if (last) { const m = last.returnNo.match(/^PRN-(\d+)$/); if (m) nextNum = parseInt(m[1], 10) + 1 }
  const returnNo = `PRN-${String(nextNum).padStart(4, '0')}`
  const lines: Array<{ accountId: string; debit: bigint; credit: bigint }> = [{ accountId: purchasesAcct.id, debit: 0n, credit: total }]
  if (input.settlementType === 'vendor_refund' && input.settlementAccountId) { lines.push({ accountId: input.settlementAccountId, debit: total, credit: 0n }) }
  else { lines.push({ accountId: payableAcct.id, debit: total, credit: 0n }) }
  const { postVoucherSmart } = await import('@/lib/accounting/voucher-supabase')
  const voucherId = await postVoucherSmart({ businessId: input.businessId, voucherType: 'PR', voucherDate: input.returnDate ?? new Date(), memo: `Purchase return ${returnNo}`, lines, referenceId: input.purchaseId, referenceType: 'purchase_return', postedBy: input.createdBy })
  const purchase = await db.purchase.findFirst({ where: { id: input.purchaseId, businessId: input.businessId } })
  if (!purchase) throw new Error('Purchase not found')
  const ret = await db.purchaseReturn.create({ data: { businessId: input.businessId, purchaseId: input.purchaseId, vendorId: purchase.vendorId, returnNo, returnDate: input.returnDate ?? new Date(), totalAmount: total, settlementType: input.settlementType, settlementAccountId: input.settlementAccountId ?? null, voucherId, notes: input.notes ?? null, createdBy: input.createdBy ?? null } })
  const { createStockMovement } = await import('@/lib/products/data-access')
  for (const item of input.returnItems) {
    let smId: string | undefined
    if (item.productId) { const sm = await createStockMovement(input.businessId, { productId: item.productId, movementType: 'adjustment_out', quantity: item.quantity, reason: `Return ${returnNo}`, createdBy: input.createdBy }); smId = sm.id }
    await db.purchaseReturnItem.create({ data: { businessId: input.businessId, purchaseReturnId: ret.id, purchaseItemId: item.purchaseItemId, productId: item.productId ?? null, productName: item.productName, quantity: item.quantity, unitCost: item.unitCostPaisas, lineTotal: item.unitCostPaisas * BigInt(item.quantity), stockMovementId: smId ?? null } })
    await db.purchaseItem.update({ where: { id: item.purchaseItemId }, data: { returnedQuantity: { increment: item.quantity } } })
  }
  return { returnId: ret.id, returnNo }
}

// ─── Vendor Ledger (proper — uses vendor_ledger() RPC from migration 00005a) ───
export type VendorLedgerRow = {
  date: string; type: string; reference: string; description: string
  debit: string; credit: string; runningBalance: string
  voucherId: string; referenceId: string | null; referenceType: string | null
}

export async function vendorLedger(
  businessId: string,
  vendorId: string,
  filters?: { fromDate?: string | null; toDate?: string | null; typeFilter?: string | null; search?: string | null },
): Promise<VendorLedgerRow[]> {
  if (await isPhase5Live()) {
    return vendorLedgerViaSupabase(businessId, vendorId, filters)
  }
  return []
}

async function vendorLedgerViaSupabase(
  businessId: string,
  vendorId: string,
  filters?: { fromDate?: string | null; toDate?: string | null; typeFilter?: string | null; search?: string | null },
): Promise<VendorLedgerRow[]> {
  const admin = getAdminSupabase()

  // Call the vendor_ledger() RPC from migration 00005a.
  // It returns table with: line_date, line_type, reference, description,
  //   debit, credit, running_balance, voucher_id, reference_id, reference_type
  const { data, error } = await admin.rpc('vendor_ledger', {
    p_business_id: businessId,
    p_vendor_id: vendorId,
    p_from_date: filters?.fromDate ?? null,
    p_to_date: filters?.toDate ?? null,
  })
  if (error) throw new Error(`vendor_ledger RPC: ${error.message}`)
  if (!data || !Array.isArray(data)) return []

  let rows: VendorLedgerRow[] = (data as any[]).map((r) => ({
    date: r.line_date,
    type: r.line_type,
    reference: r.reference ?? '',
    description: r.description ?? '',
    debit: String(r.debit ?? '0'),
    credit: String(r.credit ?? '0'),
    runningBalance: String(r.running_balance ?? '0'),
    voucherId: r.voucher_id ?? '',
    referenceId: r.reference_id ?? null,
    referenceType: r.reference_type ?? null,
  }))

  // Apply client-side type filter (RPC only supports date range)
  if (filters?.typeFilter && filters.typeFilter !== 'all') {
    const typeMap: Record<string, string[]> = {
      purchase: ['Purchase'],
      payment: ['Vendor Payment'],
      advance: ['Vendor Advance'],
      advance_application: ['Advance Application'],
      return: ['Purchase Return'],
      replacement: ['Replacement'],
      refund: ['Vendor Refund'],
    }
    const allowed = typeMap[filters.typeFilter] ?? []
    rows = rows.filter(r => allowed.includes(r.type))
  }

  // Apply client-side reference search
  if (filters?.search) {
    const q = filters.search.toLowerCase()
    rows = rows.filter(r => r.reference.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.type.toLowerCase().includes(q))
  }

  return rows
}

// ─── Update Vendor (edit) ───
export async function updateVendor(
  businessId: string,
  vendorId: string,
  updates: { name?: string; phone?: string | null; email?: string | null; address?: string | null; city?: string | null; isActive?: boolean },
): Promise<VendorRow | null> {
  if (await isPhase5Live()) {
    const admin = getAdminSupabase()
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (updates.name !== undefined) patch.name = updates.name
    if (updates.phone !== undefined) patch.phone = updates.phone
    if (updates.email !== undefined) patch.email = updates.email
    if (updates.address !== undefined) patch.address = updates.address
    if (updates.city !== undefined) patch.city = updates.city
    if (updates.isActive !== undefined) patch.is_active = updates.isActive
    const { data, error } = await admin.from('vendors')
      .update(patch).eq('id', vendorId).eq('business_id', businessId)
      .select('id, name, phone, email, address, city, is_active, account_id').single()
    if (error) throw new Error(`Supabase: ${error.message}`)
    return { id: data.id, name: data.name, phone: data.phone, email: data.email, address: data.address, city: data.city, isActive: data.is_active, accountId: data.account_id }
  }
  const v = await db.vendor.update({ where: { id: vendorId }, data: { name: updates.name, phone: updates.phone ?? undefined, email: updates.email ?? undefined, address: updates.address ?? undefined, city: updates.city ?? undefined, isActive: updates.isActive } })
  return { id: v.id, name: v.name, phone: v.phone, email: v.email, address: v.address, city: v.city, isActive: v.isActive, accountId: v.accountId }
}

// ─── Advance Application (uses post_advance_application() RPC from migration 00005a) ───
export async function postAdvanceApplication(input: {
  businessId: string; vendorId: string; purchaseId: string
  amountPaisas: bigint; applicationDate?: Date; notes?: string | null; createdBy?: string | null
}): Promise<string> {
  if (await isPhase5Live()) {
    const admin = getAdminSupabase()
    const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
    const { data, error } = await admin.rpc('post_advance_application', {
      p_business_id: input.businessId,
      p_vendor_id: input.vendorId,
      p_purchase_id: input.purchaseId,
      p_amount_paisas: input.amountPaisas.toString(),
      p_application_date: input.applicationDate ? bizDateString(input.applicationDate) : null,
      p_notes: input.notes ?? null,
      p_created_by: supabaseCreatedBy,
    })
    if (error) throw new Error(`post_advance_application RPC: ${error.message}`)
    return data as string
  }
  // Prisma fallback
  const payableAcct = await getAccountByCode(input.businessId, '2010')
  if (!payableAcct) throw new Error('Vendors Payable account (2010) not found')
  const { postVoucherSmart } = await import('@/lib/accounting/voucher-supabase')
  const voucherId = await postVoucherSmart({
    businessId: input.businessId, voucherType: 'PM', voucherDate: input.applicationDate ?? new Date(),
    memo: 'Advance application', lines: [
      { accountId: payableAcct.id, debit: input.amountPaisas, credit: 0n, memo: 'Advance applied to purchase' },
      { accountId: payableAcct.id, debit: 0n, credit: input.amountPaisas, memo: 'Advance applied (reclassify)' },
    ], referenceId: input.purchaseId, referenceType: 'advance_application', postedBy: input.createdBy,
  })
  const pp = await db.purchasePayment.create({ data: { businessId: input.businessId, purchaseId: input.purchaseId, vendorId: input.vendorId, accountId: payableAcct.id, amount: input.amountPaisas, paymentType: 'advance_application', voucherId, notes: input.notes ?? null, createdBy: input.createdBy ?? null } })
  await db.purchase.update({ where: { id: input.purchaseId }, data: { paidAmount: { increment: input.amountPaisas }, outstandingAmount: { decrement: input.amountPaisas } } })
  return pp.id
}

// ─── Purchase Replacement (uses post_purchase_replacement() RPC from migration 00005a) ───
export type ReplacementItemInput = {
  originalPurchaseItemId: string
  outgoingProductId?: string | null; outgoingProductName: string
  outgoingQuantity: number; outgoingUnitCostPaisas: bigint
  incomingProductId?: string | null; incomingProductName: string
  incomingQuantity: number; incomingUnitCostPaisas: bigint
}

export async function postPurchaseReplacement(input: {
  businessId: string; purchaseId: string
  replacementItems: ReplacementItemInput[]
  replacementDate?: Date; notes?: string | null; createdBy?: string | null
}): Promise<{ replacementId: string; replacementNo: string }> {
  if (await isPhase5Live()) {
    const admin = getAdminSupabase()
    const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
    const itemsJson = input.replacementItems.map(it => ({
      original_purchase_item_id: it.originalPurchaseItemId,
      outgoing_product_id: it.outgoingProductId ?? null,
      outgoing_product_name: it.outgoingProductName,
      outgoing_quantity: it.outgoingQuantity,
      outgoing_unit_cost: it.outgoingUnitCostPaisas.toString(),
      incoming_product_id: it.incomingProductId ?? null,
      incoming_product_name: it.incomingProductName,
      incoming_quantity: it.incomingQuantity,
      incoming_unit_cost: it.incomingUnitCostPaisas.toString(),
    }))
    const { data, error } = await admin.rpc('post_purchase_replacement', {
      p_business_id: input.businessId,
      p_purchase_id: input.purchaseId,
      p_replacement_items: itemsJson,
      p_replacement_date: input.replacementDate ? bizDateString(input.replacementDate) : null,
      p_notes: input.notes ?? null,
      p_created_by: supabaseCreatedBy,
    })
    if (error) throw new Error(`post_purchase_replacement RPC: ${error.message}`)
    const replacementId = data as string
    // Fetch the replacement_no from the new record
    const { data: rep } = await admin.from('purchase_replacements')
      .select('replacement_no').eq('id', replacementId).single()
    return { replacementId, replacementNo: (rep as any)?.replacement_no ?? '' }
  }
  // Prisma fallback — simplified, uses audit_logs (no dedicated table in Prisma schema)
  const purchasesAcct = await getAccountByCode(input.businessId, '5010')
  if (!purchasesAcct) throw new Error('Purchases account (5010) not found')
  const payableAcct = await getAccountByCode(input.businessId, '2010')
  if (!payableAcct) throw new Error('Vendors Payable account (2010) not found')

  let outgoingValue = 0n; let incomingValue = 0n
  for (const item of input.replacementItems) {
    outgoingValue += item.outgoingUnitCostPaisas * BigInt(item.outgoingQuantity)
    incomingValue += item.incomingUnitCostPaisas * BigInt(item.incomingQuantity)
  }
  const valueDiff = incomingValue - outgoingValue
  const replacementNo = `REP-${String(Date.now()).slice(-4)}`

  let voucherId: string | null = null
  const { postVoucherSmart } = await import('@/lib/accounting/voucher-supabase')
  if (valueDiff > 0n) {
    voucherId = await postVoucherSmart({
      businessId: input.businessId, voucherType: 'RP', voucherDate: input.replacementDate ?? new Date(),
      memo: `Replacement (higher) ${replacementNo}`,
      lines: [
        { accountId: purchasesAcct.id, debit: valueDiff, credit: 0n, memo: `Replacement diff ${replacementNo}` },
        { accountId: payableAcct.id, debit: 0n, credit: valueDiff, memo: `Additional payable ${replacementNo}` },
      ], postedBy: input.createdBy,
    })
  } else if (valueDiff < 0n) {
    const abs = -valueDiff
    voucherId = await postVoucherSmart({
      businessId: input.businessId, voucherType: 'RP', voucherDate: input.replacementDate ?? new Date(),
      memo: `Replacement (lower) ${replacementNo}`,
      lines: [
        { accountId: payableAcct.id, debit: abs, credit: 0n, memo: `Vendor credit ${replacementNo}` },
        { accountId: purchasesAcct.id, debit: 0n, credit: abs, memo: `Value reduction ${replacementNo}` },
      ], postedBy: input.createdBy,
    })
  }

  const { createStockMovement } = await import('@/lib/products/data-access')
  for (const item of input.replacementItems) {
    if (item.outgoingProductId) await createStockMovement(input.businessId, { productId: item.outgoingProductId, movementType: 'adjustment_out', quantity: item.outgoingQuantity, reason: `Replacement out ${replacementNo}`, createdBy: input.createdBy })
    if (item.incomingProductId) await createStockMovement(input.businessId, { productId: item.incomingProductId, movementType: 'adjustment_in', quantity: item.incomingQuantity, reason: `Replacement in ${replacementNo}`, createdBy: input.createdBy })
  }

  await writeAudit({ businessId: input.businessId, userId: input.createdBy ?? null, action: 'PURCHASE_REPLACEMENT', entity: 'purchase_replacement', entityId: replacementNo, details: { replacement_no: replacementNo, purchase_id: input.purchaseId, outgoing_value: outgoingValue.toString(), incoming_value: incomingValue.toString(), value_diff: valueDiff.toString(), voucher_id: voucherId, notes: input.notes } })
  return { replacementId: replacementNo, replacementNo }
}

// ─── List Replacements for a purchase (reads from purchase_replacements + purchase_replacement_items) ───
export type ReplacementRecord = {
  id: string; replacementNo: string; date: string
  outgoingValue: string; incomingValue: string; valueDiff: string
  voucherId: string | null; notes: string | null
  items: Array<{
    outgoingProductName: string; outgoingQuantity: number; outgoingUnitCost: string
    incomingProductName: string; incomingQuantity: number; incomingUnitCost: string
  }>
}

export async function listReplacementsForPurchase(businessId: string, purchaseId: string): Promise<ReplacementRecord[]> {
  if (await isPhase5Live()) {
    const admin = getAdminSupabase()
    // Fetch replacement headers for this purchase, with nested items
    const { data: reps, error } = await admin.from('purchase_replacements')
      .select('id, replacement_no, replacement_date, outgoing_value, incoming_value, value_diff, voucher_id, notes, purchase_replacement_items(outgoing_product_name, outgoing_quantity, outgoing_unit_cost, incoming_product_name, incoming_quantity, incoming_unit_cost)')
      .eq('business_id', businessId).eq('purchase_id', purchaseId)
      .order('replacement_date', { ascending: false }).order('created_at', { ascending: false })
    if (error) throw new Error(`listReplacements: ${error.message}`)
    if (!reps) return []
    return (reps as any[]).map(r => ({
      id: r.id,
      replacementNo: r.replacement_no,
      date: r.replacement_date,
      outgoingValue: String(r.outgoing_value ?? '0'),
      incomingValue: String(r.incoming_value ?? '0'),
      valueDiff: String(r.value_diff ?? '0'),
      voucherId: r.voucher_id ?? null,
      notes: r.notes ?? null,
      items: (r.purchase_replacement_items ?? []).map((it: any) => ({
        outgoingProductName: it.outgoing_product_name,
        outgoingQuantity: it.outgoing_quantity,
        outgoingUnitCost: String(it.outgoing_unit_cost),
        incomingProductName: it.incoming_product_name,
        incomingQuantity: it.incoming_quantity,
        incomingUnitCost: String(it.incoming_unit_cost),
      })),
    }))
  }
  return []
}
