'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KhataProLogo } from '@/components/erp/logo'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ShieldCheck, Sparkles } from 'lucide-react'

export function LoginForm({
  allowRegister,
  onShowRegister,
  onSignedIn,
}: {
  allowRegister: boolean
  onShowRegister: () => void
  onSignedIn: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const res = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)
    if (!res || res.error) {
      setError('Invalid email or password.')
      return
    }
    onSignedIn()
  }

  return (
    <div className="min-h-[100dvh] flex items-stretch bg-background">
      {/* Left brand panel — desktop only */}
      <aside className="hidden lg:flex w-[44%] xl:w-[40%] surface-gradient border-r border-border flex-col justify-between p-10 xl:p-14">
        <KhataProLogo size="lg" />
        <div className="max-w-md space-y-5">
          <h1 className="text-3xl xl:text-4xl font-semibold tracking-tight text-foreground leading-tight">
            Accounting-first ERP for{' '}
            <span className="text-primary">Pakistani garments & SMB.</span>
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Counter, Online, and OFC sales in one shared invoice sequence. Double-entry vouchers
            posted invisibly behind every business form. PKR · Asia/Karachi. Built for Vercel.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-4">
            {[
              { t: 'Double-entry', d: 'Server-enforced balanced vouchers' },
              { t: 'Role-based', d: 'Owner · Accountant · Salesman · Rider' },
              { t: 'Negative stock', d: 'Allowed — sales never blocked' },
              { t: 'Audit trail', d: 'Every mutation logged' },
            ].map((f) => (
              <div key={f.t} className="card-3d p-3.5">
                <div className="text-xs font-semibold text-foreground">{f.t}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{f.d}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
          <ShieldCheck className="size-3.5 text-primary" />
          Phase 1 · Foundation — auth, roles, CoA, business accounts, audit
        </div>
      </aside>

      {/* Right form panel */}
      <main className="flex-1 flex items-center justify-center p-5 sm:p-8">
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <KhataProLogo size="md" />
          </div>

          <div className="card-3d p-6 sm:p-8 fade-in">
            <div className="mb-6">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Sign in</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Welcome back. Use your KhataPro ERP credentials.
              </p>
            </div>

            {allowRegister && (
              <Alert className="bg-accent/60 border-primary/30 mb-5">
                <Sparkles className="size-3.5 text-primary" />
                <AlertDescription className="text-xs text-accent-foreground">
                  <span className="font-semibold text-primary">First-run mode:</span> no Owner
                  exists yet. Sign in if you already have an account, or register as the first
                  Owner/Admin.
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-muted-foreground">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-10 bg-background press-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-10 bg-background press-sm"
                />
              </div>
              {error && (
                <p className="text-xs text-destructive fade-in" role="alert">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-10 font-semibold press-md shadow-sm"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            {allowRegister && (
              <div className="pt-4 mt-4 border-t border-border">
                <Button
                  variant="outline"
                  className="w-full h-10 press-sm"
                  onClick={onShowRegister}
                >
                  Register as first Owner/Admin
                </Button>
              </div>
            )}
            {!allowRegister && (
              <p className="text-[11px] text-muted-foreground pt-4 mt-4 border-t border-border text-center">
                Public registration is closed. Ask the Owner/Admin to invite you.
              </p>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground text-center mt-5">
            © {new Date().getFullYear()} KhataPro ERP · PKR · Asia/Karachi
          </p>
        </div>
      </main>
    </div>
  )
}
