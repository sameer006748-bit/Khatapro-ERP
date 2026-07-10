import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postJournalVoucher } from '@/lib/vouchers/data-access'
import { parseMoney } from '@/lib/format'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const LineSchema = z.object({
  accountId: z.string().min(1),
  debit: z.string().optional(),
  credit: z.string().optional(),
  memo: z.string().optional(),
})
const Schema = z.object({
  jvDate: z.string(),
  memo: z.string().optional(),
  lines: z.array(LineSchema).min(2),
  reference: z.string().optional(),
})

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_create_journal_voucher')
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })

  // Validate + parse lines
  let totalDebit = 0n; let totalCredit = 0n
  const linesOut: Array<{ accountId: string; debit: bigint; credit: bigint; memo?: string | null }> = []
  for (let i = 0; i < parsed.data.lines.length; i++) {
    const l = parsed.data.lines[i]
    if (!isUuid(l.accountId)) return NextResponse.json({ error: `Invalid account ID on line ${i + 1}` }, { status: 400 })
    const debit = l.debit ? parseMoney(l.debit) : 0n
    const credit = l.credit ? parseMoney(l.credit) : 0n
    if (debit === null || credit === null) return NextResponse.json({ error: `Invalid money format on line ${i + 1}` }, { status: 400 })
    if (debit === 0n && credit === 0n) return NextResponse.json({ error: `Line ${i + 1} cannot be zero-value` }, { status: 400 })
    if (debit > 0n && credit > 0n) return NextResponse.json({ error: `Line ${i + 1} cannot have both debit and credit` }, { status: 400 })
    totalDebit += debit; totalCredit += credit
    linesOut.push({ accountId: l.accountId, debit, credit, memo: l.memo ?? null })
  }
  if (totalDebit !== totalCredit) return NextResponse.json({ error: `Unbalanced: debit ${totalDebit} ≠ credit ${totalCredit}` }, { status: 400 })
  if (totalDebit === 0n) return NextResponse.json({ error: 'Zero-value voucher not allowed' }, { status: 400 })

  try {
    const result = await postJournalVoucher({
      businessId: su.businessId,
      jvDate: new Date(parsed.data.jvDate),
      memo: parsed.data.memo ?? 'Journal Voucher',
      lines: linesOut,
      reference: parsed.data.reference ?? null,
      createdBy: su.userId,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}
