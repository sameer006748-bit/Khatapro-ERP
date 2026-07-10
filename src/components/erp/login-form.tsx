'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

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
    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })
    setLoading(false)
    if (!res || res.error) {
      setError('Invalid email or password.')
      return
    }
    onSignedIn()
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md bg-card border-border">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-xl tracking-tight">Khata ERP</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Accounting-first garments ERP · PKR · Asia/Karachi
          </p>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          {allowRegister && (
            <Alert className="bg-primary/10 border-primary/40 text-foreground">
              <AlertDescription className="text-xs">
                <span className="font-semibold text-primary">First-run mode:</span> no Owner exists
                yet. Sign in if you already have an account, or register as the first Owner/Admin.
              </AlertDescription>
            </Alert>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="bg-background"
              />
            </div>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={loading} className="w-full font-semibold">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          {allowRegister && (
            <div className="pt-2 border-t border-border">
              <Button variant="outline" className="w-full" onClick={onShowRegister}>
                Register as first Owner/Admin
              </Button>
            </div>
          )}
          {!allowRegister && (
            <p className="text-xs text-muted-foreground pt-2 border-t border-border">
              Public registration is closed. Ask the Owner/Admin to invite you.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
