/**
 * First-owner bootstrap registration.
 *
 * Rules (from the prompt):
 * 1. If no Owner/Admin exists yet, the first public registrant becomes
 *    Owner/Admin.
 * 2. Once an owner exists, public self-registration is closed. New users
 *    must be invited by Owner/Admin via /api/setup/users.
 *
 * This route is the only public entry point. After bootstrap, the route
 * returns 403 with a clear message.
 */
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/lib/db'
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

  const bootstrap = await noOwnerExists()
  if (!bootstrap) {
    return NextResponse.json(
      { error: 'REGISTRATION_CLOSED', message: 'Owner already exists. Ask the Owner/Admin to invite you.' },
      { status: 403 },
    )
  }

  // Email uniqueness
  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const businessId = 'biz-default' // single-business MVP
  const ownerRole = await db.role.findFirst({
    where: { businessId, name: 'Owner/Admin', isSystem: true },
  })
  if (!ownerRole) {
    return NextResponse.json({ error: 'OWNER_ROLE_NOT_SEEDED' }, { status: 500 })
  }

  // Optional: rename the default business if the registrant supplied one.
  if (parsed.data.businessName) {
    await db.business.update({ where: { id: businessId }, data: { name: parsed.data.businessName } })
  }

  const user = await db.user.create({ data: { email, name: displayName, passwordHash } })
  await db.profile.create({
    data: {
      userId: user.id,
      businessId,
      roleId: ownerRole.id,
      displayName,
      phone: phone ?? null,
    },
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
