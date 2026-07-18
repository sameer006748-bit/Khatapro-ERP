/**
 * Update the authenticated user's profile (phone only for now).
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { getAdminClient } from '@/lib/supabase/server-admin'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser } from '@/lib/auth/permissions'

const PatchSchema = z.object({
  phone: z.string().max(40).nullable().optional(),
})

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  }

  const { phone } = parsed.data

  if (!isSupabaseConfigured()) {
    const { db } = await import('@/lib/db')
    await db.profile.update({
      where: { id: loaded.profileId },
      data: { phone: phone ?? null },
    })
    return NextResponse.json({ ok: true })
  }

  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'ADMIN_UNAVAILABLE' }, { status: 500 })

  const { error } = await admin
    .from('profiles')
    .update({ phone: phone ?? null })
    .eq('id', loaded.profileId)

  if (error) return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  return NextResponse.json({ ok: true })
}