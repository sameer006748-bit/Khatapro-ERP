/**
 * Roles + their permission codes (Owner/Admin only). Used by the
 * permission-management UI.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { getAdminClient } from '@/lib/supabase/server-admin'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, requireOwner, writeAudit } from '@/lib/auth/permissions'
import { resolveRequestId, safeMutationError, withObservability } from '@/lib/observability'

const UpdateRoleSchema = z.object({
  roleId: z.string().min(1),
  permissionCodes: z.array(z.string().min(1).max(100)).max(250),
})

async function getRoles() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requireOwner(loaded)

  if (!isSupabaseConfigured()) {
    // Local fallback
    const { db } = await import('@/lib/db')
    const roles = await db.role.findMany({
      where: { businessId: su.businessId },
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        isSystem: r.isSystem,
        description: r.description,
        permissions: r.permissions.map((rp) => ({
          code: rp.permission.code,
          module: rp.permission.module,
          description: rp.permission.description,
        })),
      })),
    })
  }

  // Supabase mode
  const supabase = getAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: 'ROLE_LIST_UNAVAILABLE' }, { status: 500 })
  }
  const { data: roles, error } = await supabase
    .from('roles')
    .select(`
      id, name, is_system, description,
      permissions:role_permissions ( permission:permissions (code, module, description) )
    `)
    .eq('business_id', su.businessId)
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'FETCH_FAILED' }, { status: 500 })
  }

  return NextResponse.json({
    roles: (roles || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      isSystem: r.is_system,
      description: r.description,
      permissions: (r.permissions || []).map((rp: any) => ({
        code: rp.permission?.code,
        module: rp.permission?.module,
        description: rp.permission?.description,
      })),
    })),
  })
}

export const GET = withObservability('/api/setup/roles', getRoles)

export async function PUT(req: Request) {
  const requestId = resolveRequestId(req)
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const su = await requireOwner(loaded)

  const body = await req.json().catch(() => null)
  const parsed = UpdateRoleSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })

  const permissionCodes = [...new Set(parsed.data.permissionCodes)]

  try {
    if (!isSupabaseConfigured()) {
      const { db } = await import('@/lib/db')
      const role = await db.role.findFirst({
        where: { id: parsed.data.roleId, businessId: su.businessId },
      })
      if (!role) return NextResponse.json({ error: 'ROLE_NOT_FOUND' }, { status: 404 })
      if (role.name === 'Owner/Admin') {
        return NextResponse.json({ error: 'OWNER_PERMISSIONS_ARE_REQUIRED' }, { status: 400 })
      }

      const permissions = await db.permission.findMany({
        where: { code: { in: permissionCodes } },
        select: { id: true },
      })
      if (permissions.length !== permissionCodes.length) {
        return NextResponse.json({ error: 'UNKNOWN_PERMISSION' }, { status: 400 })
      }

      await db.$transaction([
        db.rolePermission.deleteMany({ where: { roleId: role.id } }),
        db.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
        }),
      ])

      await writeAudit({
        businessId: su.businessId,
        userId: su.userId,
        action: 'UPDATE_ROLE_PERMISSIONS',
        entity: 'role',
        entityId: role.id,
        details: { roleName: role.name, permissionCount: permissions.length },
      })
      return NextResponse.json({ ok: true })
    }

    const admin = getAdminClient()
    if (!admin) throw new Error('admin_unavailable')

    const { data: role, error: roleError } = await admin
      .from('roles')
      .select('id, name')
      .eq('id', parsed.data.roleId)
      .eq('business_id', su.businessId)
      .maybeSingle()
    if (roleError) throw new Error('role_lookup_failed')
    if (!role) return NextResponse.json({ error: 'ROLE_NOT_FOUND' }, { status: 404 })
    if (role.name === 'Owner/Admin') {
      return NextResponse.json({ error: 'OWNER_PERMISSIONS_ARE_REQUIRED' }, { status: 400 })
    }

    const permissions = permissionCodes.length > 0
      ? await admin.from('permissions').select('id, code').in('code', permissionCodes)
      : { data: [], error: null }
    if (permissions.error) throw new Error('permission_lookup_failed')
    if ((permissions.data ?? []).length !== permissionCodes.length) {
      return NextResponse.json({ error: 'UNKNOWN_PERMISSION' }, { status: 400 })
    }

    const { data: current, error: currentError } = await admin
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', role.id)
    if (currentError) throw new Error('role_permissions_lookup_failed')

    const desiredIds = new Set((permissions.data ?? []).map((permission: any) => permission.id))
    const currentIds = new Set((current ?? []).map((mapping: any) => mapping.permission_id))
    const removeIds = [...currentIds].filter((id) => !desiredIds.has(id))
    const addIds = [...desiredIds].filter((id) => !currentIds.has(id))

    // Apply removals first so any partial provider failure remains fail-closed.
    if (removeIds.length > 0) {
      const { error } = await admin
        .from('role_permissions')
        .delete()
        .eq('role_id', role.id)
        .in('permission_id', removeIds)
      if (error) throw new Error('role_permissions_remove_failed')
    }
    if (addIds.length > 0) {
      const { error } = await admin.from('role_permissions').insert(
        addIds.map((permissionId) => ({ role_id: role.id, permission_id: permissionId })),
      )
      if (error) throw new Error('role_permissions_add_failed')
    }

    await writeAudit({
      businessId: su.businessId,
      userId: su.userId,
      action: 'UPDATE_ROLE_PERMISSIONS',
      entity: 'role',
      entityId: role.id,
      details: { roleName: role.name, permissionCount: permissionCodes.length },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return safeMutationError({
      route: '/api/setup/roles',
      requestId,
      errorCode: 'ROLE_PERMISSIONS_UPDATE_FAILED',
      userMessage: 'Role permissions could not be updated.',
      error,
    })
  }
}
