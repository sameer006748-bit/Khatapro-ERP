/**
 * Shared sale / return / commission domain engine.
 *
 * ONE implementation used by Counter, Online, OFC and Other sale channels —
 * both on the server (posting, validation) and in the browser (live preview).
 * Channel-specific concerns (rider, COD, delivery, advance, source) stay in the
 * channel routes/views; everything below is channel-agnostic.
 *
 * Money is BigInt paisas throughout. Quantities are whole pieces.
 *
 * Approved business rules encoded here (do not reinterpret):
 *   net quantity      = sold quantity − returned quantity
 *   line total        = net quantity × unit rate − line discount
 *   stock effect      = −net quantity   (sale reduces, return restores)
 *   commission units  = net quantity
 *   commission amount = product per-piece commission rate × net quantity
 *   net sale          = gross sales − returns deduction − discounts
 *
 * This module is intentionally free of `server-only`, Prisma and Supabase
 * imports so the same arithmetic runs in the POS screen and in the API.
 */

export class SaleLineError extends Error {
  readonly lineIndex: number
  constructor(message: string, lineIndex: number) {
    super(message)
    this.name = 'SaleLineError'
    this.lineIndex = lineIndex
  }
}

export type SellerRole = 'OWNER' | 'SALESMAN'

/**
 * SALE — a normal bill row; it may also carry a same-bill returned quantity
 *        (customer swapped/handed back part of what was just billed).
 * HISTORICAL_RETURN — a row that settles a return against a previously posted
 *        invoice item. It carries no sold quantity of its own and must always
 *        reference the original invoice item so the audit trail is preserved.
 */
export type SaleLineKind = 'SALE' | 'HISTORICAL_RETURN'

/** What the caller supplies for one bill row. */
export type SaleLineInput = {
  productId?: string | null
  productName: string
  /** Pieces sold on this bill. */
  soldQty: number
  /** Pieces returned against this same product on this bill. Defaults to 0. */
  returnedQty?: number
  unitPricePaisas: bigint
  /** Optional per-line discount in paisas. Defaults to 0. */
  lineDiscountPaisas?: bigint
  /** Product per-piece commission rate in paisas. `null` = not configured. */
  commissionRatePaisas?: bigint | null
  isTemporary?: boolean
  /**
   * Set when this row settles a return against a previously posted invoice
   * item. Required for historical returns so the audit link is preserved.
   */
  originalInvoiceItemId?: string | null
  /**
   * Remaining returnable quantity on the referenced historical invoice item.
   * Only meaningful together with `originalInvoiceItemId`.
   */
  remainingReturnableQty?: number | null
}

/** Fully derived bill row — every figure the UI and the poster need. */
export type NormalizedSaleLine = {
  kind: SaleLineKind
  productId: string | null
  productName: string
  soldQty: number
  returnedQty: number
  netQty: number
  unitPricePaisas: bigint
  lineDiscountPaisas: bigint
  /** soldQty × unitPrice */
  grossAmountPaisas: bigint
  /** returnedQty × unitPrice */
  returnAmountPaisas: bigint
  /** netQty × unitPrice − lineDiscount */
  lineTotalPaisas: bigint
  commissionRatePaisas: bigint
  /** Pieces that earn commission = netQty. */
  commissionUnits: number
  commissionAmountPaisas: bigint
  /** Signed change applied to product stock: negative sells, positive restores. */
  stockEffect: number
  isTemporary: boolean
  originalInvoiceItemId: string | null
}

export type SaleTotals = {
  grossSalesPaisas: bigint
  returnsDeductionPaisas: bigint
  lineDiscountPaisas: bigint
  invoiceDiscountPaisas: bigint
  totalDiscountPaisas: bigint
  /** grossSales − returnsDeduction − lineDiscounts − invoiceDiscount */
  netSalePaisas: bigint
  paidPaisas: bigint
  changePaisas: bigint
  /** netSale − (paid − change). Positive = customer still owes. */
  receivablePaisas: bigint
  totalCommissionPaisas: bigint
  totalSoldQty: number
  totalReturnedQty: number
  totalNetQty: number
  /** Net signed stock movement across all lines. */
  netStockEffect: number
}

