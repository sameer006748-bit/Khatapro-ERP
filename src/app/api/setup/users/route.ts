/**
 * Users & roles — list users (Owner/Admin only), invite new user (Owner/Admin
 * only), and list roles. After first-owner bootstrap, the only way for new
 * users to enter the system is via this route.
 *
 * Per the prompt: "Further users must be created/invited by Owner/Admin."
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requireOwner, writeAudit } from '@/lib/auth/permissions'

const InviteSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(6).max(72),
  displayName: z.string().min(1).max(80),
  roleName: z.enum(['Owner/Admin', 'Accountant', 'Salesman', 'Rider']),
  phone: z.string().max(40).optional(),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requireOwner(loaded)

  const [users, roles] = await Promise.all([
    db.user.findMany({
      include: { profile: { include: { role: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.role.findMany({
      where: { businessId: su.businessId },
      include: { _count: { select: { permissions: true, profiles: true } } },
      orderBy: { name: 'asc' },
    }),
  ])

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.profile?.displayName ?? u.email,
      phone: u.profile?.phone ?? null,
      isActive: u.profile?.isActive ?? false,
      role: u.profile?.role
        ? { id: u.profile.role.id, name: u.profile.role.name }
        : null,
      createdAt: u.createdAt,
    })),
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      isSystem: r.isSystem,
      description: r.description,
      permissionsCount: r._count.permissions,
      usersCount: r._count.profiles,
    })),
  })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requireOwner(loaded)

  const body = await req.json().catch(() => null)
  const parsed = InviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  }
  const { email, password, displayName, roleName, phone } = parsed.data

  const existing = await db.user.findUnique({ where: { email } })
  if (existing) return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 })

  const role = await db.role.findFirst({
    where: { businessId: su.businessId, name: roleName },
  })
  if (!role) return NextResponse.json({ error: 'ROLE_NOT_FOUND' }, { status: 400 })

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await db.user.create({ data: { email, name: displayName, passwordHash } })
  await db.profile.create({
    data: {
      userId: user.id,
      businessId: su.businessId,
      roleId: role.id,
      displayName,
      phone: phone ?? null,
    },
  })

  await writeAudit({
    businessId: su.businessId,
    userId: su.userId,
    action: 'INVITE_USER',
    entity: 'user',
    entityId: user.id,
    details: { email, displayName, roleName },
  })

  return NextResponse.json({ ok: true, userId: user.id })
}
