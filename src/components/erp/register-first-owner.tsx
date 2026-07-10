'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft } from 'lucide-react'

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
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md bg-card border-border">
        <CardHeader className="border-b border-border">
          <button
            onClick={onBack}
            className="flex items-center text-xs text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="size-3 mr-1" /> Back to sign in
          </button>
          <CardTitle className="text-xl tracking-tight">Register first Owner/Admin</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            This account becomes the business Owner. After this, public registration is closed.
          </p>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          <Alert className="bg-primary/10 border-primary/40">
            <AlertDescription className="text-xs">
              You are bootstrapping the system. Choose a strong password — it controls full business
              access.
            </AlertDescription>
          </Alert>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Business name
              </Label>
              <Input value={form.businessName} onChange={set('businessName')} required className="bg-background" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Your name
              </Label>
              <Input value={form.displayName} onChange={set('displayName')} required className="bg-background" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
              <Input type="email" value={form.email} onChange={set('email')} required className="bg-background" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Password</Label>
              <Input type="password" value={form.password} onChange={set('password')} required minLength={6} className="bg-background" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Phone (optional)
              </Label>
              <Input value={form.phone} onChange={set('phone')} className="bg-background" />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full font-semibold">
              {loading ? 'Creating owner…' : 'Create Owner & business'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
