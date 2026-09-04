/**
 * Phase 7 Delivery data-access — Supabase RPCs for Rider/COD/Delivery.
 * All money is BigInt paisas.
 */
import 'server-only'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolveSupabaseUuid } from '@/lib/accounting/voucher-supabase'
import type { SessionUser } from '@/lib/auth/permissions'
import { riderIdentityCandidates } from '@/lib/delivery/rider-identity'

// ─── Riders ───
export type RiderRow = {
  id: string; name: string; phone: string | null; zone: string | null;
  vehicleType: string | null; isActive: boolean; userId: string | null
}

export async function listRiders(businessId: string): Promise<RiderRow[]> {
  const admin = getAdminSupabase()
  const { data, error } = await admin.from('riders')
    .select('id, name, phone, zone, vehicle_type, is_active, user_id')
    .eq('business_id', businessId).order('name')
  if (error) throw new Error(`Supabase: ${error.message}`)
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, phone: r.phone, zone: r.zone, vehicleType: r.vehicle_type, isActive: r.is_active, userId: r.user_id }))
}

export async function createRider(businessId: string, name: string, phone?: string, zone?: string, vehicleType?: string, userId?: string | null): Promise<RiderRow> {
  const admin = getAdminSupabase()
  const { data, error } = await admin.from('riders').insert({
    business_id: businessId, name, phone: phone ?? null, zone: zone ?? null,
    vehicle_type: vehicleType ?? null, is_active: true, user_id: userId ?? null,
  }).select('id, name, phone, zone, vehicle_type, is_active, user_id').single()
  if (error) throw new Error(`Create rider: ${error.message}`)
  const r = data as any
  return { id: r.id, name: r.name, phone: r.phone, zone: r.zone, vehicleType: r.vehicle_type, isActive: r.is_active, userId: r.user_id }
}

export async function updateRider(businessId: string, riderId: string, updates: { name?: string; phone?: string | null; zone?: string | null; vehicleType?: string | null; isActive?: boolean; userId?: string | null }): Promise<void> {
  const admin = getAdminSupabase()
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) patch.name = updates.name
  if (updates.phone !== undefined) patch.phone = updates.phone
  if (updates.zone !== undefined) patch.zone = updates.zone
  if (updates.vehicleType !== undefined) patch.vehicle_type = updates.vehicleType
  if (updates.isActive !== undefined) patch.is_active = updates.isActive
  if (updates.userId !== undefined) patch.user_id = updates.userId
  const { error } = await admin.from('riders').update(patch).eq('id', riderId).eq('business_id', businessId)
  if (error) throw new Error(`Update rider: ${error.message}`)
}

// ─── Resolve rider from auth user (for Rider role) ───
export async function getRiderByUserId(businessId: string, userId: string | string[]): Promise<RiderRow | null> {
  const userIds = Array.from(new Set((Array.isArray(userId) ? userId : [userId]).filter(Boolean)))
  if (userIds.length === 0) return null
  const admin = getAdminSupabase()
  const { data, error } = await admin.from('riders')
    .select('id, name, phone, zone, vehicle_type, is_active, user_id')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .in('user_id', userIds)
    .limit(2)
  if (error || !data || data.length !== 1) return null
  const r = data[0] as any
  return { id: r.id, name: r.name, phone: r.phone, zone: r.zone, vehicleType: r.vehicle_type, isActive: r.is_active, userId: r.user_id }
}

/**
 * Resolve the Rider record across both supported identity lineages.
 *
 * Legacy production stores the Prisma/text user id in riders.user_id. Newer
 * records store the Supabase Auth UUID, while some staged schemas used the
 * profile id. Every candidate remains business-scoped, active-only and
 * fail-closed when more than one Rider matches.
 */
export async function getRiderForSession(user: Pick<SessionUser, 'businessId' | 'userId' | 'supabaseUserUuid' | 'profileId'>): Promise<RiderRow | null> {
  return getRiderByUserId(user.businessId, riderIdentityCandidates(user))
}

// ─── Delivery Orders ───
export type DeliveryOrderRow = {
  id: string; invoiceId: string; invoiceNo: string | null; riderId: string | null; riderName: string | null
  status: string; productAmount: string; customerDeliveryCharge: string; riderEarningAmount: string
  companyDeliveryIncome: string; totalCodAmount: string; codCollectedAmount: string
  assignedAt: string | null; outForDeliveryAt: string | null; deliveredAt: string | null; returnedAt: string | null
  recipientName: string | null; deliveryNote: string | null; returnReason: string | null
  source: string | null; deliveryVoucherId: string | null
  customerName: string | null; customerPhone: string | null; customerAddress: string | null; customerCity: string | null
}

