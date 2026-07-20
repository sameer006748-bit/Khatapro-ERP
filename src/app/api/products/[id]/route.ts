/**
 * PATCH /api/products/[id] — update product (can_edit_products)
 * Used for: editing name/prices, marking temporary items for merge,
 * activating/deactivating.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { updateProduct } from '@/lib/products/data-access'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const UpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  categoryId: z.string().nullable().optional(),
  salePrice: z.number().min(0).optional(),
  purchasePrice: z.number().min(0).optional(),
  isTemporary: z.boolean().optional(),
  isActive: z.boolean().optional(),
  markedForMerge: z.boolean().optional(),
  lowStockThreshold: z.number().int().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_edit_products')

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    await updateProduct(su.businessId, id, parsed.data)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return safeMutationError({ route: '/api/products/[id]', requestId, errorCode: 'PRODUCT_UPDATE_FAILED', userMessage: 'The product could not be updated.', error })
  }
}
