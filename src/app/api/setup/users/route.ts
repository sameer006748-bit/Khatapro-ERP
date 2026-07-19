/**
 * Users & roles — list users (Owner/Admin only), invite new user (Owner/Admin
 * only), and list roles. After first-owner bootstrap, the only way for new
 * users to enter the system is via this route.
 *
 * Per the prompt: "Further users must be created/invited by Owner/Admin."
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createAuthClient } from '@/lib/supabase/auth'
import { getAdminClient } from '@/lib/supabase/server-admin'
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

  if (!isSupabaseConfigured()) {
    // Local fallback
    const { db } = await import('@/lib/db')
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

  // Supabase mode. Owner-gated read → use the admin (service-role) client so
  // RLS on profiles/roles doesn't block the listing. The anon client returns
  // zero rows under RLS, which previously surfaced as a 500 FETCH_FAILED.
  const supabase = getAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 500 })
  }
  const { data: users, error: usersError }: any = await supabase
    .from('profiles')
    .select(`
      id, user_id, display_name, phone, is_active, created_at,
      role:roles (id, name)
    `)
    .eq('business_id', su.businessId)
    .order('created_at', { ascending: true })

  if (usersError) {
    return NextResponse.json({ error: 'FETCH_FAILED' }, { status: 500 })
  }

  // Emails live in Supabase auth (auth.users), which PostgREST cannot embed
  // from profiles. Resolve them via the admin auth API; degrade gracefully to
  // the user id if the lookup is unavailable rather than failing the listing.
  const emailById = new Map<string, string>()
  try {
    const admin = getAdminClient()
    if (admin) {
      const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      for (const au of authList?.users ?? []) {
        if (au.id && au.email) emailById.set(au.id, au.email)
      }
    }
  } catch {
    /* email is non-essential for the listing */
  }

  const { data: roles, error: rolesError }: any = await supabase
    .from('roles')
    .select(`
      id, name, is_system, description,
      permissions:role_permissions ( count ),
      profiles:profiles ( count )
    `)
    .eq('business_id', su.businessId)
    .order('name', { ascending: true })

  if (rolesError) {
    return NextResponse.json({ error: 'FETCH_FAILED' }, { status: 500 })
  }

  return NextResponse.json({
    users: (users || []).map((u: any) => ({
      id: u.user_id,
      email: emailById.get(u.user_id) ?? u.display_name ?? u.user_id,
      displayName: u.display_name,
      phone: u.phone,
      isActive: u.is_active,
      role: u.role ? { id: u.role.id, name: u.role.name } : null,
      createdAt: u.created_at,
    })),
    roles: (roles || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      isSystem: r.is_system,
      description: r.description,
      permissionsCount: r.permissions?.count ?? 0,
      usersCount: r.profiles?.count ?? 0,
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

  if (!isSupabaseConfigured()) {
    // Local fallback
    const { db } = await import('@/lib/db')
    const bcrypt = await import('bcryptjs')
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

  // Supabase mode
  const supabase = createAuthClient()
  const admin = getAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 500 })
  }

  const { data: role, error: roleError }: any = await supabase
    .from('roles')
    .select('id')
    .eq('business_id', su.businessId)
    .eq('name', roleName)
    .single()

  if (roleError || !role) {
    return NextResponse.json({ error: 'ROLE_NOT_FOUND' }, { status: 400 })
  }

  const { data: created, error: authCreateError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authCreateError || !created.user) {
    return NextResponse.json({ error: 'AUTH_USER_CREATE_FAILED' }, { status: 500 })
  }

  const newUserId = created.user.id

  const { error: profileError } = await supabase.from('profiles').insert({
    user_id: newUserId,
    business_id: su.businessId,
    role_id: role.id,
    display_name: displayName,
    phone: phone ?? null,
    is_active: true,
  })

  if (profileError) {
    try { await admin.auth.admin.deleteUser(newUserId) } catch {}
    return NextResponse.json({ error: 'PROFILE_CREATE_FAILED' }, { status: 500 })
  }

  await writeAudit({
    businessId: su.businessId,
    userId: su.userId,
    action: 'INVITE_USER',
    entity: 'user',
    entityId: newUserId,
    details: { email, displayName, roleName },
  })

  return NextResponse.json({ ok: true, userId: newUserId })
}