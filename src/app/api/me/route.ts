/**
 * Returns the current session user (or 401). Used by the client to
 * decide whether to render the login view or the dashboard shell, and
 * to drive role-aware navigation.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ user: null }, { status: 200 })
  }
  const u = session.user as any
  return NextResponse.json({
    user: {
      id: u.id,
      email: u.email,
      displayName: u.displayName ?? u.name ?? u.email,
      roleName: u.roleName,
      roleId: u.roleId,
      businessId: u.businessId,
      profileId: u.profileId,
      permissions: u.permissions ?? [],
    },
  })
}
