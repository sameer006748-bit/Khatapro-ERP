import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { updateVendor } from '@/lib/purchases/data-access'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const Schema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_purchases')
  const { id: vendorId } = await params
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  try {
    const row = await updateVendor(su.businessId, vendorId, parsed.data)
    if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    return NextResponse.json({ row })
  } catch (error) { return safeMutationError({ route: '/api/vendors/[id]', requestId, errorCode: 'VENDOR_UPDATE_FAILED', userMessage: 'The vendor could not be updated.', error }) }
}