export type DeliveryOrderItemRow = {
  invoiceItemId: string
  productName: string
  unitPrice: string
  orderedQty: number
  deliveredQty: number
  returnedQty: number
  remainingQty: number
}

export async function getDeliveryOrderItems(
  businessId: string,
  invoiceId: string,
  deliveryOrderId: string,
): Promise<DeliveryOrderItemRow[]> {
  const admin = getAdminSupabase()
  const { data: items, error } = await admin.from('invoice_items')
    .select('id, product_name, unit_price, qty, returned_qty')
    .eq('business_id', businessId)
    .eq('invoice_id', invoiceId)
    .order('created_at')
  if (error) throw new Error(`List delivery items: ${error.message}`)

  const { data: progress, error: progressError } = await admin
    .from('delivery_line_outcomes')
    .select('invoice_item_id, delivered_qty')
    .eq('business_id', businessId)
    .eq('delivery_order_id', deliveryOrderId)

  // Returned qty is authoritative on invoice_items.returned_qty (maintained by
  // post_sales_return / migration 00037). delivered_qty comes from the
  // legacy delivery_line_outcomes table (migration 00039). Before 00039 is
  // applied, lines remain readable with zero delivered progress.
  const progressRows = progressError ? [] : (progress ?? [])
  const byItem = new Map(progressRows.map((row: any) => [row.invoice_item_id, row]))
  return (items ?? []).map((row: any) => {
    const line = byItem.get(row.id) as any
    const orderedQty = Number(row.qty)
    const deliveredQty = Number(line?.delivered_qty ?? 0)
    const returnedQty = Number(row.returned_qty ?? 0)
    return {
      invoiceItemId: row.id,
      productName: row.product_name,
      unitPrice: String(row.unit_price ?? '0'),
      orderedQty,
      deliveredQty,
      returnedQty,
      remainingQty: Math.max(orderedQty - deliveredQty - returnedQty, 0),
    }
  })
}

export async function listDeliveryOrders(businessId: string, riderId?: string | null): Promise<DeliveryOrderRow[]> {
  const admin = getAdminSupabase()
  let query = admin.from('delivery_orders')
    .select('id, invoice_id, rider_id, status, product_amount, customer_delivery_charge, rider_earning_amount, company_delivery_income, total_cod_amount, cod_collected_amount, assigned_at, out_for_delivery_at, delivered_at, returned_at, recipient_name, delivery_note, return_reason, source, delivery_voucher_id, invoices(invoice_no, customer_name, customer_phone, customer_address, customer_city), riders(name)')
    .eq('business_id', businessId).order('created_at', { ascending: false }).limit(200)
  if (riderId) query = query.eq('rider_id', riderId)
  const { data, error } = await query
  if (error) throw new Error(`List delivery orders: ${error.message}`)
  return (data ?? []).map((r: any) => ({
    id: r.id, invoiceId: r.invoice_id, invoiceNo: r.invoices?.invoice_no ?? null,
    riderId: r.rider_id, riderName: r.riders?.name ?? null,
    status: r.status, productAmount: String(r.product_amount ?? '0'),
    customerDeliveryCharge: String(r.customer_delivery_charge ?? '0'),
    riderEarningAmount: String(r.rider_earning_amount ?? '0'),
    companyDeliveryIncome: String(r.company_delivery_income ?? '0'),
    totalCodAmount: String(r.total_cod_amount ?? '0'),
    codCollectedAmount: String(r.cod_collected_amount ?? '0'),
    assignedAt: r.assigned_at, outForDeliveryAt: r.out_for_delivery_at,
    deliveredAt: r.delivered_at, returnedAt: r.returned_at,
    recipientName: r.recipient_name, deliveryNote: r.delivery_note,
    returnReason: r.return_reason, source: r.source,
    deliveryVoucherId: r.delivery_voucher_id,
    customerName: r.invoices?.customer_name ?? null,
    customerPhone: r.invoices?.customer_phone ?? null,
    customerAddress: r.invoices?.customer_address ?? null,
    customerCity: r.invoices?.customer_city ?? null,
  }))
}

