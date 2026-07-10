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

// ─── Vendor Ledger (proper — derived from voucher_lines on account 2010) ───
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
  // Prisma fallback — simplified
  return []
}

async function vendorLedgerViaSupabase(
  businessId: string,
  vendorId: string,
  filters?: { fromDate?: string | null; toDate?: string | null; typeFilter?: string | null; search?: string | null },
): Promise<VendorLedgerRow[]> {
  const admin = getAdminSupabase()

  // 1. Resolve the Vendors Payable account (2010).
  const { data: payableAcct } = await admin.from('accounts')
    .select('id').eq('business_id', businessId).eq('code', '2010').maybeSingle()
  if (!payableAcct) return []
  const payableAcctId = payableAcct.id

  // 2. Collect all voucher_ids that belong to this vendor:
  //    - purchases by this vendor (PU vouchers)
  //    - purchase_payments by this vendor (PM vouchers)
  //    - purchase_returns for this vendor (PR vouchers)
  const voucherIds = new Set<string>()

  // Purchases
  const { data: purchases } = await admin.from('purchases')
    .select('id, voucher_id, purchase_no, purchase_date')
    .eq('business_id', businessId).eq('vendor_id', vendorId).not('voucher_id', 'is', null)
  const purchaseMap = new Map<string, { ref: string; date: string; id: string }>()
  for (const p of purchases ?? []) {
    if (p.voucher_id) { voucherIds.add(p.voucher_id); purchaseMap.set(p.voucher_id, { ref: p.purchase_no, date: p.purchase_date, id: p.id }) }
  }

  // Purchase payments (later payments + advances + advance applications)
  const { data: payments } = await admin.from('purchase_payments')
    .select('id, voucher_id, payment_type, payment_date, purchase_id')
    .eq('business_id', businessId).eq('vendor_id', vendorId).not('voucher_id', 'is', null)
  const paymentMap = new Map<string, { type: string; id: string; date: string; purchaseId: string | null }>()
  for (const pp of payments ?? []) {
    if (pp.voucher_id) {
      voucherIds.add(pp.voucher_id)
      paymentMap.set(pp.voucher_id, { type: pp.payment_type, id: pp.id, date: pp.payment_date, purchaseId: pp.purchase_id })
    }
  }

  // Purchase returns
  const { data: returns } = await admin.from('purchase_returns')
    .select('id, voucher_id, return_no, return_date')
    .eq('business_id', businessId).eq('vendor_id', vendorId).not('voucher_id', 'is', null)
  const returnMap = new Map<string, { ref: string; date: string; id: string }>()
  for (const r of returns ?? []) {
    if (r.voucher_id) { voucherIds.add(r.voucher_id); returnMap.set(r.voucher_id, { ref: r.return_no, date: r.return_date, id: r.id }) }
  }

  if (voucherIds.size === 0) return []

  // 3. Fetch vouchers + voucher_lines on the payable account for these voucher_ids.
  const voucherIdArr = Array.from(voucherIds)
  const { data: vouchers } = await admin.from('vouchers')
    .select('id, voucher_type, voucher_date, memo, reference_id, reference_type, created_at')
    .in('id', voucherIdArr)
    .order('voucher_date', { ascending: true })
    .order('created_at', { ascending: true })

  // Filter by date range if provided
  let filteredVouchers = (vouchers ?? []).filter(v => {
    if (filters?.fromDate && v.voucher_date < filters.fromDate) return false
    if (filters?.toDate && v.voucher_date > filters.toDate) return false
    return true
  })

  if (filteredVouchers.length === 0) return []

  // Fetch voucher_lines on the payable account for these vouchers
  const { data: lines } = await admin.from('voucher_lines')
    .select('voucher_id, debit, credit')
    .eq('account_id', payableAcctId)
    .in('voucher_id', filteredVouchers.map(v => v.id))

  // Aggregate lines by voucher_id
  const lineAgg = new Map<string, { debit: bigint; credit: bigint }>()
  for (const l of lines ?? []) {
    const cur = lineAgg.get(l.voucher_id) ?? { debit: 0n, credit: 0n }
    cur.debit += BigInt(l.debit)
    cur.credit += BigInt(l.credit)
    lineAgg.set(l.voucher_id, cur)
  }

  // 4. Build ledger rows: one per voucher, with type + reference.
  type Row = VendorLedgerRow & { _created: string }
  let rows: Row[] = []
  for (const v of filteredVouchers) {
    const agg = lineAgg.get(v.id) ?? { debit: 0n, credit: 0n }
    let txnType = v.voucher_type
    let refNo = ''
    let refId: string | null = null
    let refType: string | null = null

    const pur = purchaseMap.get(v.id)
    const pay = paymentMap.get(v.id)
    const ret = returnMap.get(v.id)

    if (pur) {
      txnType = 'Purchase'
      refNo = pur.ref
      refId = pur.id
      refType = 'purchase'
    } else if (ret) {
      txnType = 'Purchase Return'
      refNo = ret.ref
      refId = ret.id
      refType = 'purchase_return'
    } else if (pay) {
      txnType = pay.type === 'vendor_advance' ? 'Vendor Advance'
        : pay.type === 'advance_application' ? 'Advance Application'
        : pay.type === 'vendor_refund' ? 'Vendor Refund'
        : 'Vendor Payment'
      refNo = pay.type === 'vendor_advance' ? 'ADV-' + pay.id.slice(0, 8)
        : pay.type === 'advance_application' ? 'APP-' + pay.id.slice(0, 8)
        : 'PMT-' + pay.id.slice(0, 8)
      refId = pay.id
      refType = pay.type
    } else {
      // Replacement or other — check voucher_type 'RP'
      if (v.voucher_type === 'RP') {
        txnType = 'Replacement'
        refNo = v.memo?.match(/REP-\d+/)?.[0] ?? v.id.slice(0, 8)
      } else {
        txnType = v.voucher_type
        refNo = v.id.slice(0, 8)
      }
    }

    rows.push({
      date: v.voucher_date,
      type: txnType,
      reference: refNo,
      description: v.memo ?? '',
      debit: agg.debit.toString(),
      credit: agg.credit.toString(),
      runningBalance: '0', // computed below
      voucherId: v.id,
      referenceId: refId,
      referenceType: refType,
      _created: v.created_at,
    })
  }

  // 5. Compute running balance (credit - debit; positive = payable, negative = advance).
  let running = 0n
  rows = rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    return a._created < b._created ? -1 : 1
  })
  for (const r of rows) {
    running += BigInt(r.credit) - BigInt(r.debit)
    r.runningBalance = running.toString()
  }

  // 6. Apply type filter
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

  // 7. Apply reference search
  if (filters?.search) {
    const q = filters.search.toLowerCase()
    rows = rows.filter(r => r.reference.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.type.toLowerCase().includes(q))
  }

  // Strip the _created helper
  return rows.map(({ _created, ...rest }) => rest)
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

