import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requirePermission } from '@/lib/auth/permissions'
import { postAdvanceApplication } from '@/lib/purchases/data-access'
import { resolveRequestId, safeMutationError } from '@/lib/observability'

const Schema = z.object({
  vendorId: z.string().min(1),
  amountPaisas: z.string().min(1),
  applicationDate: z.string().optional(),
  notes: z.string().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requirePermission(loaded, 'can_pay_vendors')
  const { id: purchaseId } = await params
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  try {
    const ppId = await postAdvanceApplication({
      businessId: su.businessId,
      vendorId: parsed.data.vendorId,
      purchaseId,
      amountPaisas: BigInt(parsed.data.amountPaisas),
      applicationDate: parsed.data.applicationDate ? new Date(parsed.data.applicationDate) : new Date(),
      notes: parsed.data.notes ?? null,
      createdBy: su.userId,
    })
    return NextResponse.json({ ok: true, paymentId: ppId })
  } catch (error) { return safeMutationError({ route: '/api/purchases/[id]/apply-advance', requestId, errorCode: 'ADVANCE_APPLICATION_FAILED', userMessage: 'The vendor advance could not be applied.', error }) }
}
