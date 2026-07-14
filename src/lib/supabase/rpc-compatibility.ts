/**
 * Compile-time boundary for the database schema currently deployed in production.
 *
 * Phase 9 is intentionally not applied. Keep RPC argument construction here so a
 * future schema upgrade requires an explicit, reviewed source change.
 */
export const CURRENT_DATABASE_PHASE = 9 as const

export const CURRENT_DATABASE_CAPABILITIES = {
  salesDiscounts: true,
  salesIdempotency: false,
  receiptAllocations: false,
  receiptIdempotency: false,
} as const

export const PHASE_9_POST_SALE_ARGUMENT_NAMES = [
  'p_business_id',
  'p_invoice_type',
  'p_invoice_date',
  'p_items',
  'p_payments',
  'p_salesman_id',
  'p_customer_id',
  'p_customer_name',
  'p_customer_phone',
  'p_customer_address',
  'p_customer_city',
  'p_memo',
  'p_created_by',
  'p_discount_paisas',
] as const

export const PHASE_8_POST_RECEIPT_VOUCHER_ARGUMENT_NAMES = [
  'p_business_id',
  'p_receipt_date',
  'p_received_into_account_id',
  'p_credit_account_id',
  'p_amount_paisas',
  'p_customer_id',
  'p_reference',
  'p_notes',
  'p_created_by',
] as const

export type Phase8SaleItem = {
  product_id: string | null
  product_name: string
  qty: number
  unit_price: string
  is_temporary: boolean
}

export type Phase8SalePayment = {
  account_id: string
  amount: string
  is_change: boolean
}

export type Phase9PostSalePayload = {
  p_business_id: string
  p_invoice_type: 'COUNTER' | 'ONLINE' | 'OFC'
  p_invoice_date: string
  p_items: Phase8SaleItem[]
  p_payments: Phase8SalePayment[]
  p_salesman_id: string | null
  p_customer_id: string | null
  p_customer_name: string | null
  p_customer_phone: string | null
  p_customer_address: string | null
  p_customer_city: string | null
  p_memo: string | null
  p_created_by: string | null
  p_discount_paisas: string
}

export type BuildPhase9PostSalePayloadInput = Phase9PostSalePayload & {
  discountPaisas?: bigint
  idempotencyKey?: string | null
}

export type Phase8PostReceiptVoucherPayload = {
  p_business_id: string
  p_receipt_date: string
  p_received_into_account_id: string
  p_credit_account_id: string
  p_amount_paisas: string
  p_customer_id: string | null
  p_reference: string | null
  p_notes: string | null
  p_created_by: string | null
}

export type UnsupportedReceiptAllocation = {
  invoiceId: string
  allocatedAmount: unknown
}

export type BuildPhase8PostReceiptVoucherPayloadInput = Phase8PostReceiptVoucherPayload & {
  invoiceId?: string | null
  allocations?: readonly UnsupportedReceiptAllocation[] | null
  idempotencyKey?: string | null
}

export class UnsupportedDatabaseFeatureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedDatabaseFeatureError'
  }
}

export function assertPhase9SaleFeatures(input: {
  discountPaisas?: bigint
  idempotencyKey?: string | null
}): void {
  if (input.idempotencyKey) {
    throw new UnsupportedDatabaseFeatureError(
      'Sale retry keys are unavailable on the current database. Refresh the sale form and submit once; no sale was posted.',
    )
  }
}

export function assertPhase8ReceiptFeatures(input: {
  invoiceId?: string | null
  allocations?: readonly UnsupportedReceiptAllocation[] | null
  idempotencyKey?: string | null
}): void {
  if (input.invoiceId || (input.allocations?.length ?? 0) > 0) {
    throw new UnsupportedDatabaseFeatureError(
      'Invoice allocation is unavailable on the current database. Post a basic receipt without allocations; no receipt was posted.',
    )
  }
  if (input.idempotencyKey) {
    throw new UnsupportedDatabaseFeatureError(
      'Receipt retry keys are unavailable on the current database. Refresh the receipt form and submit once; no receipt was posted.',
    )
  }
}

export function buildPhase9PostSalePayload(
  input: BuildPhase9PostSalePayloadInput,
): Phase9PostSalePayload {
  assertPhase9SaleFeatures(input)
  return {
    p_business_id: input.p_business_id,
    p_invoice_type: input.p_invoice_type,
    p_invoice_date: input.p_invoice_date,
    p_items: input.p_items,
    p_payments: input.p_payments,
    p_salesman_id: input.p_salesman_id,
    p_customer_id: input.p_customer_id,
    p_customer_name: input.p_customer_name,
    p_customer_phone: input.p_customer_phone,
    p_customer_address: input.p_customer_address,
    p_customer_city: input.p_customer_city,
    p_memo: input.p_memo,
    p_created_by: input.p_created_by,
    p_discount_paisas: (input.discountPaisas ?? 0n).toString(),
  }
}

export function buildPhase8PostReceiptVoucherPayload(
  input: BuildPhase8PostReceiptVoucherPayloadInput,
): Phase8PostReceiptVoucherPayload {
  assertPhase8ReceiptFeatures(input)
  return {
    p_business_id: input.p_business_id,
    p_receipt_date: input.p_receipt_date,
    p_received_into_account_id: input.p_received_into_account_id,
    p_credit_account_id: input.p_credit_account_id,
    p_amount_paisas: input.p_amount_paisas,
    p_customer_id: input.p_customer_id,
    p_reference: input.p_reference,
    p_notes: input.p_notes,
    p_created_by: input.p_created_by,
  }
}
