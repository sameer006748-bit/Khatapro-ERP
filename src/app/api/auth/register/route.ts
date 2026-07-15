/**
 * First-owner bootstrap registration.
 *
 * Rules (Prompt Section 3.2):
 * 1. If no Owner/Admin exists yet, first registrant becomes Owner/Admin.
 * 2. Once owner exists, public self-registration closes.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createAuthClient } from '@/lib/supabase/auth'
import { getAdminClient } from '@/lib/supabase/server-admin'
import { noOwnerExists, writeAudit } from '@/lib/auth/permissions'

const Schema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(6).max(72),
  displayName: z.string().min(1).max(80),
  businessName: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional(),
})

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
  }
  const { email, password, displayName, phone } = parsed.data
  const businessId = 'biz-default'

  const bootstrap = await noOwnerExists()
  if (!bootstrap) {
    return NextResponse.json(
      { error: 'REGISTRATION_CLOSED', message: 'Owner already exists. Ask the Owner/Admin to invite you.' },
      { status: 403 },
    )
  }

  if (!isSupabaseConfigured()) {
    // Local dev fallback (SQLite/Prisma)
    const { db } = await import('@/lib/db')
    const bcrypt = await import('bcryptjs')

    const existing = await db.user.findUnique({ where: { email } })
    if (existing) return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 })

    const passwordHash = await bcrypt.hash(password, 10)
    const ownerRole = await db.role.findFirst({
      where: { businessId, name: 'Owner/Admin', isSystem: true },
    })
    if (!ownerRole) return NextResponse.json({ error: 'OWNER_ROLE_NOT_SEEDED' }, { status: 500 })
    if (parsed.data.businessName) {
      await db.business.update({ where: { id: businessId }, data: { name: parsed.data.businessName } })
    }
    const user = await db.user.create({ data: { email, name: displayName, passwordHash } })
    await db.profile.create({
      data: { userId: user.id, businessId, roleId: ownerRole.id, displayName, phone: phone ?? null },
    })
    await writeAudit({
      businessId,
      userId: user.id,
      action: 'BOOTSTRAP_OWNER',
      entity: 'user',
      entityId: user.id,
      details: { email, displayName, roleId: ownerRole.id },
    })
    return NextResponse.json({ ok: true, bootstrap: true, userId: user.id })
  }

  // Supabase production mode
  const supabase = createAuthClient()
  const admin = getAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 500 })
  }

  const { data: ownerRole, error: roleError } = await supabase
    .from('roles')
    .select('id')
    .eq('business_id', businessId)
    .eq('name', 'Owner/Admin')
    .eq('is_system', true)
    .single()

  if (roleError || !ownerRole) {
    return NextResponse.json({ error: 'OWNER_ROLE_NOT_SEEDED' }, { status: 500 })
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

  try {
    if (parsed.data.businessName) {
      const { data: biz } = await supabase
        .from('businesses')
        .select('id')
        .eq('id', businessId)
        .single()
      if (biz) {
        await supabase
          .from('businesses')
          .update({ name: parsed.data.businessName })
          .eq('id', businessId)
      }
    }

    const { error: profileError } = await supabase.from('profiles').insert({
      user_id: newUserId,
      business_id: businessId,
      role_id: (ownerRole as any).id,
      display_name: displayName,
      phone: phone ?? null,
      is_active: true,
    })

    if (profileError) {
      await admin.auth.admin.deleteUser(newUserId)
      return NextResponse.json({ error: 'PROFILE_CREATE_FAILED' }, { status: 500 })
    }
  } catch (e) {
    try { await admin.auth.admin.deleteUser(newUserId) } catch {}
    throw e
  }

  await writeAudit({
    businessId,
    userId: newUserId,
    action: 'BOOTSTRAP_OWNER',
    entity: 'user',
    entityId: newUserId,
    details: { email, displayName, roleId: (ownerRole as any).id },
  })

  return NextResponse.json({ ok: true, bootstrap: true, userId: newUserId })
}