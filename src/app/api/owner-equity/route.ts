import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth/authOptions'
import { hasPermission, isOwner, loadSessionUser } from '@/lib/auth/permissions'
import { parseMoney } from '@/lib/format'
import { postOwnerCapital, postOwnerDrawings } from '@/lib/money/operational-money'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const Schema = z.object({
  action: z.enum(['capital', 'drawings']),
  accountId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string().min(1),
  note: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid(),
})

export async function POST(request: Request) {
  const requestId = resolveRequestId(request)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  // The current product grants this flow to Owner/Admin.  Accountant remains
  // server-denied unless an explicit future can_manage_owner_equity permission exists.
  if (!isOwner(loaded) && !hasPermission(loaded, 'can_manage_owner_equity')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const parsed = Schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  const amountPaisas = parseMoney(parsed.data.amount)
  if (amountPaisas === null || amountPaisas <= 0n) return NextResponse.json({ error: 'INVALID_AMOUNT' }, { status: 400 })
  const common = {
    businessId: loaded.businessId,
    actorProfileId: loaded.profileId,
    amountPaisas,
    date: parsed.data.date,
    note: parsed.data.note ?? null,
    idempotencyKey: parsed.data.idempotencyKey,
  }
  try {
    const result = parsed.data.action === 'capital'
      ? await postOwnerCapital({ ...common, destinationAccountId: parsed.data.accountId })
      : await postOwnerDrawings({ ...common, sourceAccountId: parsed.data.accountId })
    return NextResponse.json({ ok: true, action: parsed.data.action, ...result })
  } catch (error) {
    return safeMutationError({ route: '/api/owner-equity', requestId, errorCode: 'OWNER_EQUITY_POST_FAILED', userMessage: 'The owner capital or drawings transaction could not be posted.', error })
  }
}
