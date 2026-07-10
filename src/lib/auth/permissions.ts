/**
 * Server-side permission helpers — the Supabase "SECURITY DEFINER" equivalent.
 *
 * In the prompt's Supabase design, RBAC is enforced by RLS policies backed
 * by SECURITY DEFINER helper functions. We replicate the same guarantee
 * in the Prisma/NextAuth stack by routing EVERY business-data mutation
 * through these helpers. API routes must call `requirePermission(...)`
 * (or `requireOwner`) before touching any table.
 */
import 'server-only'
import { db } from '@/lib/db'

export type SessionUser = {
  userId: string
  supabaseUserUuid: string | null
  profileId: string
  businessId: string
  roleId: string
  roleName: string
  displayName: string
  email: string
  permissions: Set<string>
}

/** Load a SessionUser (with resolved permission set) by userId. */
export async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    include: {
      profile: {
        include: {
          role: {
            include: { permissions: { include: { permission: true } } },
          },
        },
      },
    },
  })
  if (!u || !u.profile || !u.profile.isActive) return null

  const permissions = new Set<string>()
  for (const rp of u.profile.role.permissions) {
    permissions.add(rp.permission.code)
  }

  return {
    userId: u.id,
    supabaseUserUuid: u.supabaseUserUuid,
    profileId: u.profile.id,
    businessId: u.profile.businessId,
    roleId: u.profile.roleId,
    roleName: u.profile.role.name,
    displayName: u.profile.displayName,
    email: u.email,
    permissions,
  }
}

export function hasPermission(s: SessionUser | null, code: string): boolean {
  if (!s) return false
  // Owner/Admin always passes (their role has every permission seeded).
  return s.permissions.has(code)
}

export function isOwner(s: SessionUser | null): boolean {
  return !!s && s.roleName === 'Owner/Admin'
}

/** Throws 403-shaped Error if the user lacks the permission. */
export async function requirePermission(
  s: SessionUser | null,
  code: string,
): Promise<SessionUser> {
  if (!s) {
    const e = new Error('UNAUTHORIZED') as Error & { status?: number }
    e.status = 401
    throw e
  }
  if (!hasPermission(s, code)) {
    const e = new Error('FORBIDDEN') as Error & { status?: number }
    e.status = 403
    throw e
  }
  return s
}

/** Throws if the user is not Owner/Admin. */
export async function requireOwner(s: SessionUser | null): Promise<SessionUser> {
  if (!s) {
    const e = new Error('UNAUTHORIZED') as Error & { status?: number }
    e.status = 401
    throw e
  }
  if (!isOwner(s)) {
    const e = new Error('FORBIDDEN') as Error & { status?: number }
    e.status = 403
    throw e
  }
  return s
}

/**
 * First-owner bootstrap check.
 * Returns true if no Owner/Admin profile exists yet in ANY business.
 * (In MVP single-business, this effectively means: no owner has ever
 * registered.)
 */
export async function noOwnerExists(): Promise<boolean> {
  const ownerRole = await db.role.findFirst({
    where: { name: 'Owner/Admin', isSystem: true },
  })
  if (!ownerRole) return true
  const count = await db.profile.count({ where: { roleId: ownerRole.id } })
  return count === 0
}

/** Audit log helper — used by every mutating API route. */
export async function writeAudit(args: {
  businessId: string
  userId?: string | null
  action: string
  entity: string
  entityId?: string | null
  details?: Record<string, unknown> | null
}) {
  await db.auditLog.create({
    data: {
      businessId: args.businessId,
      userId: args.userId ?? null,
      action: args.action,
      entity: args.entity,
      entityId: args.entityId ?? null,
      details: args.details ? JSON.stringify(args.details) : null,
    },
  })
}
