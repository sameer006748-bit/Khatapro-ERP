'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatTableDate } from '@/lib/format'
import type { MeUser } from '@/components/erp/erp-app'
import { toast } from 'sonner'
import { Users as UsersIcon, Plus, X, ShieldCheck, Lock } from 'lucide-react'

type UserRow = {
  id: string
  email: string
  displayName: string
  phone: string | null
  isActive: boolean
  role: { id: string; name: string } | null
  createdAt: string
}
type RoleRow = {
  id: string
  name: string
  isSystem: boolean
  description: string | null
  permissionsCount: number
  usersCount: number
}

const ROLE_BADGE: Record<string, string> = {
  'Owner/Admin': 'bg-primary/10 text-primary',
  Accountant: 'bg-sky-100 text-sky-700',
  Salesman: 'bg-amber-100 text-amber-700',
  Rider: 'bg-violet-100 text-violet-700',
}

export function UsersView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const isOwner = user.roleName === 'Owner/Admin'
  const [open, setOpen] = useState(false)

  const q = useQuery<{ users: UserRow[]; roles: RoleRow[] }>({
    queryKey: ['users'],
    queryFn: () => fetch('/api/setup/users').then((r) => r.json()),
    enabled: isOwner,
  })

  const inviteMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const r = await fetch('/api/setup/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error ?? 'INVITE_FAILED')
      }
      return r.json()
    },
    onSuccess: () => {
      toast.success('User invited.')
      void qc.invalidateQueries({ queryKey: ['users'] })
      void qc.invalidateQueries({ queryKey: ['audit'] })
      setOpen(false)
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })

  if (!isOwner) {
    return (
      <div className="card-3d p-8 text-center">
        <div className="grid place-items-center size-12 rounded-xl icon-3d-muted mx-auto mb-3">
          <Lock className="size-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">Restricted to Owner/Admin</p>
        <p className="text-xs text-muted-foreground mt-1">
          You don&apos;t have permission to manage users and roles.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            Users &amp; Roles
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
            After first-owner bootstrap, public registration is closed — invite new users from
            here.
          </p>
        </div>
        <Button onClick={() => setOpen((v) => !v)} className="press-md shadow-sm">
          {open ? <X className="size-4" /> : <Plus className="size-4" />}
          {open ? 'Close' : 'Invite user'}
        </Button>
      </div>

      {open && (
        <div className="card-3d p-5 sm:p-6 fade-in">
          <h2 className="text-base font-semibold text-foreground mb-4">Invite user</h2>
          <InviteForm submitting={inviteMut.isPending} onSubmit={(v) => inviteMut.mutate(v)} />
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Users — desktop table / mobile cards */}
        <div className="lg:col-span-2 card-3d overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Users</h2>
            <span className="text-xs text-muted-foreground" data-num>
              {q.data?.users.length ?? 0} total
            </span>
          </div>

          {q.isLoading ? (
            <div className="p-8 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                      <th className="text-left p-3.5 font-medium">User</th>
                      <th className="text-left p-3.5 font-medium">Role</th>
                      <th className="text-left p-3.5 font-medium">Phone</th>
                      <th className="text-left p-3.5 font-medium">Status</th>
                      <th className="text-left p-3.5 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data?.users.map((u) => (
                      <tr
                        key={u.id}
                        className="border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors"
                      >
                        <td className="p-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="size-8 rounded-full bg-accent grid place-items-center text-xs font-semibold text-accent-foreground shrink-0">
                              {u.displayName.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-foreground">{u.displayName}</div>
                              <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3.5">
                          {u.role ? (
                            <span
                              className={`text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium ${
                                ROLE_BADGE[u.role.name] ?? 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {u.role.name}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3.5 text-xs text-muted-foreground" data-num>
                          {u.phone ?? '—'}
                        </td>
                        <td className="p-3.5 text-xs">
                          {u.isActive ? (
                            <span className="inline-flex items-center gap-1 text-primary">
                              <span className="size-1.5 rounded-full bg-primary" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-destructive">
                              <span className="size-1.5 rounded-full bg-destructive" /> Inactive
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-xs text-muted-foreground" data-num>
                          {formatTableDate(u.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-border/60">
                {q.data?.users.map((u) => (
                  <div key={u.id} className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-full bg-accent grid place-items-center text-sm font-semibold text-accent-foreground shrink-0">
                        {u.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-foreground truncate">{u.displayName}</div>
                        <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                      </div>
                      {u.role && (
                        <span
                          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium shrink-0 ${
                            ROLE_BADGE[u.role.name] ?? 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {u.role.name}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground" data-num>
                        {u.phone ?? '—'}
                      </span>
                      {u.isActive ? (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <span className="size-1.5 rounded-full bg-primary" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <span className="size-1.5 rounded-full bg-destructive" /> Inactive
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Roles sidebar */}
        <div className="card-3d overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Roles</h2>
          </div>
          <div className="divide-y divide-border/60">
            {q.data?.roles.map((r) => (
              <div key={r.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium ${
                        ROLE_BADGE[r.name] ?? 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {r.name}
                    </span>
                    {r.isSystem && (
                      <span className="text-[9px] uppercase text-muted-foreground">System</span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-2 leading-snug">
                  {r.description}
                </div>
                <div className="text-xs mt-2 text-muted-foreground" data-num>
                  {r.permissionsCount} perms · {r.usersCount} users
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function InviteForm({
  submitting,
  onSubmit,
}: {
  submitting: boolean
  onSubmit: (v: Record<string, unknown>) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [roleName, setRoleName] = useState('Salesman')
  const [phone, setPhone] = useState('')

  return (
    <form
      className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ email, password, displayName, roleName, phone: phone || undefined })
      }}
    >
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Display name</Label>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required className="h-10 bg-background press-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-10 bg-background press-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Password</Label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="h-10 bg-background press-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Role</Label>
        <Select value={roleName} onValueChange={setRoleName}>
          <SelectTrigger className="h-10 bg-background press-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['Accountant', 'Salesman', 'Rider', 'Owner/Admin'].map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Phone (optional)</Label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10 bg-background press-sm" data-num />
      </div>
      <div className="sm:col-span-2 lg:col-span-3 flex justify-end pt-1">
        <Button type="submit" disabled={submitting} className="press-md shadow-sm">
          {submitting ? (
            'Inviting…'
          ) : (
            <>
              <ShieldCheck className="size-4" /> Invite user
            </>
          )}
        </Button>
      </div>
    </form>
  )
}

void UsersIcon