// ─── Advance Application (apply vendor advance against a purchase) ───
export async function postAdvanceApplication(input: {
  businessId: string; vendorId: string; purchaseId: string
  amountPaisas: bigint; applicationDate?: Date; notes?: string | null; createdBy?: string | null
}): Promise<string> {
  if (await isPhase5Live()) {
    const admin = getAdminSupabase()
    const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)

    // Validate purchase belongs to vendor and has sufficient outstanding
    const { data: purchase } = await admin.from('purchases')
      .select('id, purchase_no, outstanding_amount, paid_amount, vendor_id')
      .eq('id', input.purchaseId).eq('business_id', input.businessId).eq('vendor_id', input.vendorId).maybeSingle()
    if (!purchase) throw new Error('Purchase not found for this vendor')
    if (BigInt(purchase.outstanding_amount) < input.amountPaisas) {
      throw new Error(`Advance application amount exceeds outstanding (${purchase.outstanding_amount})`)
    }

    // Resolve Vendors Payable account (2010)
    const { data: payableAcct } = await admin.from('accounts')
      .select('id').eq('business_id', input.businessId).eq('code', '2010').maybeSingle()
    if (!payableAcct) throw new Error('Vendors Payable account (2010) not found')

    const dateStr = input.applicationDate ? bizDateString(input.applicationDate) : null

    // Post voucher: Debit Payable (reduce payable), Credit Payable (reduce advance).
    // Both on 2010 — balanced, no net change, creates audit trail.
    const linesJson = [
      { account_id: payableAcct.id, debit: input.amountPaisas.toString(), credit: '0', memo: `Advance applied to purchase ${purchase.purchase_no}`, idx: 1 },
      { account_id: payableAcct.id, debit: '0', credit: input.amountPaisas.toString(), memo: 'Advance applied (reclassify)', idx: 2 },
    ]
    const { data: voucherId, error: vErr } = await admin.rpc('post_voucher', {
      p_business_id: input.businessId, p_voucher_type: 'PM',
      p_voucher_date: dateStr ?? bizDateString(new Date()),
      p_memo: `Advance application ${purchase.purchase_no}`,
      p_lines: linesJson,
      p_reference_id: input.purchaseId, p_reference_type: 'advance_application',
      p_posted_by: supabaseCreatedBy,
    })
    if (vErr) throw new Error(`post_voucher: ${vErr.message}`)

    // Insert payment record
    const { data: pp, error: ppErr } = await admin.from('purchase_payments').insert({
      business_id: input.businessId, purchase_id: input.purchaseId, vendor_id: input.vendorId,
      account_id: payableAcct.id, amount: input.amountPaisas.toString(),
      payment_date: dateStr, payment_type: 'advance_application',
      voucher_id: voucherId, notes: input.notes ?? null, created_by: supabaseCreatedBy,
    }).select('id').single()
    if (ppErr) throw new Error(`insert payment: ${ppErr.message}`)

    // Update purchase outstanding + paid
    const newOutstanding = BigInt(purchase.outstanding_amount) - input.amountPaisas
    const newPaid = BigInt(purchase.paid_amount) + input.amountPaisas
    const newStatus = newOutstanding <= 0n ? 'paid' : 'partially_paid'
    await admin.from('purchases').update({
      paid_amount: newPaid.toString(),
      outstanding_amount: newOutstanding.toString(),
      status: newStatus,
      updated_at: new Date().toISOString(),
    }).eq('id', input.purchaseId)

    return pp.id
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

// ─── Purchase Replacement (vendor replacement flow) ───
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
    return postPurchaseReplacementViaSupabase(input)
  }
  // Prisma fallback — simplified, same logic
  return postPurchaseReplacementViaPrisma(input)
}

