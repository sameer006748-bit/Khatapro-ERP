/**
 * Owner/Admin password reset for another user.
 * Server-side only — never exposes service-role key to client.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { getAdminClient } from '@/lib/supabase/server-admin'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requireOwner } from '@/lib/auth/permissions'

const ResetSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
})

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const su = await requireOwner(loaded)

  const body = await req.json().catch(() => null)
  const parsed = ResetSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors
    const msg = first.newPassword?.[0] || first.userId?.[0] || 'Invalid input'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const { userId, newPassword } = parsed.data

  // Prevent self-reset through admin panel (use My Profile instead)
  if (userId === su.userId) {
    return NextResponse.json({ error: 'Use My Profile to change your own password' }, { status: 400 })
  }

  if (!isSupabaseConfigured()) {
    const { db } = await import('@/lib/db')

    // Prevent resetting the last active Owner/Admin
    const targetUser = await db.user.findUnique({
      where: { id: userId },
      include: { profile: { include: { role: true } } },
    })
    if (!targetUser || !targetUser.profile) {
      return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 })
    }
    if (!targetUser.profile.isActive) {
      return NextResponse.json({ error: 'Cannot reset password for inactive user' }, { status: 400 })
    }

    if (targetUser.profile.role.name === 'Owner/Admin') {
      const ownerRole = await db.role.findFirst({ where: { name: 'Owner/Admin' } })
      if (ownerRole) {
        const ownerCount = await db.profile.count({
          where: { roleId: ownerRole.id, isActive: true, userId: { not: userId } },
        })
        if (ownerCount === 0) {
          return NextResponse.json({ error: 'Cannot reset the last active Owner/Admin — the business would be locked out' }, { status: 403 })
        }
      }
    }

    const bcrypt = await import('bcryptjs')
    const hash = await bcrypt.hash(newPassword, 10)
    await db.user.update({ where: { id: userId }, data: { passwordHash: hash } })
    return NextResponse.json({ ok: true })
  }

  // Supabase mode
  const admin = getAdminClient()
  if (!admin) return NextResponse.json({ error: 'ADMIN_UNAVAILABLE' }, { status: 500 })

  // Fetch target user profile
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, is_active, role_id, roles(id, name)')
    .eq('user_id', userId)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 })
  }
  if (!profile.is_active) {
    return NextResponse.json({ error: 'Cannot reset password for inactive user' }, { status: 400 })
  }

  const roleName: string = (profile as any).roles?.name ?? ''
  if (roleName === 'Owner/Admin') {
    const { data: ownerRole } = await admin
      .from('roles')
      .select('id')
      .eq('name', 'Owner/Admin')
      .single()

    if (ownerRole) {
      const { count, error: countError } = await admin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .eq('role_id', ownerRole.id)
        .neq('user_id', userId)

      if (!countError && (count ?? 0) === 0) {
        return NextResponse.json({ error: 'Cannot reset the last active Owner/Admin — the business would be locked out' }, { status: 403 })
      }
    }
  }

  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
  if (error) return NextResponse.json({ error: 'RESET_FAILED' }, { status: 500 })

  return NextResponse.json({ ok: true })
}