export type SellerAttribution = {
  role: SellerRole
  /** Null when the Owner personally made the sale. Never a fallback salesman. */
  salesmanId: string | null
  /** Commission belongs to the business Owner rather than a salesman. */
  isOwnerCommission: boolean
}

// ─────────────────────────────────────────────────────────────
// Line normalization
// ─────────────────────────────────────────────────────────────

function toBigInt(value: bigint | null | undefined): bigint {
  return value ?? 0n
}

/**
 * Validate and derive one bill row.
 *
 * Throws `SaleLineError` when the row breaks an approved rule:
 *  - sold quantity must be a positive whole number
 *  - returned quantity must be a non-negative whole number
 *  - returned quantity may not exceed sold quantity on a mixed bill
 *  - a historical return may not exceed the remaining returnable quantity
 */
export function normalizeSaleLine(line: SaleLineInput, lineIndex = 0): NormalizedSaleLine {
  const kind: SaleLineKind = line.originalInvoiceItemId ? 'HISTORICAL_RETURN' : 'SALE'
  const soldQty = line.soldQty
  const returnedQty = line.returnedQty ?? 0

  if (!Number.isInteger(returnedQty) || returnedQty < 0) {
    throw new SaleLineError(`${line.productName}: returned quantity must be zero or a whole number.`, lineIndex)
  }

  if (kind === 'HISTORICAL_RETURN') {
    // A referenced return settles an earlier invoice; it never sells anything.
    if (!Number.isInteger(soldQty) || soldQty !== 0) {
      throw new SaleLineError(
        `${line.productName}: a referenced invoice return cannot also sell quantity on the same row.`,
        lineIndex,
      )
    }
    if (returnedQty <= 0) {
      throw new SaleLineError(`${line.productName}: enter the quantity being returned.`, lineIndex)
    }
    const remaining = line.remainingReturnableQty
    if (remaining === null || remaining === undefined) {
      throw new SaleLineError(
        `${line.productName}: the remaining returnable quantity of the referenced invoice item is unknown.`,
        lineIndex,
      )
    }
    if (returnedQty > remaining) {
      throw new SaleLineError(
        `${line.productName}: returned quantity (${returnedQty}) exceeds the remaining returnable quantity (${remaining}) on the referenced invoice.`,
        lineIndex,
      )
    }
  } else {
    if (!Number.isInteger(soldQty) || soldQty <= 0) {
      throw new SaleLineError(`${line.productName}: sold quantity must be a whole number greater than zero.`, lineIndex)
    }
    if (returnedQty > soldQty) {
      throw new SaleLineError(
        `${line.productName}: returned quantity (${returnedQty}) cannot exceed sold quantity (${soldQty}). Use a referenced invoice return for earlier bills.`,
        lineIndex,
      )
    }
  }

  const unitPricePaisas = line.unitPricePaisas
  if (unitPricePaisas < 0n) {
    throw new SaleLineError(`${line.productName}: unit rate cannot be negative.`, lineIndex)
  }

  const lineDiscountPaisas = toBigInt(line.lineDiscountPaisas)
  if (lineDiscountPaisas < 0n) {
    throw new SaleLineError(`${line.productName}: discount cannot be negative.`, lineIndex)
  }

  const netQty = soldQty - returnedQty
  const grossAmountPaisas = unitPricePaisas * BigInt(soldQty)
  const returnAmountPaisas = unitPricePaisas * BigInt(returnedQty)
  const netAmountPaisas = unitPricePaisas * BigInt(netQty)

  if (kind === 'HISTORICAL_RETURN') {
    // A referenced return has a negative net amount (it gives value back), so
    // "discount vs net amount" is meaningless here. A refund is settled at the
    // original rate; discounting it would silently short-pay the customer.
    if (lineDiscountPaisas > 0n) {
      throw new SaleLineError(
        `${line.productName}: a referenced invoice return is refunded at the original rate and cannot carry a discount.`,
        lineIndex,
      )
    }
  } else if (lineDiscountPaisas > netAmountPaisas) {
    throw new SaleLineError(`${line.productName}: discount cannot exceed the net line amount.`, lineIndex)
  }

  // Temporary rows have no product record, therefore no configured commission.
  const commissionRatePaisas = line.productId ? toBigInt(line.commissionRatePaisas) : 0n
  if (commissionRatePaisas < 0n) {
    throw new SaleLineError(`${line.productName}: commission rate cannot be negative.`, lineIndex)
  }

  // Approved policy: a return against an EARLIER invoice does not claw back
  // commission that was already earned on that invoice. Only same-bill returns
  // reduce eligibility, by reducing the net quantity of this bill.
  const commissionUnits = kind === 'HISTORICAL_RETURN' ? 0 : netQty

  return {
    kind,
    productId: line.productId ?? null,
    productName: line.productName,
    soldQty,
    returnedQty,
    netQty,
    unitPricePaisas,
    lineDiscountPaisas,
    grossAmountPaisas,
    returnAmountPaisas,
    lineTotalPaisas: netAmountPaisas - lineDiscountPaisas,
    commissionRatePaisas,
    commissionUnits,
    commissionAmountPaisas: commissionRatePaisas * BigInt(commissionUnits),
    stockEffect: -netQty,
    isTemporary: line.isTemporary ?? false,
    originalInvoiceItemId: line.originalInvoiceItemId ?? null,
  }
}