async function postPurchaseReplacementViaSupabase(input: {
  businessId: string; purchaseId: string
  replacementItems: ReplacementItemInput[]
  replacementDate?: Date; notes?: string | null; createdBy?: string | null
}): Promise<{ replacementId: string; replacementNo: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)

  // Load purchase
  const { data: purchase } = await admin.from('purchases')
    .select('id, purchase_no, vendor_id, business_id')
    .eq('id', input.purchaseId).eq('business_id', input.businessId).maybeSingle()
  if (!purchase) throw new Error('Purchase not found')

  // Generate REP-0001 number (from audit_logs since we don't have a dedicated table yet)
  const { data: lastRep } = await admin.from('audit_logs')
    .select('details').eq('business_id', input.businessId).eq('action', 'PURCHASE_REPLACEMENT')
    .order('created_at', { ascending: false }).limit(1)
  let nextNum = 1
  if (lastRep && lastRep.length > 0) {
    const m = (lastRep[0].details as string)?.match(/REP-(\d+)/)
    if (m) nextNum = parseInt(m[1], 10) + 1
  }
  const replacementNo = `REP-${String(nextNum).padStart(4, '0')}`

  // Compute values
  let outgoingValue = 0n
  let incomingValue = 0n
  for (const item of input.replacementItems) {
    outgoingValue += item.outgoingUnitCostPaisas * BigInt(item.outgoingQuantity)
    incomingValue += item.incomingUnitCostPaisas * BigInt(item.incomingQuantity)
  }
  const valueDiff = incomingValue - outgoingValue

  // Resolve accounts
  const { data: purchasesAcct } = await admin.from('accounts')
    .select('id').eq('business_id', input.businessId).eq('code', '5010').maybeSingle()
  if (!purchasesAcct) throw new Error('Purchases account (5010) not found')
  const { data: payableAcct } = await admin.from('accounts')
    .select('id').eq('business_id', input.businessId).eq('code', '2010').maybeSingle()
  if (!payableAcct) throw new Error('Vendors Payable account (2010) not found')

  const dateStr = input.replacementDate ? bizDateString(input.replacementDate) : bizDateString(new Date())

  // Post voucher ONLY if there's a value difference
  let voucherId: string | null = null
  if (valueDiff > 0n) {
    // Replacement costs more: Debit Purchases, Credit Vendor Payable
    const linesJson = [
      { account_id: purchasesAcct.id, debit: valueDiff.toString(), credit: '0', memo: `Replacement value difference (higher) ${replacementNo}`, idx: 1 },
      { account_id: payableAcct.id, debit: '0', credit: valueDiff.toString(), memo: `Additional payable for ${replacementNo}`, idx: 2 },
    ]
    const { data: vid, error: ve } = await admin.rpc('post_voucher', {
      p_business_id: input.businessId, p_voucher_type: 'RP', p_voucher_date: dateStr,
      p_memo: `Replacement (higher value) ${replacementNo}`, p_lines: linesJson,
      p_reference_id: null, p_reference_type: 'purchase_replacement', p_posted_by: supabaseCreatedBy,
    })
    if (ve) throw new Error(`post_voucher: ${ve.message}`)
    voucherId = vid as string
  } else if (valueDiff < 0n) {
    // Replacement costs less: Debit Vendor Payable, Credit Purchases
    const absDiff = (-valueDiff).toString()
    const linesJson = [
      { account_id: payableAcct.id, debit: absDiff, credit: '0', memo: `Vendor credit for ${replacementNo}`, idx: 1 },
      { account_id: purchasesAcct.id, debit: '0', credit: absDiff, memo: `Replacement value reduction ${replacementNo}`, idx: 2 },
    ]
    const { data: vid, error: ve } = await admin.rpc('post_voucher', {
      p_business_id: input.businessId, p_voucher_type: 'RP', p_voucher_date: dateStr,
      p_memo: `Replacement (lower value) ${replacementNo}`, p_lines: linesJson,
      p_reference_id: null, p_reference_type: 'purchase_replacement', p_posted_by: supabaseCreatedBy,
    })
    if (ve) throw new Error(`post_voucher: ${ve.message}`)
    voucherId = vid as string
  }
  // Equal value: no voucher — audit trail only

  // Create stock movements for each item
  for (const item of input.replacementItems) {
    // Stock-out for defective
    if (item.outgoingProductId) {
      const { error: smErr } = await admin.rpc('create_stock_movement', {
        p_business_id: input.businessId, p_product_id: item.outgoingProductId,
        p_movement_type: 'adjustment_out', p_quantity: item.outgoingQuantity,
        p_reason: `Replacement out (defective) ${replacementNo}`,
        p_movement_date: dateStr, p_created_by: supabaseCreatedBy,
      })
      if (smErr) throw new Error(`create_stock_movement (out): ${smErr.message}`)
    }
    // Stock-in for replacement
    if (item.incomingProductId) {
      const { error: smErr } = await admin.rpc('create_stock_movement', {
        p_business_id: input.businessId, p_product_id: item.incomingProductId,
        p_movement_type: 'adjustment_in', p_quantity: item.incomingQuantity,
        p_reason: `Replacement in (received) ${replacementNo}`,
        p_movement_date: dateStr, p_created_by: supabaseCreatedBy,
      })
      if (smErr) throw new Error(`create_stock_movement (in): ${smErr.message}`)
    }
  }

  // Write audit log — this is the replacement record (stores all details)
  const replacementId = `rep-${Date.now().toString(36)}`
  const details = {
    replacement_no: replacementNo,
    purchase_id: input.purchaseId,
    purchase_no: purchase.purchase_no,
    vendor_id: purchase.vendor_id,
    outgoing_value: outgoingValue.toString(),
    incoming_value: incomingValue.toString(),
    value_diff: valueDiff.toString(),
    voucher_id: voucherId,
    notes: input.notes ?? null,
    items: input.replacementItems.map(it => ({
      original_purchase_item_id: it.originalPurchaseItemId,
      outgoing_product_id: it.outgoingProductId ?? null,
      outgoing_product_name: it.outgoingProductName,
      outgoing_quantity: it.outgoingQuantity,
      outgoing_unit_cost: it.outgoingUnitCostPaisas.toString(),
      incoming_product_id: it.incomingProductId ?? null,
      incoming_product_name: it.incomingProductName,
      incoming_quantity: it.incomingQuantity,
      incoming_unit_cost: it.incomingUnitCostPaisas.toString(),
    })),
  }
  await admin.from('audit_logs').insert({
    business_id: input.businessId, user_id: supabaseCreatedBy,
    action: 'PURCHASE_REPLACEMENT', entity: 'purchase_replacement', entity_id: replacementId,
    details: JSON.stringify(details),
  })

  return { replacementId, replacementNo }
}

