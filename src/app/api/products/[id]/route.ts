/**
 * PATCH /api/products/[id] — update product (can_edit_products)
 * Used for: editing name/prices, marking temporary items for merge,
 * activating/deactivating.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, writeAudit } from '@/lib/auth/permissions'
import { listProducts, updateProduct } from '@/lib/products/data-access'
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
  commissionRatePaisas: z.string().regex(/^\d+$/).nullable().optional(),
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
    const existing = (await listProducts(su.businessId)).find(product => product.id === id)
    if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    await updateProduct(su.businessId, id, { ...parsed.data, commissionRatePaisas: parsed.data.commissionRatePaisas === undefined ? undefined : parsed.data.commissionRatePaisas === null ? null : BigInt(parsed.data.commissionRatePaisas) })
    const action = parsed.data.isActive === false ? 'DEACTIVATE' : parsed.data.isActive === true && !existing.isActive ? 'REACTIVATE' : 'UPDATE'
    await writeAudit({
      businessId: su.businessId,
      userId: su.userId,
      action,
      entity: 'product',
      entityId: id,
      details: { name: existing.name, before: { name: existing.name, isActive: existing.isActive, salePrice: existing.salePrice, purchasePrice: existing.purchasePrice }, after: parsed.data },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return safeMutationError({ route: '/api/products/[id]', requestId, errorCode: 'PRODUCT_UPDATE_FAILED', userMessage: 'The product could not be updated.', error })
  }
}
