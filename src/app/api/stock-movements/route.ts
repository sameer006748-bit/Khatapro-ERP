/**
 * POST /api/stock-movements — create a stock movement (can_create_products)
 * GET /api/stock-movements — list stock movements (can_view_products)
 *
 * Movement types: opening, adjustment_in, adjustment_out, temporary_item, correction
 * Negative stock is ALLOWED — no blocking on stock-out.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { createStockMovement, listStockMovements } from '@/lib/products/data-access'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const MovementTypes = ['opening', 'adjustment_in', 'adjustment_out', 'temporary_item', 'correction'] as const

const CreateSchema = z.object({
  productId: z.string().min(1),
  movementType: z.enum(MovementTypes),
  quantity: z.number().int().positive(),
  reason: z.string().max(200).optional(),
})

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_products')

  const body = await req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  }

  const requestId = resolveRequestId(req)
  try {
    const result = await createStockMovement(su.businessId, {
      productId: parsed.data.productId,
      movementType: parsed.data.movementType,
      quantity: parsed.data.quantity,
      reason: parsed.data.reason,
      createdBy: su.userId,
    })
    return NextResponse.json({ ok: true, id: result.id, balanceAfter: result.balanceAfter })
  } catch (e) {
    return safeMutationError({
      route: '/api/stock-movements',
      requestId,
      errorCode: 'STOCK_MOVEMENT_FAILED',
      userMessage: 'Stock movement could not be recorded.',
      error: e,
    })
  }
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_view_products')

  const url = new URL(req.url)
  const productId = url.searchParams.get('productId') || undefined

  const rows = await listStockMovements(su.businessId, productId)
  return NextResponse.json({ rows })
}
