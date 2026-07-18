'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { signOut } from 'next-auth/react'
import { motion } from 'framer-motion'
import { User, Mail, Shield, Phone, Lock, LogOut, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react'
import type { MeUser } from '@/components/erp/erp-app'

export function MyProfileView({ user }: { user: MeUser }) {
  const [phone, setPhone] = useState(user.phone ?? '')
  const [phoneSaved, setPhoneSaved] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  const phoneMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: phone || null }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'Failed')
      return j
    },
    onSuccess: () => {
      toast.success('Phone number updated')
      setPhoneSaved(true)
      setTimeout(() => setPhoneSaved(false), 2000)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const passwordMut = useMutation({
    mutationFn: async () => {
      setPasswordError(null)
      if (newPassword.length < 8) throw new Error('Password must be at least 8 characters')
      if (newPassword !== confirmPassword) throw new Error('Passwords do not match')
      if (currentPassword === newPassword) throw new Error('New password must be different')
      const r = await fetch('/api/me/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'Failed')
      return j
    },
    onSuccess: () => {
      toast.success('Password changed successfully')
      setPasswordSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    },
    onError: (e: Error) => {
      setPasswordError(e.message)
      setPasswordSuccess(false)
    },
  })

  const roleBadge: Record<string, string> = {
    'Owner/Admin': 'bg-primary/10 text-primary',
    Accountant: 'bg-sky-100 text-sky-700',
    Salesman: 'bg-amber-100 text-amber-700',
    Rider: 'bg-violet-100 text-violet-700',
  }

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">My Profile</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Manage your personal information and security settings</p>
      </div>

      {/* ── Info ── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card-3d p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><User className="size-4 text-primary" /> Personal Info</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Mail className="size-4 text-muted-foreground shrink-0" />
            <div className="min-w-0"><div className="text-xs text-muted-foreground">Email</div><div className="text-sm font-medium text-foreground truncate">{user.email}</div></div>
          </div>
          <div className="flex items-center gap-3">
            <User className="size-4 text-muted-foreground shrink-0" />
            <div className="min-w-0"><div className="text-xs text-muted-foreground">Display Name</div><div className="text-sm font-medium text-foreground">{user.displayName}</div></div>
          </div>
          <div className="flex items-center gap-3">
            <Shield className="size-4 text-muted-foreground shrink-0" />
            <div className="min-w-0"><div className="text-xs text-muted-foreground">Role</div><span className={`inline-block text-xs font-medium px-2 py-0.5 rounded mt-0.5 ${roleBadge[user.roleName] ?? 'bg-muted text-muted-foreground'}`}>{user.roleName}</span></div>
          </div>
          <div className="flex items-center gap-3">
            <Phone className="size-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <Label className="text-xs text-muted-foreground">Phone</Label>
              <div className="flex gap-2 mt-1">
                <Input value={phone} onChange={e => { setPhone(e.target.value); setPhoneSaved(false) }} placeholder="03XX-XXXXXXX" className="h-9 bg-background press-sm" />
                <Button size="sm" className="h-9 press-sm shrink-0" disabled={phoneMut.isPending} onClick={() => phoneMut.mutate()}>
                  {phoneMut.isPending ? 'Saving…' : phoneSaved ? <span className="flex items-center gap-1"><CheckCircle2 className="size-3" /> Saved</span> : 'Save'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Change Password ── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="card-3d p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><Lock className="size-4 text-primary" /> Change Password</h2>
        {passwordSuccess ? (
          <div className="text-center py-4">
            <CheckCircle2 className="size-12 text-primary mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">Password changed successfully</p>
            <p className="text-xs text-muted-foreground mt-1">Your session is still active</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setPasswordSuccess(false)}><ArrowLeft className="size-3.5" /> Change again</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div><Label className="text-xs text-muted-foreground">Current Password</Label><Input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Enter current password" className="h-9 bg-background press-sm" /></div>
            <div><Label className="text-xs text-muted-foreground">New Password</Label><Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 8 characters" className="h-9 bg-background press-sm" /></div>
            <div><Label className="text-xs text-muted-foreground">Confirm New Password</Label><Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter new password" className="h-9 bg-background press-sm" /></div>
            {newPassword && newPassword.length < 8 && <div className="text-xs text-amber-600 flex items-center gap-1"><AlertCircle className="size-3" /> Password must be at least 8 characters</div>}
            {confirmPassword && newPassword !== confirmPassword && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> Passwords do not match</div>}
            {passwordError && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {passwordError}</div>}
            <Button className="w-full press-sm" disabled={!currentPassword || !newPassword || !confirmPassword || passwordMut.isPending} onClick={() => passwordMut.mutate()}>
              {passwordMut.isPending ? 'Updating…' : 'Change Password'}
            </Button>
          </div>
        )}
      </motion.div>

      {/* ── Logout ── */}
      <div className="card-3d p-4 flex items-center justify-between">
        <div><div className="text-sm font-medium text-foreground">Sign Out</div><div className="text-xs text-muted-foreground">End your current session</div></div>
        <Button variant="outline" size="sm" className="press-sm text-destructive hover:text-destructive" onClick={() => signOut()}><LogOut className="size-3.5" /> Sign Out</Button>
      </div>
    </div>
  )
}