/** Customer-facing delivery context for an invoice print. */
export async function getDeliveryOrderForInvoice(businessId: string, invoiceId: string): Promise<DeliveryOrderRow | null> {
  const admin = getAdminSupabase()
  const { data, error } = await admin.from('delivery_orders')
    .select('id, invoice_id, rider_id, status, product_amount, customer_delivery_charge, rider_earning_amount, company_delivery_income, total_cod_amount, cod_collected_amount, assigned_at, out_for_delivery_at, delivered_at, returned_at, recipient_name, delivery_note, return_reason, source, delivery_voucher_id, invoices(invoice_no, customer_name, customer_phone, customer_address, customer_city), riders(name)')
    .eq('business_id', businessId).eq('invoice_id', invoiceId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error || !data) return null
  const r = data as any
  return {
    id: r.id, invoiceId: r.invoice_id, invoiceNo: r.invoices?.invoice_no ?? null,
    riderId: r.rider_id, riderName: r.riders?.name ?? null,
    status: r.status, productAmount: String(r.product_amount ?? '0'),
    customerDeliveryCharge: String(r.customer_delivery_charge ?? '0'), riderEarningAmount: String(r.rider_earning_amount ?? '0'),
    companyDeliveryIncome: String(r.company_delivery_income ?? '0'), totalCodAmount: String(r.total_cod_amount ?? '0'), codCollectedAmount: String(r.cod_collected_amount ?? '0'),
    assignedAt: r.assigned_at, outForDeliveryAt: r.out_for_delivery_at, deliveredAt: r.delivered_at, returnedAt: r.returned_at,
    recipientName: r.recipient_name, deliveryNote: r.delivery_note, returnReason: r.return_reason, source: r.source, deliveryVoucherId: r.delivery_voucher_id,
    customerName: r.invoices?.customer_name ?? null, customerPhone: r.invoices?.customer_phone ?? null,
    customerAddress: r.invoices?.customer_address ?? null, customerCity: r.invoices?.customer_city ?? null,
  }
}

export async function getDeliveryOrder(businessId: string, orderId: string): Promise<DeliveryOrderRow | null> {
  const admin = getAdminSupabase()
  const { data, error } = await admin.from('delivery_orders')
    .select('id, invoice_id, rider_id, status, product_amount, customer_delivery_charge, rider_earning_amount, company_delivery_income, total_cod_amount, cod_collected_amount, assigned_at, out_for_delivery_at, delivered_at, returned_at, recipient_name, delivery_note, return_reason, source, delivery_voucher_id, invoices(invoice_no, customer_name, customer_phone, customer_address, customer_city), riders(name)')
    .eq('id', orderId).eq('business_id', businessId).maybeSingle()
  if (error || !data) return null
  const r = data as any
  return {
    id: r.id, invoiceId: r.invoice_id, invoiceNo: r.invoices?.invoice_no ?? null,
    riderId: r.rider_id, riderName: r.riders?.name ?? null,
    status: r.status, productAmount: String(r.product_amount ?? '0'),
    customerDeliveryCharge: String(r.customer_delivery_charge ?? '0'),
    riderEarningAmount: String(r.rider_earning_amount ?? '0'),
    companyDeliveryIncome: String(r.company_delivery_income ?? '0'),
    totalCodAmount: String(r.total_cod_amount ?? '0'),
    codCollectedAmount: String(r.cod_collected_amount ?? '0'),
    assignedAt: r.assigned_at, outForDeliveryAt: r.out_for_delivery_at,
    deliveredAt: r.delivered_at, returnedAt: r.returned_at,
    recipientName: r.recipient_name, deliveryNote: r.delivery_note,
    returnReason: r.return_reason, source: r.source,
    deliveryVoucherId: r.delivery_voucher_id,
    customerName: r.invoices?.customer_name ?? null,
    customerPhone: r.invoices?.customer_phone ?? null,
    customerAddress: r.invoices?.customer_address ?? null,
    customerCity: r.invoices?.customer_city ?? null,
  }
}

// ─── Create delivery order from invoice ───
export async function createDeliveryOrder(input: {
  businessId: string; invoiceId: string; productAmount: bigint
  customerDeliveryCharge: bigint; riderEarningAmount: bigint; companyDeliveryIncome: bigint
  totalCodAmount: bigint; source?: string | null; createdBy?: string | null
}): Promise<string> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
  const { data, error } = await admin.from('delivery_orders').insert({
    business_id: input.businessId, invoice_id: input.invoiceId, status: 'pending',
    product_amount: input.productAmount.toString(),
    customer_delivery_charge: input.customerDeliveryCharge.toString(),
    rider_earning_amount: input.riderEarningAmount.toString(),
    company_delivery_income: input.companyDeliveryIncome.toString(),
    total_cod_amount: input.totalCodAmount.toString(),
    cod_collected_amount: '0',
    source: input.source ?? null,
    created_by: supabaseCreatedBy,
  }).select('id').single()
  if (error) throw new Error(`Create delivery order: ${error.message}`)
  return (data as any).id
}

