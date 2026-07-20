import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, hasPermission } from '@/lib/auth/permissions'
import { listVendors, createVendor } from '@/lib/purchases/data-access'
import { resolveRequestId, safeMutationError, withObservability } from '@/lib/observability'

const getVendors = async () => {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await loadSessionUser((session.user as any).id)
  if (!su) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!hasPermission(su, 'can_view_purchases') && !hasPermission(su, 'can_create_purchases')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const rows = await listVendors(su.businessId)
  return NextResponse.json({ rows })
}

export const GET = withObservability('/api/vendors', getVendors)

const Schema = z.object({ name: z.string().min(1), phone: z.string().optional(), email: z.string().optional(), address: z.string().optional(), city: z.string().optional() })

export async function POST(req: Request) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_purchases')
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  try { const row = await createVendor(su.businessId, parsed.data.name, parsed.data.phone, parsed.data.email, parsed.data.address, parsed.data.city); return NextResponse.json({ row }) }
  catch (error) { return safeMutationError({ route: '/api/vendors', requestId, errorCode: 'VENDOR_CREATE_FAILED', userMessage: 'The vendor could not be created.', error }) }
}
