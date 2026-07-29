/**
 * Shared HTTP shaping for the sale channels (Counter, Online, OFC, Other).
 *
 * Business-rule rejections and migration-dependent features are the operator's
 * to act on, so they must surface their exact reason. Everything else keeps the
 * existing safe generic-error behaviour.
 */
import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { SaleLineError } from '@/lib/sales/sale-engine'
import { UnsupportedDatabaseFeatureError } from '@/lib/supabase/rpc-compatibility'

/** One bill row as accepted by every sale channel. */
export const SaleItemSchema = z.object({
  productId: z.string().nullable().optional(),
  productName: z.string().min(1),
  // Zero sold quantity is valid ONLY on a referenced historical-return row;
  // the shared engine enforces that pairing.
  qty: z.number().int().min(0),
  returnedQty: z.number().int().min(0).optional(),
  unitPrice: z.string().min(1),
  isTemporary: z.boolean().optional(),
  originalInvoiceItemId: z.string().min(1).nullable().optional(),
})

export const SellerRoleSchema = z.enum(['OWNER', 'SALESMAN'])

/**
 * Map a sale-posting failure to a response, or return null when the caller
 * should apply its own generic handling.
 */
export function saleRuleErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof SaleLineError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof UnsupportedDatabaseFeatureError) {
    return NextResponse.json({ error: error.message, setupRequired: true }, { status: 409 })
  }
  return null
}
