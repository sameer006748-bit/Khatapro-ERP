/**
 * Returns the current session user (or 401). Used by the client to
 * decide whether to render the login view or the dashboard shell, and
 * to drive role-aware navigation.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser } from '@/lib/auth/permissions'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ user: null }, { status: 200 })
  }

  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) {
    return NextResponse.json({ user: null }, { status: 200 })
  }

  return NextResponse.json({
    user: {
      id: loaded.userId,
      email: loaded.email,
      displayName: loaded.displayName,
      roleName: loaded.roleName,
      roleId: loaded.roleId,
      businessId: loaded.businessId,
      profileId: loaded.profileId,
      permissions: Array.from(loaded.permissions),
      phone: loaded.phone ?? null,
    },
  })
}