// ─── Assign Rider ───
export async function assignRider(businessId: string, orderId: string, riderId: string, createdBy?: string | null): Promise<void> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(createdBy)
  const { error } = await admin.rpc('assign_rider_to_order', {
    p_business_id: businessId, p_delivery_order_id: orderId, p_rider_id: riderId, p_created_by: supabaseCreatedBy,
  })
  if (error) throw new Error(`assign_rider: ${error.message}`)
}

// ─── Update Delivery Status (Out for Delivery) ───
export async function updateDeliveryStatus(businessId: string, orderId: string, newStatus: string, note?: string | null, createdBy?: string | null): Promise<void> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(createdBy)
  const { error } = await admin.rpc('update_delivery_status', {
    p_business_id: businessId, p_delivery_order_id: orderId, p_new_status: newStatus,
    p_note: note ?? null, p_created_by: supabaseCreatedBy,
  })
  if (error) throw new Error(`update_delivery_status: ${error.message}`)
}

// ─── Mark Delivered ───
export async function markDelivered(businessId: string, orderId: string, collectedAmount: bigint, recipientName?: string | null, deliveryNote?: string | null, createdBy?: string | null): Promise<{ voucherId: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(createdBy)
  const { data, error } = await admin.rpc('mark_order_delivered', {
    p_business_id: businessId, p_delivery_order_id: orderId,
    p_collected_amount: collectedAmount.toString(),
    p_recipient_name: recipientName ?? null, p_delivery_note: deliveryNote ?? null,
    p_created_by: supabaseCreatedBy,
  })
  if (error) throw new Error(`mark_order_delivered: ${error.message}`)
  const r = data as any
  return { voucherId: r.voucher_id }
}

// Phase 3 canonical COD mutations.  Invoice IDs are production text IDs; the
// server never accepts a rider ID for delivery completion.  completeCodDelivery
// and returnRiderDelivery targeted UUID-lineage RPCs that are absent from the
// verified legacy production schema and have no callers; they are intentionally
// omitted.  The delivered/returned/settle flows below run entirely on the
// legacy delivery_orders lineage (migrations 00007 + 00037 + 00039).

export async function recordDeliveryOutcome(input: {
  businessId: string
  invoiceId: string
  items: Array<{ invoiceItemId: string; deliveredQty: number; returnedQty: number }>
  cashCollected: bigint
  reason?: string | null
  idempotencyKey: string
  actorId: string
}): Promise<{
  batch_id: string
  outcome_no: string
  invoice_id: string
  status: string
  delivered_qty: number
  returned_qty: number
  remaining_qty: number
  cash_collected: string
  sale_return_id: string | null
  idempotent: boolean
}> {
  const admin = getAdminSupabase()
  const actorId = await resolveSupabaseUuid(input.actorId)
  if (!actorId) throw new Error('Server-attributed delivery actor is unavailable')
  const { data, error } = await admin.rpc('record_delivery_outcome', {
    p_business_id: input.businessId,
    p_invoice_id: input.invoiceId,
    p_items: input.items.map(item => ({
      invoice_item_id: item.invoiceItemId,
      delivered_qty: item.deliveredQty,
      returned_qty: item.returnedQty,
    })),
    p_cash_collected: input.cashCollected.toString(),
    p_reason: input.reason ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_actor_id: actorId,
  })
  if (error) throw new Error(`record_delivery_outcome: ${error.message}`)
  return data as any
}

export async function startCodDelivery(input: { businessId: string; invoiceId: string; deliveryOrderId: string; idempotencyKey: string }): Promise<{ invoice_id: string; status: string; idempotent: boolean }> {
  // Legacy production has no mark_cod_out_for_delivery RPC.  The verified schema
  // exposes update_delivery_status(order_id, 'out_for_delivery'), so drive the
  // transition through it.  idempotencyKey is retained for the route contract.
  const admin = getAdminSupabase()
  const { error } = await admin.rpc('update_delivery_status', {
    p_business_id: input.businessId, p_delivery_order_id: input.deliveryOrderId,
    p_new_status: 'out_for_delivery', p_note: null, p_created_by: null,
  })
  if (error) throw new Error(`update_delivery_status: ${error.message}`)
  return { invoice_id: input.invoiceId, status: 'out_for_delivery', idempotent: false }
}

