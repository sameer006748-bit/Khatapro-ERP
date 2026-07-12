import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { confirmCodSubmission } from '@/lib/delivery/data-access'
import { parseMoney } from '@/lib/format'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const Schema = z.object({
  confirmedCashAmount: z.string().min(1),
  receivedIntoAccountId: z.string().min(1),
  riderFeeDeduction: z.string().optional(),
  notes: z.string().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  // Rider CANNOT confirm their own submission
  if (loaded.roleName === 'Rider') return NextResponse.json({ error: 'FORBIDDEN: riders cannot confirm COD submissions' }, { status: 403 })
  const su = await requirePermission(loaded, 'can_confirm_cod_submission')
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  if (!isUuid(parsed.data.receivedIntoAccountId)) return NextResponse.json({ error: 'Invalid account ID' }, { status: 400 })
  const cashAmount = parseMoney(parsed.data.confirmedCashAmount)
  if (cashAmount === null || cashAmount <= 0n) return NextResponse.json({ error: 'Invalid cash amount' }, { status: 400 })
  const feeDeduction = parsed.data.riderFeeDeduction ? parseMoney(parsed.data.riderFeeDeduction) ?? 0n : 0n
  try {
    const result = await confirmCodSubmission({
      businessId: su.businessId, submissionId: id, confirmedCashAmount: cashAmount,
      receivedIntoAccountId: parsed.data.receivedIntoAccountId, riderFeeDeduction: feeDeduction,
      notes: parsed.data.notes ?? null, confirmedBy: su.userId,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}