/** Normalize every row of a bill, preserving order. */
export function normalizeSaleLines(lines: readonly SaleLineInput[]): NormalizedSaleLine[] {
  return lines.map((line, i) => normalizeSaleLine(line, i))
}

// ─────────────────────────────────────────────────────────────
// Totals
// ─────────────────────────────────────────────────────────────

export type SaleTotalsInput = {
  invoiceDiscountPaisas?: bigint
  /** Amounts received from the customer (excluding change given back). */
  paidPaisas?: bigint
  /** Change / refund handed back to the customer. */
  changePaisas?: bigint
}

export function computeSaleTotals(
  lines: readonly NormalizedSaleLine[],
  input: SaleTotalsInput = {},
): SaleTotals {
  let grossSalesPaisas = 0n
  let returnsDeductionPaisas = 0n
  let lineDiscountPaisas = 0n
  let totalCommissionPaisas = 0n
  let totalSoldQty = 0
  let totalReturnedQty = 0
  let totalNetQty = 0
  let netStockEffect = 0

  for (const line of lines) {
    grossSalesPaisas += line.grossAmountPaisas
    returnsDeductionPaisas += line.returnAmountPaisas
    lineDiscountPaisas += line.lineDiscountPaisas
    totalCommissionPaisas += line.commissionAmountPaisas
    totalSoldQty += line.soldQty
    totalReturnedQty += line.returnedQty
    totalNetQty += line.netQty
    netStockEffect += line.stockEffect
  }

  const invoiceDiscountPaisas = toBigInt(input.invoiceDiscountPaisas)
  const totalDiscountPaisas = lineDiscountPaisas + invoiceDiscountPaisas
  const netSalePaisas = grossSalesPaisas - returnsDeductionPaisas - totalDiscountPaisas
  const paidPaisas = toBigInt(input.paidPaisas)
  const changePaisas = toBigInt(input.changePaisas)

  return {
    grossSalesPaisas,
    returnsDeductionPaisas,
    lineDiscountPaisas,
    invoiceDiscountPaisas,
    totalDiscountPaisas,
    netSalePaisas,
    paidPaisas,
    changePaisas,
    receivablePaisas: netSalePaisas - (paidPaisas - changePaisas),
    totalCommissionPaisas,
    totalSoldQty,
    totalReturnedQty,
    totalNetQty,
    netStockEffect,
  }
}

/**
 * Validate the bill as a whole. Returns the first blocking problem, or null.
 * Used by both the POS screen (to disable Post) and the API (to fail closed).
 */
