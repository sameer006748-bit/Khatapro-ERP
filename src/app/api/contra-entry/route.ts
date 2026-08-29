import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postContraBatch, postOperationalContra, type ContraBatchLine } from '@/lib/money/operational-money'
import { parseMoney } from '@/lib/format'
import { resolveRequestId, safeMutationError } from '@/lib/observability'
import { isSupabaseConfigured } from '@/lib/supabase/config'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

const LineSchema = z.object({
  kind: z.enum(['contra', 'drawings']),
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1).optional(),
  amount: z.string().min(1),
  notes: z.string().max(500).optional(),
})

const Schema = z.object({
  contraDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(LineSchema).min(1),
  reference: z.string().max(300).optional(),
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
  const lines: ContraBatchLine[] = []
  for (const l of parsed.data.lines) {
    const amountPaisas = parseMoney(l.amount)
    if (amountPaisas === null || amountPaisas <= 0n) return NextResponse.json({ error: 'Each line amount must be positive' }, { status: 400 })
    if (l.kind === 'contra') {
      if (!l.toAccountId) return NextResponse.json({ error: 'Destination account is required for a transfer' }, { status: 400 })
      if (l.fromAccountId === l.toAccountId) return NextResponse.json({ error: 'From and To accounts must differ' }, { status: 400 })
    }
    if (isSupabaseConfigured() && !isUuid(l.fromAccountId)) return NextResponse.json({ error: 'Invalid source account ID (not UUID)' }, { status: 400 })
    if (isSupabaseConfigured() && l.kind === 'contra' && l.toAccountId && !isUuid(l.toAccountId)) return NextResponse.json({ error: 'Invalid destination account ID (not UUID)' }, { status: 400 })
    lines.push({ kind: l.kind, fromAccountId: l.fromAccountId, toAccountId: l.toAccountId ?? null, amountPaisas, notes: l.notes ?? null })
  }
  try {
    // A single pure transfer keeps the live post_contra_entry path; a multi-row
    // batch or any drawings line requires 00038 (post_contra_batch).
    if (lines.length === 1 && lines[0].kind === 'contra') {
      const result = await postOperationalContra({
        businessId: su.businessId,
        actorProfileId: su.profileId,
        date: parsed.data.contraDate,
        sourceAccountId: lines[0].fromAccountId,
        destinationAccountId: lines[0].toAccountId as string,
        amountPaisas: lines[0].amountPaisas,
        note: lines[0].notes ?? null,
        idempotencyKey: parsed.data.idempotencyKey,
      })
      return NextResponse.json({ ok: true, reference: result.reference, idempotent: result.idempotent })
    }
    const result = await postContraBatch({
      businessId: su.businessId,
      actorProfileId: su.profileId,
      date: parsed.data.contraDate,
      lines,
      reference: parsed.data.reference ?? null,
      note: parsed.data.notes ?? null,
      idempotencyKey: parsed.data.idempotencyKey,
    })
    return NextResponse.json({ ok: true, reference: result.batchNo, batch_id: result.batchId, total: result.total, idempotent: result.idempotent })
  } catch (error) {
    return safeMutationError({ route: '/api/contra-entry', requestId, errorCode: 'CONTRA_ENTRY_FAILED', userMessage: 'The contra entry could not be posted.', error })
  }
}
