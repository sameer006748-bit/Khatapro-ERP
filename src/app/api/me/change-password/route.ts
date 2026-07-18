/**
 * Change password for the currently authenticated user.
 *
 * Supports both local (Prisma/SQLite) and Supabase Auth modes.
 * Requires current password verification before updating.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { getAdminClient } from '@/lib/supabase/server-admin'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser } from '@/lib/auth/permissions'

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
})

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = ChangePasswordSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors
    const msg = first.currentPassword?.[0] || first.newPassword?.[0] || 'Invalid input'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const { currentPassword, newPassword } = parsed.data

  if (!isSupabaseConfigured()) {
    // Local: verify current password hash, then update
    const { db } = await import('@/lib/db')
    const u = await db.user.findUnique({ where: { id: loaded.userId } })
    if (!u) return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 })

    const bcrypt = await import('bcryptjs')
    const ok = await bcrypt.compare(currentPassword, u.passwordHash)
    if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 })

    const newHash = await bcrypt.hash(newPassword, 10)
    await db.user.update({ where: { id: loaded.userId }, data: { passwordHash: newHash } })
    return NextResponse.json({ ok: true })
  }

  // Supabase: verify by signing in, then update with admin client
  const supabaseAuth = (await import('@/lib/supabase/auth')).createAuthClient()
  const verify = await supabaseAuth.auth.signInWithPassword({
    email: loaded.email,
    password: currentPassword,
  })
  if (verify.error) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 })

  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'ADMIN_UNAVAILABLE' }, { status: 500 })

  const { error } = await admin.auth.admin.updateUserById(loaded.userId, { password: newPassword })
  if (error) return NextResponse.json({ error: 'Failed to update password' }, { status: 500 })

  return NextResponse.json({ ok: true })
}