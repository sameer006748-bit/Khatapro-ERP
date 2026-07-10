'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KhataProLogo } from '@/components/erp/logo'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, ShieldCheck } from 'lucide-react'

export function RegisterFirstOwnerForm({
  onBack,
  onRegistered,
}: {
  onBack: () => void
  onRegistered: () => void
}) {
  const [form, setForm] = useState({
    businessName: '',
    displayName: '',
    email: '',
    password: '',
    phone: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    })
    setLoading(false)
    if (r.ok) {
      onRegistered()
      return
    }
    const j = await r.json().catch(() => ({}))
    if (j?.error === 'EMAIL_TAKEN') setError('Email is already taken.')
    else if (j?.error === 'REGISTRATION_CLOSED')
      setError('Registration is closed: an Owner already exists.')
    else if (j?.error === 'INVALID_INPUT') setError('Please check the form fields.')
    else setError('Registration failed. Please try again.')
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }))

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-5 sm:p-8 bg-background">
      <div className="w-full max-w-[460px]">
        <div className="flex justify-center mb-6">
          <KhataProLogo size="md" />
        </div>

        <div className="card-3d p-6 sm:p-8 fade-in">
          <button
            onClick={onBack}
            className="flex items-center text-xs text-muted-foreground hover:text-foreground mb-4 press-sm"
          >
            <ArrowLeft className="size-3.5 mr-1.5" /> Back to sign in
          </button>

          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Register first Owner/Admin
          </h2>
          <p className="text-xs text-muted-foreground mt-1 mb-5">
            This account becomes the business Owner. After this, public registration is closed.
          </p>

          <Alert className="bg-accent/60 border-primary/30 mb-5">
            <ShieldCheck className="size-3.5 text-primary" />
            <AlertDescription className="text-xs text-accent-foreground">
              You are bootstrapping the system. Choose a strong password — it controls full
              business access.
            </AlertDescription>
          </Alert>

          <form onSubmit={submit} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Business name</Label>
              <Input
                value={form.businessName}
                onChange={set('businessName')}
                required
                className="h-10 bg-background press-sm"
                placeholder="e.g. Karachi Garments"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Your name</Label>
              <Input
                value={form.displayName}
                onChange={set('displayName')}
                required
                className="h-10 bg-background press-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={set('email')}
                required
                className="h-10 bg-background press-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Password</Label>
              <Input
                type="password"
                value={form.password}
                onChange={set('password')}
                required
                minLength={6}
                className="h-10 bg-background press-sm"
              />
              <p className="text-[10px] text-muted-foreground">Minimum 6 characters.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Phone (optional)
              </Label>
              <Input
                value={form.phone}
                onChange={set('phone')}
                className="h-10 bg-background press-sm"
                data-num
              />
            </div>
            {error && <p className="text-xs text-destructive fade-in">{error}</p>}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-10 font-semibold press-md shadow-sm mt-2"
            >
              {loading ? 'Creating owner…' : 'Create Owner & business'}
            </Button>
          </form>
        </div>

        <p className="text-[11px] text-muted-foreground text-center mt-5">
          © {new Date().getFullYear()} KhataPro ERP
        </p>
      </div>
    </div>
  )
}
