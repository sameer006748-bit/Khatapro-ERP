import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission, hasPermission } from '@/lib/auth/permissions'
import { createCodSubmission, listCodSubmissions, getRiderByUserId } from '@/lib/delivery/data-access'
import { parseMoney } from '@/lib/format'
import { resolveRequestId, safeMutationError, withObservability } from '@/lib/observability'

const ItemSchema = z.object({ deliveryOrderId: z.string().min(1), amountAllocated: z.string().min(1), riderFeeDeducted: z.string().optional() })
const Schema = z.object({ riderId: z.string().min(1), items: z.array(ItemSchema).min(1), settlementMode: z.enum(['full', 'net']), requestedAmount: z.string().min(1), notes: z.string().optional() })

async function getCodSubmissionRows() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!hasPermission(loaded, 'can_view_cod_settlements') && !hasPermission(loaded, 'can_create_cod_submission')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  let riderFilter: string | null = null
  if (loaded.roleName === 'Rider') {
    const rider = await getRiderByUserId(loaded.businessId, loaded.userId)
    if (!rider) return NextResponse.json({ rows: [] })
    riderFilter = rider.id
  }
  const rows = await listCodSubmissions(loaded.businessId, riderFilter)
  return NextResponse.json({ rows })
}

export const GET = withObservability('/api/cod-submission', getCodSubmissionRows)

export async function POST(req: Request) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_cod_submission')
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  // If rider, resolve their own riderId
  let riderId = parsed.data.riderId
  if (su.roleName === 'Rider') {
    const ownRider = await getRiderByUserId(su.businessId, su.userId)
    if (!ownRider || ownRider.id !== riderId) return NextResponse.json({ error: 'FORBIDDEN: rider can only submit own COD' }, { status: 403 })
  }
  const requestedAmount = parseMoney(parsed.data.requestedAmount)
  if (requestedAmount === null || requestedAmount <= 0n) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  try {
    const result = await createCodSubmission({
      businessId: su.businessId, riderId, items: parsed.data.items.map(it => ({
        deliveryOrderId: it.deliveryOrderId, amountAllocated: parseMoney(it.amountAllocated)!, riderFeeDeducted: it.riderFeeDeducted ? parseMoney(it.riderFeeDeducted) ?? 0n : 0n,
      })), settlementMode: parsed.data.settlementMode, requestedAmount, notes: parsed.data.notes ?? null, createdBy: su.userId,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return safeMutationError({ route: '/api/cod-submission', requestId, errorCode: 'COD_SUBMISSION_FAILED', userMessage: 'The COD submission could not be created.', error })
  }
}
