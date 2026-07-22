/**
 * GET /api/products — list products (optional ?temporary=true&search=foo)
 * POST /api/products — create product (can_create_products)
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { listProducts, createProduct } from '@/lib/products/data-access'
import { SafeProductError } from '@/lib/products/opening-stock'
import { withObservability, resolveRequestId, safeMutationError } from '@/lib/observability'

export const GET = withObservability('/api/products', async (req: Request) => {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const url = new URL(req.url)
  const temporaryOnly = url.searchParams.get('temporary') === 'true'
  const search = url.searchParams.get('search') || undefined

  const rows = await listProducts(su.businessId, { temporaryOnly, search })
  return NextResponse.json({ rows })
})

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  categoryId: z.string().nullable().optional(),
  salePrice: z.number().min(0).optional(),
  purchasePrice: z.number().min(0).optional(),
  openingStock: z.number().int().min(0).optional(),
  isTemporary: z.boolean().optional(),
  lowStockThreshold: z.number().int().optional(),
  commissionRatePaisas: z.string().regex(/^\d+$/).optional(),
  idempotencyKey: z.string().max(128).optional(),
})

export async function POST(req: Request) {
  const requestId = resolveRequestId(req)
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

  try {
    const result = await createProduct(su.businessId, {
      ...parsed.data,
      idempotencyKey: parsed.data.idempotencyKey ?? undefined,
      commissionRatePaisas: parsed.data.commissionRatePaisas === undefined ? undefined : BigInt(parsed.data.commissionRatePaisas),
      createdBy: su.userId,
    })
    return NextResponse.json(
      { row: result.product, stockMovementId: result.stockMovementId },
      { headers: { 'X-Request-Id': requestId } },
    )
  } catch (e) {
    if (e instanceof SafeProductError) {
      // The product was created but opening stock rolled back completely. The
      // The user message is safe to show as-is. Logs contain the stable error
      // code and request ID only; the raw RPC/Postgres diagnostic is never
      // serialized.
      return safeMutationError({
        route: '/api/products',
        requestId,
        errorCode: 'OPENING_STOCK_FAILED',
        userMessage: e.message,
        error: e.diagnostic ?? e.message,
        status: 400,
      })
    }
    return safeMutationError({
      route: '/api/products',
      requestId,
      errorCode: 'PRODUCT_CREATE_FAILED',
      userMessage: 'Failed to create product. Please try again.',
      error: e,
      status: 500,
    })
  }
}