export type RiderCodBalance = {
  riderId: string; riderName: string; collectedCod: string; settledCod: string
  outstandingCod: string; invoiceCount: number; oldestOutstandingDeliveryDate: string | null; latestSettlementDate: string | null
}

export async function riderCodBalances(businessId: string, riderId?: string | null): Promise<RiderCodBalance[]> {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('get_rider_cod_balances', {
    p_business_id: businessId, p_rider_id: riderId ?? null,
  })
  if (error) throw new Error(`get_rider_cod_balances: ${error.message}`)
  return (data ?? []).map((row: any) => ({
    riderId: row.rider_id, riderName: row.rider_name,
    collectedCod: String(row.collected_cod ?? '0'), settledCod: String(row.settled_cod ?? '0'),
    outstandingCod: String(row.outstanding_cod ?? '0'), invoiceCount: Number(row.invoice_count ?? 0),
    oldestOutstandingDeliveryDate: row.oldest_outstanding_delivery_date ?? null,
    latestSettlementDate: row.latest_settlement_date ?? null,
  }))
}

export async function settleRiderCod(input: {
  businessId: string; riderId: string; amount: bigint; mode: string; note?: string | null; idempotencyKey: string; actorId: string
}): Promise<{ batch_id: string; reference: string; amount: string; allocation_count: number; idempotent: boolean }> {
  const admin = getAdminSupabase()
  const actorId = await resolveSupabaseUuid(input.actorId)
  if (!actorId) throw new Error('Server-attributed settlement actor is unavailable')
  const { data, error } = await admin.rpc('settle_rider_cod', {
    p_business_id: input.businessId, p_rider_id: input.riderId, p_amount: input.amount.toString(),
    p_mode: input.mode, p_note: input.note ?? null, p_idempotency_key: input.idempotencyKey,
    p_actor_id: actorId,
  })
  if (error) throw new Error(`settle_rider_cod: ${error.message}`)
  return data as any
}

// ─── Mark Returned ───
export async function markReturned(businessId: string, orderId: string, returnReason?: string | null, createdBy?: string | null): Promise<{ salesReturnId: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(createdBy)
  const { data, error } = await admin.rpc('mark_order_returned', {
    p_business_id: businessId, p_delivery_order_id: orderId,
    p_return_reason: returnReason ?? null, p_created_by: supabaseCreatedBy,
  })
  if (error) throw new Error(`mark_order_returned: ${error.message}`)
  const r = data as any
  return { salesReturnId: r.sales_return_id }
}

// ─── COD Submissions ───
export type CodSubmissionRow = {
  id: string; submissionNo: string; riderId: string; riderName: string | null
  submittedDate: string; requestedAmount: string; confirmedCashAmount: string
  riderFeeDeduction: string; settlementMode: string; status: string
  receivedIntoAccountId: string | null; notes: string | null; voucherId: string | null
}

export async function listCodSubmissions(businessId: string, riderId?: string | null): Promise<CodSubmissionRow[]> {
  const admin = getAdminSupabase()
  let query = admin.from('rider_cod_submissions')
    .select('id, submission_no, rider_id, submitted_date, requested_amount, confirmed_cash_amount, rider_fee_deduction, settlement_mode, status, received_into_account_id, notes, voucher_id, riders(name)')
    .eq('business_id', businessId).order('created_at', { ascending: false }).limit(100)
  if (riderId) query = query.eq('rider_id', riderId)
  const { data, error } = await query
  if (error) throw new Error(`List COD submissions: ${error.message}`)
  return (data ?? []).map((r: any) => ({
    id: r.id, submissionNo: r.submission_no, riderId: r.rider_id, riderName: r.riders?.name ?? null,
    submittedDate: r.submitted_date, requestedAmount: String(r.requested_amount ?? '0'),
    confirmedCashAmount: String(r.confirmed_cash_amount ?? '0'),
    riderFeeDeduction: String(r.rider_fee_deduction ?? '0'),
    settlementMode: r.settlement_mode, status: r.status,
    receivedIntoAccountId: r.received_into_account_id, notes: r.notes, voucherId: r.voucher_id,
  }))
}