export function validateSaleTotals(totals: SaleTotals): string | null {
  if (totals.invoiceDiscountPaisas < 0n) return 'Discount cannot be negative.'
  if (totals.totalNetQty <= 0) {
    return 'The bill has no net billable quantity. Reduce the returned quantity or add an item.'
  }
  if (totals.totalDiscountPaisas > totals.grossSalesPaisas - totals.returnsDeductionPaisas) {
    return 'Discount cannot exceed the net sale value.'
  }
  if (totals.netSalePaisas < 0n) {
    return 'Returns exceed sales on this bill. Post a linked return from the original invoice instead.'
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// Inventory
// ─────────────────────────────────────────────────────────────

export type StockEffect = {
  productId: string
  productName: string
  soldQty: number
  returnedQty: number
  /** Signed movement: negative decreases stock, positive restores it. */
  netChange: number
}

/**
 * Aggregate the net stock movement per product. Rows without a product record
 * (temporary items) do not touch stock. Repeated rows for the same product are
 * merged so a single transactional update per product is possible.
 */
export function computeStockEffects(lines: readonly NormalizedSaleLine[]): StockEffect[] {
  const byProduct = new Map<string, StockEffect>()
  for (const line of lines) {
    if (!line.productId) continue
    const existing = byProduct.get(line.productId)
    if (existing) {
      existing.soldQty += line.soldQty
      existing.returnedQty += line.returnedQty
      existing.netChange += line.stockEffect
    } else {
      byProduct.set(line.productId, {
        productId: line.productId,
        productName: line.productName,
        soldQty: line.soldQty,
        returnedQty: line.returnedQty,
        netChange: line.stockEffect,
      })
    }
  }
  return [...byProduct.values()]
}

// ─────────────────────────────────────────────────────────────
// Commission
// ─────────────────────────────────────────────────────────────

export type CommissionLine = {
  productId: string | null
  productName: string
  soldQty: number
  returnedQty: number
  netEligibleQty: number
  ratePaisas: bigint
  commissionPaisas: bigint
}

/**
 * Product-wise per-piece commission for a bill.
 *
 * commission = product commission rate × net eligible quantity
 * where net eligible quantity = sold − returned.
 */
export function computeCommissionLines(lines: readonly NormalizedSaleLine[]): CommissionLine[] {
  return lines.map((line) => ({
    productId: line.productId,
    productName: line.productName,
    soldQty: line.soldQty,
    returnedQty: line.returnedQty,
    netEligibleQty: line.commissionUnits,
    ratePaisas: line.commissionRatePaisas,
    commissionPaisas: line.commissionAmountPaisas,
  }))
}

export function sumCommission(lines: readonly CommissionLine[]): bigint {
  return lines.reduce((total, line) => total + line.commissionPaisas, 0n)
}

/**
 * Proportional commission earned for a collection.
 *
 * Commission is earned when money is collected, never merely on invoice
 * creation. A final collection closes any integer-division residue so the
 * salesman is neither short-paid nor over-paid.
 */
export function computeEarnedCommission(input: {
  totalEligibilityPaisas: bigint
  invoiceTotalPaisas: bigint
  collectedAmountPaisas: bigint
  priorEarnedPaisas: bigint
}): bigint {
  const { totalEligibilityPaisas, invoiceTotalPaisas, collectedAmountPaisas, priorEarnedPaisas } = input
  if (totalEligibilityPaisas <= 0n || invoiceTotalPaisas <= 0n || collectedAmountPaisas <= 0n) return 0n
  if (collectedAmountPaisas >= invoiceTotalPaisas) {
    const remaining = totalEligibilityPaisas - priorEarnedPaisas
    return remaining > 0n ? remaining : 0n
  }
  const proportional = (collectedAmountPaisas * totalEligibilityPaisas) / invoiceTotalPaisas
  const incremental = proportional - priorEarnedPaisas
  return incremental > 0n ? incremental : 0n
}

// ─────────────────────────────────────────────────────────────
// Seller attribution
// ─────────────────────────────────────────────────────────────

export type SellerAttributionInput = {
  /** Explicit choice from the sale screen: sell as the Owner, or as a salesman. */
  sellerMode?: SellerRole | null
  /** Salesman chosen on the screen (only meaningful for SALESMAN mode). */
  requestedSalesmanId?: string | null
  /** The acting user may attribute sales to any seller (Owner/Admin). */
  actorCanAttributeAnySeller: boolean
  /** Salesman record linked to the acting user, when one exists. */
  actorSalesmanId?: string | null
}

export type SellerAttributionResult =
  | { ok: true; attribution: SellerAttribution }
  | { ok: false; error: string; status: number }

/**
 * Decide who earns the commission.
 *
 *  - A salesman posting their own sale always earns it themselves.
 *  - An Owner/Admin must state explicitly whether the sale is their own
 *    (OWNER) or belongs to a named salesman (SALESMAN). There is deliberately
 *    no implicit fallback to a "default" salesman: attributing an Owner sale to
 *    an unrelated salesman would create a real, unearned payable.
 */
export function resolveSellerAttribution(input: SellerAttributionInput): SellerAttributionResult {
  if (input.actorCanAttributeAnySeller) {
    if (input.sellerMode === 'OWNER') {
      return { ok: true, attribution: { role: 'OWNER', salesmanId: null, isOwnerCommission: true } }
    }
    const salesmanId = input.requestedSalesmanId || null
    if (!salesmanId) {
      return {
        ok: false,
        status: 400,
        error: 'Select who made this sale: the Owner, or a named salesman. Commission is credited to that seller.',
      }
    }
    return { ok: true, attribution: { role: 'SALESMAN', salesmanId, isOwnerCommission: false } }
  }

  // A salesman-scoped user can only ever sell as themselves.
  const own = input.actorSalesmanId || null
  if (!own) {
    return {
      ok: false,
      status: 403,
      error: 'Your user account is not linked to a salesman record.',
    }
  }
  return { ok: true, attribution: { role: 'SALESMAN', salesmanId: own, isOwnerCommission: false } }
}

export function sellerRoleLabel(role: SellerRole): string {
  return role === 'OWNER' ? 'Owner' : 'Salesman'
}

// ─────────────────────────────────────────────────────────────
// Invoice serialization / print model
// ─────────────────────────────────────────────────────────────

export type InvoicePrintLine = {
  productName: string
  sku: string | null
  soldQty: number
  returnedQty: number
  netQty: number
  unitPricePaisas: string
  discountPaisas: string
  lineTotalPaisas: string
}

export type InvoicePrintModel = {
  invoiceNo: string
  invoiceType: string
  invoiceDate: string
  channelLabel: string
  documentTitle: string
  sellerName: string | null
  sellerRoleLabel: string | null
  customerName: string | null
  customerPhone: string | null
  customerAddress: string | null
  customerCity: string | null
  source: string | null
  riderName: string | null
  codAmountPaisas: string | null
  memo: string | null
  lines: InvoicePrintLine[]
  /** True when at least one line carries a returned quantity. */
  hasReturns: boolean
  subtotalPaisas: string
  returnDeductionPaisas: string
  discountPaisas: string
  deliveryFeePaisas: string | null
  netPayablePaisas: string
  paidPaisas: string
  balancePaisas: string
  changePaisas: string | null
  payments: Array<{ accountCode: string; accountName: string; amountPaisas: string; isChange: boolean }>
  isReturned: boolean
  isCancelled: boolean
  /** Internal-only figures; never rendered on a customer document. */
  internalCommission: {
    totalPaisas: string
    lines: Array<{
      productName: string
      netEligibleQty: number
      ratePaisas: string
      commissionPaisas: string
    }>
  } | null
}

export function invoiceChannelLabel(invoiceType: string): string {
  switch (invoiceType) {
    case 'ONLINE': return 'Online Sale'
    case 'OFC': return 'Out-of-City Sale'
    case 'OTHER': return 'Other Sale'
    default: return 'Counter Sale'
  }
}

export function invoiceDocumentTitle(invoiceType: string): string {
  switch (invoiceType) {
    case 'ONLINE': return 'ONLINE ORDER'
    case 'OFC': return 'OFC INVOICE'
    case 'OTHER': return 'SALE INVOICE'
    default: return 'SALE INVOICE'
  }
}

export type BuildInvoicePrintModelInput = {
  invoiceNo: string
  invoiceType: string
  invoiceDate: string
  sellerName?: string | null
  sellerRole?: SellerRole | null
  customerName?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  customerCity?: string | null
  source?: string | null
  riderName?: string | null
  codAmountPaisas?: string | null
  deliveryFeePaisas?: string | null
  memo?: string | null
  items: Array<{
    productName: string
    sku?: string | null
    qty: number
    returnedQty?: number | null
    unitPrice: string
    lineTotal: string
    discount?: string | null
  }>
  subtotal: string
  discount?: string | null
  total: string
  paidAmount: string
  changeAmount?: string | null
  payments?: Array<{ accountCode?: string | null; accountName: string; amount: string; isChange?: boolean }>
  isReturned?: boolean
  isCancelled?: boolean
  /** Owner-only internal print. Commission is omitted entirely when absent. */
  commission?: {
    totalPaisas: string
    lines: Array<{ productName: string; netEligibleQty: number; ratePaisas: string; commissionPaisas: string }>
  } | null
}

/**
 * Build the single serialization every printed document renders from — A4,
 * half-A4 and thermal all consume this model so the figures cannot diverge.
 */
export function buildInvoicePrintModel(input: BuildInvoicePrintModelInput): InvoicePrintModel {
  let returnDeduction = 0n
  const lines: InvoicePrintLine[] = input.items.map((item) => {
    const returnedQty = item.returnedQty ?? 0
    const unitPrice = BigInt(item.unitPrice)
    returnDeduction += unitPrice * BigInt(returnedQty)
    return {
      productName: item.productName,
      sku: item.sku ?? null,
      soldQty: item.qty,
      returnedQty,
      netQty: item.qty - returnedQty,
      unitPricePaisas: item.unitPrice,
      discountPaisas: item.discount ?? '0',
      lineTotalPaisas: item.lineTotal,
    }
  })

  const total = BigInt(input.total)
  const paid = BigInt(input.paidAmount)

  return {
    invoiceNo: input.invoiceNo,
    invoiceType: input.invoiceType,
    invoiceDate: input.invoiceDate,
    channelLabel: invoiceChannelLabel(input.invoiceType),
    documentTitle: invoiceDocumentTitle(input.invoiceType),
    sellerName: input.sellerName ?? null,
    sellerRoleLabel: input.sellerRole ? sellerRoleLabel(input.sellerRole) : null,
    customerName: input.customerName ?? null,
    customerPhone: input.customerPhone ?? null,
    customerAddress: input.customerAddress ?? null,
    customerCity: input.customerCity ?? null,
    source: input.source ?? null,
    riderName: input.riderName ?? null,
    codAmountPaisas: input.codAmountPaisas ?? null,
    memo: input.memo ?? null,
    lines,
    hasReturns: lines.some((line) => line.returnedQty > 0),
    subtotalPaisas: input.subtotal,
    returnDeductionPaisas: returnDeduction.toString(),
    discountPaisas: input.discount ?? '0',
    deliveryFeePaisas: input.deliveryFeePaisas ?? null,
    netPayablePaisas: input.total,
    paidPaisas: input.paidAmount,
    balancePaisas: (total - paid).toString(),
    changePaisas: input.changeAmount ?? null,
    payments: (input.payments ?? []).map((payment) => ({
      accountCode: payment.accountCode ?? '',
      accountName: payment.accountName,
      amountPaisas: payment.amount,
      isChange: payment.isChange ?? false,
    })),
    isReturned: input.isReturned ?? false,
    isCancelled: input.isCancelled ?? false,
    internalCommission: input.commission
      ? { totalPaisas: input.commission.totalPaisas, lines: input.commission.lines }
      : null,
  }
}
