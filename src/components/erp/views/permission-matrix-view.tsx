'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MeUser } from '@/components/erp/erp-app'
import { Lock, Check, Minus } from 'lucide-react'
import { toast } from 'sonner'

type RoleWithPerms = {
  id: string
  name: string
  isSystem: boolean
  description: string | null
  permissions: { code: string; module: string; description: string | null }[]
}

type Modules = Record<string, Array<{ code: string; description: string | null }>>

const ROLE_BADGE: Record<string, string> = {
  'Owner/Admin': 'bg-primary/10 text-primary',
  Accountant: 'bg-sky-100 text-sky-700',
  Salesman: 'bg-amber-100 text-amber-700',
  Rider: 'bg-violet-100 text-violet-700',
}

export function PermissionMatrixView({ user }: { user: MeUser }) {
  const isOwner = user.roleName === 'Owner/Admin'
  const queryClient = useQueryClient()
  const rolesQ = useQuery<{ roles: RoleWithPerms[] }>({
    queryKey: ['roles'],
    queryFn: async () => {
      const response = await fetch('/api/setup/roles')
      if (!response.ok) throw new Error('ROLE_LIST_FAILED')
      return response.json()
    },
    enabled: isOwner,
  })
  const permsQ = useQuery<{ modules: Modules }>({
    queryKey: ['permissions'],
    queryFn: async () => {
      const response = await fetch('/api/setup/permissions')
      if (!response.ok) throw new Error('PERMISSION_LIST_FAILED')
      return response.json()
    },
    enabled: isOwner,
  })
  const updateRole = useMutation({
    mutationFn: async ({ roleId, permissionCodes }: { roleId: string; permissionCodes: string[] }) => {
      const response = await fetch('/api/setup/roles', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roleId, permissionCodes }),
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result?.message ?? result?.error ?? 'ROLE_PERMISSIONS_UPDATE_FAILED')
      }
      return response.json()
    },
    onSuccess: () => toast.success('Role permissions updated.'),
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['roles'] }),
  })

  if (!isOwner) {
    return (
      <div className="card-3d p-8 text-center">
        <div className="grid place-items-center size-12 rounded-xl icon-3d-muted mx-auto mb-3">
          <Lock className="size-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">Restricted to Owner/Admin</p>
        <p className="text-xs text-muted-foreground mt-1">
          You don&apos;t have permission to view the permission matrix.
        </p>
      </div>
    )
  }

  const roles = rolesQ.data?.roles ?? []
  const modules = permsQ.data?.modules ?? {}
  const allCodes = Object.values(modules).flat().map((p) => p.code)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          Permission Matrix
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Owner/Admin always retains full access. Select a permission cell to configure
          Accountant, Salesman, or Rider access; existing defaults remain unchanged until you change them.
        </p>
      </div>

      {/* Role summary chips */}
      <div className="flex flex-wrap gap-2">
        {roles.map((r) => (
          <div
            key={r.id}
            className="card-3d px-3.5 py-2 flex items-center gap-2"
          >
            <span
              className={`text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium ${
                ROLE_BADGE[r.name] ?? 'bg-muted text-muted-foreground'
              }`}
            >
              {r.name}
            </span>
            <span className="text-xs text-muted-foreground" data-num>
              {r.permissions.length} perms
            </span>
          </div>
        ))}
      </div>

      <div className="card-3d overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Matrix</h2>
          <span className="text-xs text-muted-foreground" data-num>
            {allCodes.length} perms × {roles.length} roles
          </span>
        </div>

        {rolesQ.isLoading || permsQ.isLoading ? (
          <div className="p-8 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left p-3 sticky left-0 bg-card z-10 min-w-[260px]">
                    Permission
                  </th>
                  {roles.map((r) => (
                    <th key={r.id} className="p-3 text-center min-w-[110px]">
                      <span
                        className={`inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium ${
                          ROLE_BADGE[r.name] ?? 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {r.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(modules).map(([mod, perms]) => (
                  <Group
                    key={mod}
                    mod={mod}
                    perms={perms}
                    roles={roles}
                    saving={updateRole.isPending}
                    onToggle={(role, permissionCode) => {
                      const codes = new Set(role.permissions.map((permission) => permission.code))
                      if (codes.has(permissionCode)) codes.delete(permissionCode)
                      else codes.add(permissionCode)
                      updateRole.mutate({ roleId: role.id, permissionCodes: [...codes] })
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Group({
  mod,
  perms,
  roles,
  saving,
  onToggle,
}: {
  mod: string
  perms: Array<{ code: string; description: string | null }>
  roles: RoleWithPerms[]
  saving: boolean
  onToggle: (role: RoleWithPerms, permissionCode: string) => void
}) {
  return (
    <>
      <tr className="bg-muted/30">
        <td
          colSpan={roles.length + 1}
          className="p-2.5 px-3 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold"
          data-num
        >
          {mod}
        </td>
      </tr>
      {perms.map((p) => (
        <tr
          key={p.code}
          className="border-b border-border/40 last:border-0 hover:bg-accent/30 transition-colors"
        >
          <td className="p-3 sticky left-0 bg-card z-10">
            <div className="font-medium text-foreground" data-num>
              {p.code}
            </div>
            <div className="text-muted-foreground mt-0.5 text-[11px]">{p.description}</div>
          </td>
          {roles.map((r) => {
            const has = r.permissions.some((rp) => rp.code === p.code)
            const owner = r.name === 'Owner/Admin'
            return (
              <td key={r.id} className="p-3 text-center">
                <button
                  type="button"
                  disabled={owner || saving}
                  onClick={() => onToggle(r, p.code)}
                  aria-label={`${has ? 'Remove' : 'Grant'} ${p.code} for ${r.name}`}
                  aria-pressed={has}
                  title={owner ? 'Owner/Admin always has full access' : `${has ? 'Remove' : 'Grant'} permission`}
                  className="inline-grid place-items-center size-8 rounded-md disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {has ? (
                    <span className="inline-grid place-items-center size-5 rounded-md bg-primary/10 text-primary">
                      <Check className="size-3" />
                    </span>
                  ) : (
                    <span className="inline-grid place-items-center size-5 rounded-md bg-muted text-muted-foreground/40">
                      <Minus className="size-3" />
                    </span>
                  )}
                </button>
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}