async function postPurchaseReplacementViaPrisma(input: {
  businessId: string; purchaseId: string
  replacementItems: ReplacementItemInput[]
  replacementDate?: Date; notes?: string | null; createdBy?: string | null
}): Promise<{ replacementId: string; replacementNo: string }> {
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

// ─── List Replacements for a purchase (from audit_logs) ───
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
    const { data, error } = await admin.from('audit_logs')
      .select('id, entity_id, details, created_at')
      .eq('business_id', businessId).eq('action', 'PURCHASE_REPLACEMENT')
      .order('created_at', { ascending: false })
    if (error) return []
    const rows: ReplacementRecord[] = []
    for (const r of data ?? []) {
      try {
        const d = JSON.parse(r.details as string)
        if (d.purchase_id !== purchaseId) continue
        rows.push({
          id: r.entity_id ?? r.id,
          replacementNo: d.replacement_no ?? 'REP-????',
          date: r.created_at,
          outgoingValue: String(d.outgoing_value ?? '0'),
          incomingValue: String(d.incoming_value ?? '0'),
          valueDiff: String(d.value_diff ?? '0'),
          voucherId: d.voucher_id ?? null,
          notes: d.notes ?? null,
          items: (d.items ?? []).map((it: any) => ({
            outgoingProductName: it.outgoing_product_name, outgoingQuantity: it.outgoing_quantity, outgoingUnitCost: String(it.outgoing_unit_cost),
            incomingProductName: it.incoming_product_name, incomingQuantity: it.incoming_quantity, incomingUnitCost: String(it.incoming_unit_cost),
          })),
        })
      } catch { /* skip malformed */ }
    }
    return rows
  }
  return []
}
