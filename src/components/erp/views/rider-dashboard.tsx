'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MeUser } from '@/components/erp/erp-app'

export function RiderDashboard({ user }: { user: MeUser }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rider</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {user.displayName} — assigned orders, delivery status, COD submission, own rider ledger.
        </p>
      </div>
      <Card className="bg-card">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base">Your mobile home (Phase 9 preview)</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-4 gap-2">
            {['My Orders', 'Delivered', 'Returned', 'COD Submit'].map((label) => (
              <div
                key={label}
                className="border border-border bg-background px-2 py-4 text-center text-xs"
              >
                {label}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Rider assignment, COD submission and rider ledger arrive in Phase 7.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
