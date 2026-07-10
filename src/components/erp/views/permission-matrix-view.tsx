'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MeUser } from '@/components/erp/erp-app'

type RoleWithPerms = {
  id: string
  name: string
  isSystem: boolean
  description: string | null
  permissions: { code: string; module: string; description: string | null }[]
}

type Modules = Record<string, Array<{ code: string; description: string | null }>>

export function PermissionMatrixView({ user }: { user: MeUser }) {
  const isOwner = user.roleName === 'Owner/Admin'
  const rolesQ = useQuery<{ roles: RoleWithPerms[] }>({
    queryKey: ['roles'],
    queryFn: () => fetch('/api/setup/roles').then((r) => r.json()),
    enabled: isOwner,
  })
  const permsQ = useQuery<{ modules: Modules }>({
    queryKey: ['permissions'],
    queryFn: () => fetch('/api/setup/permissions').then((r) => r.json()),
    enabled: isOwner,
  })

  if (!isOwner) {
    return (
      <Card className="bg-card">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Restricted to Owner/Admin.
        </CardContent>
      </Card>
    )
  }

  const roles = rolesQ.data?.roles ?? []
  const modules = permsQ.data?.modules ?? {}
  const allCodes = Object.values(modules).flat().map((p) => p.code)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Permission Matrix</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Inspect which permission codes each role has been granted. Owner/Admin has every
          permission seeded. (Editing a role&apos;s permissions UI arrives in a later phase; the
          data model already supports it.)
        </p>
      </div>

      <Card className="bg-card">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base">
            Matrix <span className="text-xs text-muted-foreground ml-2" data-num>{allCodes.length} perms × {roles.length} roles</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rolesQ.isLoading || permsQ.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left p-2 sticky left-0 bg-card">Permission</th>
                    {roles.map((r) => (
                      <th key={r.id} className="p-2 text-center min-w-[100px]">
                        <div className="font-semibold text-foreground">{r.name}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(modules).map(([mod, perms]) => (
                    <Group key={mod} mod={mod} perms={perms} roles={roles} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Group({
  mod,
  perms,
  roles,
}: {
  mod: string
  perms: Array<{ code: string; description: string | null }>
  roles: RoleWithPerms[]
}) {
  return (
    <>
      <tr className="bg-muted/30">
        <td colSpan={roles.length + 1} className="p-2 text-[10px] uppercase tracking-wider text-muted-foreground" data-num>
          {mod}
        </td>
      </tr>
      {perms.map((p) => (
        <tr key={p.code} className="border-b border-border/30 hover:bg-accent/20">
          <td className="p-2 sticky left-0 bg-card">
            <div className="font-medium" data-num>{p.code}</div>
            <div className="text-muted-foreground">{p.description}</div>
          </td>
          {roles.map((r) => {
            const has = r.permissions.some((rp) => rp.code === p.code)
            return (
              <td key={r.id} className="p-2 text-center">
                <span
                  className={
                    has
                      ? 'inline-block size-2 bg-primary'
                      : 'inline-block size-2 bg-muted-foreground/30'
                  }
                  aria-label={has ? 'granted' : 'not granted'}
                />
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}
