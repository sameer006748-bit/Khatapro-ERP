import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postVendorAdvance } from '@/lib/purchases/data-access'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const Schema = z.object({ vendorId: z.string().min(1), accountId: z.string().min(1), amountPaisas: z.string().min(1), notes: z.string().optional() })

export async function POST(req: Request) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_pay_vendors')
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  if (!isUuid(parsed.data.accountId)) return NextResponse.json({ error: 'Invalid account ID (not UUID)' }, { status: 400 })
  try {
    const id = await postVendorAdvance({ businessId: su.businessId, vendorId: parsed.data.vendorId, accountId: parsed.data.accountId, amountPaisas: BigInt(parsed.data.amountPaisas), notes: parsed.data.notes ?? null, createdBy: su.userId })
    return NextResponse.json({ ok: true, paymentId: id })
  } catch (error) { return safeMutationError({ route: '/api/vendor-advance', requestId, errorCode: 'VENDOR_ADVANCE_FAILED', userMessage: 'The vendor advance could not be posted.', error }) }
}
