'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
      <Card className="bg-card">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Restricted to Owner/Admin.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users &amp; Roles</h1>
          <p className="text-sm text-muted-foreground mt-1">
            After first-owner bootstrap, public registration is closed — invite new users from here.
          </p>
        </div>
        <Button onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Invite user'}</Button>
      </div>

      {open && (
        <Card className="bg-card">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-base">Invite user</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <InviteForm submitting={inviteMut.isPending} onSubmit={(v) => inviteMut.mutate(v)} />
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="bg-card lg:col-span-2">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-base">Users <span className="text-xs text-muted-foreground ml-2" data-num>{q.data?.users.length ?? 0}</span></CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {q.isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading…</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="text-left p-3">User</th>
                      <th className="text-left p-3">Role</th>
                      <th className="text-left p-3">Phone</th>
                      <th className="text-left p-3">Status</th>
                      <th className="text-left p-3">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data?.users.map((u) => (
                      <tr key={u.id} className="border-b border-border/50 hover:bg-accent/20">
                        <td className="p-3">
                          <div className="font-medium">{u.displayName}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </td>
                        <td className="p-3">
                          {u.role ? (
                            <span className="text-xs uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5">
                              {u.role.name}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground" data-num>{u.phone ?? '—'}</td>
                        <td className="p-3 text-xs">
                          {u.isActive ? (
                            <span className="text-primary">Active</span>
                          ) : (
                            <span className="text-destructive">Inactive</span>
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground" data-num>
                          {formatTableDate(u.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-base">Roles</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {q.data?.roles.map((r) => (
                <div key={r.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{r.name}</div>
                    {r.isSystem && (
                      <span className="text-[10px] uppercase bg-muted text-muted-foreground px-1.5 py-0.5">
                        System
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{r.description}</div>
                  <div className="text-xs mt-1 text-muted-foreground" data-num>
                    {r.permissionsCount} perms · {r.usersCount} users
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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
      className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ email, password, displayName, roleName, phone: phone || undefined })
      }}
    >
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Display name</Label>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required className="bg-background" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="bg-background" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Password</Label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="bg-background" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Role</Label>
        <Select value={roleName} onValueChange={setRoleName}>
          <SelectTrigger className="bg-background">
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
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Phone (optional)</Label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="bg-background" data-num />
      </div>
      <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Inviting…' : 'Invite user'}
        </Button>
      </div>
    </form>
  )
}
