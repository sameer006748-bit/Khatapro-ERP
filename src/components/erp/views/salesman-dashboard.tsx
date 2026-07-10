'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MeUser } from '@/components/erp/erp-app'

export function SalesmanDashboard({ user }: { user: MeUser }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Salesman</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {user.displayName} — counter sale bill creation, own sales, own commission.
        </p>
      </div>
      <Card className="bg-card">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base">Your mobile home (Phase 9 preview)</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-3 gap-2">
            {['New Bill', 'My Sales', 'My Commission'].map((label) => (
              <div
                key={label}
                className="border border-border bg-background px-3 py-4 text-center text-xs"
              >
                {label}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Counter Sale bill creation ships in Phase 4. Commission accrues only after payment
            collection.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
