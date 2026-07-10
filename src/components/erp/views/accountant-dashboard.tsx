'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MeUser } from '@/components/erp/erp-app'

export function AccountantDashboard({ user }: { user: MeUser }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Accountant</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {user.displayName} — day-to-day finance ops, vouchers, reports, closing.
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MiniStat label="Role" value="Accountant" />
        <MiniStat label="Phase" value="1 / 10" mono />
        <MiniStat label="Permissions" value={String(user.permissions.length)} mono />
        <MiniStat label="Currency" value="PKR" mono />
      </div>
      <Card className="bg-card">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base">Your mobile home (Phase 9 preview)</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 text-sm text-muted-foreground">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {['New Sale', 'Online Order', 'OFC Order', 'Purchase', 'Expense', 'Receipt', 'Payment', 'Reports'].map(
              (label) => (
                <div
                  key={label}
                  className="border border-border bg-background px-3 py-3 text-center text-xs"
                >
                  {label}
                </div>
              ),
            )}
          </div>
          <p className="mt-3 text-xs">Bottom navigation & full mobile polish arrive in Phase 9.</p>
        </CardContent>
      </Card>
    </div>
  )
}

function MiniStat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Card className="bg-card">
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold mt-1" data-num={mono ? true : undefined}>
          {value}
        </div>
      </CardContent>
    </Card>
  )
}
