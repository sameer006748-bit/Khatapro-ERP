import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import { settleRiderCod } from '@/lib/delivery/data-access'
import { parseMoney } from '@/lib/format'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const Schema = z.object({ riderId: z.string().uuid(), amount: z.string().min(1), mode: z.string().min(1).max(40), note: z.string().max(500).optional(), idempotencyKey: z.string().uuid() })

export async function POST(request: Request) {
  const requestId = resolveRequestId(request)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded || loaded.roleName === 'Rider' || !hasPermission(loaded, 'can_confirm_cod_submission')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const parsed = Schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  const amount = parseMoney(parsed.data.amount)
  if (amount === null || amount <= 0n) return NextResponse.json({ error: 'INVALID_AMOUNT' }, { status: 400 })
  try {
    const result = await settleRiderCod({ businessId: loaded.businessId, riderId: parsed.data.riderId, amount, mode: parsed.data.mode, note: parsed.data.note, idempotencyKey: parsed.data.idempotencyKey })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return safeMutationError({ route: '/api/rider-cod/settle', requestId, errorCode: 'RIDER_COD_SETTLEMENT_FAILED', userMessage: 'The rider COD settlement could not be posted.', error })
  }
}
