import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postOperationalContra } from '@/lib/money/operational-money'
import { parseMoney } from '@/lib/format'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const Schema = z.object({
  contraDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: z.string().min(1),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid(),
})

export async function POST(req: Request) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_contra')
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  if (parsed.data.fromAccountId === parsed.data.toAccountId) return NextResponse.json({ error: 'From and To accounts must differ' }, { status: 400 })
  const amountPaisas = parseMoney(parsed.data.amount)
  if (amountPaisas === null || amountPaisas <= 0n) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  try {
    const result = await postOperationalContra({
      businessId: su.businessId,
      actorProfileId: su.profileId,
      date: parsed.data.contraDate,
      sourceAccountId: parsed.data.fromAccountId,
      destinationAccountId: parsed.data.toAccountId,
      amountPaisas,
      note: parsed.data.notes ?? null,
      idempotencyKey: parsed.data.idempotencyKey,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return safeMutationError({ route: '/api/contra-entry', requestId, errorCode: 'CONTRA_ENTRY_FAILED', userMessage: 'The contra entry could not be posted.', error })
  }
}
