/**
 * POST /api/riders/[id]/pay-earning — Pay rider delivery earnings.
 * Posts: Dr Rider Payable (2020), Cr Cash/Bank.
 * Only Owner/Accountant with can_confirm_cod_submission can post.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolveSupabaseUuid } from '@/lib/accounting/voucher-supabase'
import { bizDateString } from '@/lib/dates'
import { parseMoney } from '@/lib/format'

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const Schema = z.object({
  amount: z.string().min(1),
  accountId: z.string().min(1),
  notes: z.string().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_confirm_cod_submission')
  const { id: riderId } = await params
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  if (!isUuid(parsed.data.accountId)) return NextResponse.json({ error: 'Invalid account ID' }, { status: 400 })

  const amountPaisas = parseMoney(parsed.data.amount)
  if (amountPaisas === null || amountPaisas <= 0n) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  }

  const admin = getAdminSupabase()
  const supabaseCreatedBy = await resolveSupabaseUuid(su.userId)

  // Resolve Rider Payable (2020) and payment account
  const { data: payableAcct } = await admin.from('accounts').select('id').eq('business_id', su.businessId).eq('code', '2020').maybeSingle()
  if (!payableAcct) return NextResponse.json({ error: 'Rider Payable (2020) not found' }, { status: 500 })

  // Post voucher: Dr Rider Payable, Cr Cash/Bank
  const linesJson = [
    { account_id: payableAcct.id, debit: amountPaisas.toString(), credit: '0', memo: `Rider earning payment`, idx: 1 },
    { account_id: parsed.data.accountId, debit: '0', credit: amountPaisas.toString(), memo: `Paid to rider`, idx: 2 },
  ]
  const { data: voucherId, error: vErr } = await admin.rpc('post_voucher', {
    p_business_id: su.businessId, p_voucher_type: 'PM',
    p_voucher_date: bizDateString(new Date()),
    p_memo: `Rider Earning Payment — ${riderId}`,
    p_lines: linesJson,
    p_reference_id: riderId, p_reference_type: 'rider_earning_payment',
    p_posted_by: supabaseCreatedBy,
  })
  if (vErr) return NextResponse.json({ error: `post_voucher: ${vErr.message}` }, { status: 500 })

  // Audit
  await admin.from('audit_logs').insert({
    business_id: su.businessId, user_id: supabaseCreatedBy,
    action: 'PAY_RIDER_EARNING', entity: 'rider', entity_id: riderId,
    details: JSON.stringify({ amount: amountPaisas.toString(), voucher_id: voucherId, account_id: parsed.data.accountId }),
  })

  return NextResponse.json({ ok: true, voucherId })
}
