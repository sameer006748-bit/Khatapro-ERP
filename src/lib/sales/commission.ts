/**
 * Product-wise per-piece commission calculation.
 *
 * Approved policy (do not reinterpret):
 * - Commission eligibility is product-wise.
 * - Each product has a fixed whole-rupee per-piece commission rate (stored as paisas).
 * - Eligibility = sold quantity × product per-piece commission rate.
 * - Commission is earned when payment/collection is received.
 * - Partial collection earns commission proportionally.
 * - Duplicate payment/collection must not earn duplicate commission.
 * - For now, sale returns do not reverse already earned commission.
 * - Seller attribution is server-controlled.
 * - Owner attribution remains separate from Drawings.
 */
import 'server-only'
import { db } from '@/lib/db'

export type CommissionEligibilityInput = {
  productId: string | null
  qty: number
}

export type CommissionEligibilityResult = {
  productId: string | null
  qty: number
  ratePaisas: bigint
  eligibleAmount: bigint
}

/**
 * Calculate per-piece commission eligibility for a set of invoice items.
 * Looks up each product's fixed commissionRate (paisas per piece).
 * Products with null/zero commissionRate yield zero eligibility.
 * Temporary products (no productId) yield zero eligibility.
 */
export async function calculateCommissionEligibility(
  businessId: string,
  items: CommissionEligibilityInput[],
): Promise<CommissionEligibilityResult[]> {
  const results: CommissionEligibilityResult[] = []

  for (const item of items) {
    if (!item.productId) {
      results.push({ productId: null, qty: item.qty, ratePaisas: 0n, eligibleAmount: 0n })
      continue
    }

    const product = await db.product.findFirst({
      where: { id: item.productId, businessId },
      select: { commissionRate: true },
    })

    const ratePaisas = product?.commissionRate ?? 0n
    const eligibleAmount = ratePaisas * BigInt(item.qty)

    results.push({
      productId: item.productId,
      qty: item.qty,
      ratePaisas,
      eligibleAmount,
    })
  }

  return results
}

/**
 * Calculate proportional earned commission given a collection amount
 * against a total invoice amount and total commission eligibility.
 *
 * Returns the earned amount in paisas, with deterministic rounding.
 * On final collection (collected >= total), closes any rounding residue.
 */
export function calculateProportionalEarned(
  totalEligibility: bigint,
  invoiceTotal: bigint,
  collectedAmount: bigint,
  priorEarned: bigint,
): bigint {
  if (totalEligibility <= 0n || invoiceTotal <= 0n || collectedAmount <= 0n) return 0n

  // If this is the final collection (collected >= total), earn remaining eligibility
  if (collectedAmount >= invoiceTotal) {
    const remaining = totalEligibility - priorEarned
    return remaining > 0n ? remaining : 0n
  }

  // Proportional earning: (collectedAmount / invoiceTotal) * totalEligibility
  // Use integer arithmetic: earned = (collectedAmount * totalEligibility) / invoiceTotal
  const proportionalEarned = (collectedAmount * totalEligibility) / invoiceTotal

  // Subtract prior earned to get incremental earned
  const incremental = proportionalEarned - priorEarned
  return incremental > 0n ? incremental : 0n
}

/**
 * Create a CommissionEvent record for earned commission.
 * Idempotent: if an event with the same idempotencyKey exists, returns existing.
 */
export async function createCommissionEvent(input: {
  businessId: string
  salesmanId: string | null
  invoiceId: string
  invoiceItemId: string
  eventType: 'calculated' | 'earned' | 'payable' | 'paid' | 'reversal'
  quantity: number
  ratePaisas: bigint
  grossAmount: bigint
  eligibleAmount: bigint
  payableAmount: bigint
  paidAmount?: bigint
  status: string
  idempotencyKey?: string
  isOwnerOnly?: boolean
}): Promise<{ id: string; created: boolean }> {
  // Check idempotency
  if (input.idempotencyKey) {
    const existing = await db.commissionEvent.findFirst({
      where: { businessId: input.businessId, idempotencyKey: input.idempotencyKey },
    })
    if (existing) return { id: existing.id, created: false }
  }

  const event = await db.commissionEvent.create({
    data: {
      businessId: input.businessId,
      salesmanId: input.salesmanId,
      invoiceId: input.invoiceId,
      invoiceItemId: input.invoiceItemId,
      eventType: input.eventType,
      quantity: input.quantity,
      ratePaisas: input.ratePaisas,
      grossAmount: input.grossAmount,
      eligibleAmount: input.eligibleAmount,
      payableAmount: input.payableAmount,
      paidAmount: input.paidAmount ?? 0n,
      status: input.status,
      idempotencyKey: input.idempotencyKey ?? null,
      isOwnerOnly: input.isOwnerOnly ?? false,
    },
  })

  return { id: event.id, created: true }
}