export async function createCodSubmission(input: {
  businessId: string; riderId: string
  items: Array<{ deliveryOrderId: string; amountAllocated: bigint; riderFeeDeducted?: bigint }>
  settlementMode: string; requestedAmount: bigint; notes?: string | null; createdBy?: string | null
}): Promise<{ submissionId: string; submissionNo: string }> {
  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)
  const itemsJson = input.items.map(it => ({
    delivery_order_id: it.deliveryOrderId,
    amount_allocated: it.amountAllocated.toString(),
    rider_fee_deducted: (it.riderFeeDeducted ?? 0n).toString(),
  }))
  const { data, error } = await admin.rpc('create_cod_submission', {
    p_business_id: input.businessId, p_rider_id: input.riderId,
    p_items: itemsJson, p_settlement_mode: input.settlementMode,
    p_requested_amount: input.requestedAmount.toString(),
    p_notes: input.notes ?? null, p_created_by: supabaseCreatedBy,
  })
  if (error) throw new Error(`create_cod_submission: ${error.message}`)
  const r = data as any
  return { submissionId: r.submission_id, submissionNo: r.submission_no }
}

export async function confirmCodSubmission(input: {
  businessId: string; submissionId: string; confirmedCashAmount: bigint
  receivedIntoAccountId: string; riderFeeDeduction?: bigint; notes?: string | null; confirmedBy?: string | null
}): Promise<{ voucherId: string }> {
  const admin = getAdminSupabase()
  const supabaseConfirmedBy = await resolveSupabaseUuid(input.confirmedBy)
  const { data, error } = await admin.rpc('confirm_cod_submission', {
    p_business_id: input.businessId, p_submission_id: input.submissionId,
    p_confirmed_cash_amount: input.confirmedCashAmount.toString(),
    p_received_into_account_id: input.receivedIntoAccountId,
    p_rider_fee_deduction: (input.riderFeeDeduction ?? 0n).toString(),
    p_notes: input.notes ?? null, p_confirmed_by: supabaseConfirmedBy,
  })
  if (error) throw new Error(`confirm_cod_submission: ${error.message}`)
  const r = data as any
  return { voucherId: r.voucher_id }
}

// ─── Rider Ledger ───
export type RiderLedgerRow = {
  eventDate: string; eventType: string; reference: string; orderId: string | null
  codAssigned: string; codDelivered: string; codSubmitted: string; codPending: string
  deliveryEarning: string; earningSettled: string
  runningCodBalance: string; runningEarningBalance: string; voucherId: string | null
}

export async function riderLedger(businessId: string, riderId: string, fromDate?: string | null, toDate?: string | null): Promise<RiderLedgerRow[]> {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('rider_ledger', {
    p_business_id: businessId, p_rider_id: riderId,
    p_from_date: fromDate ?? null, p_to_date: toDate ?? null,
  })
  if (error) throw new Error(`rider_ledger: ${error.message}`)
  if (!data || !Array.isArray(data)) return []
  return (data as any[]).map(r => ({
    eventDate: r.event_date, eventType: r.event_type, reference: r.reference,
    orderId: r.order_id, codAssigned: String(r.cod_assigned ?? '0'),
    codDelivered: String(r.cod_delivered ?? '0'), codSubmitted: String(r.cod_submitted ?? '0'),
    codPending: String(r.cod_pending ?? '0'), deliveryEarning: String(r.delivery_earning ?? '0'),
    earningSettled: String(r.earning_settled ?? '0'),
    runningCodBalance: String(r.running_cod_balance ?? '0'),
    runningEarningBalance: String(r.running_earning_balance ?? '0'),
    voucherId: r.voucher_id ?? null,
  }))
}

// ─── Rider Dashboard Summary ───
export type RiderDashboardSummary = {
  assigned: number; outForDelivery: number; deliveredToday: number
  codPending: string; earningsPayable: string
}

export async function riderDashboardSummary(businessId: string, riderId: string): Promise<RiderDashboardSummary> {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('rider_dashboard_summary', {
    p_business_id: businessId, p_rider_id: riderId,
  })
  if (error) throw new Error(`rider_dashboard_summary: ${error.message}`)
  const r = data as any
  return {
    assigned: r.assigned ?? 0, outForDelivery: r.out_for_delivery ?? 0,
    deliveredToday: r.delivered_today ?? 0,
    codPending: String(r.cod_pending ?? '0'),
    earningsPayable: String(r.earnings_payable ?? '0'),
  }
}
