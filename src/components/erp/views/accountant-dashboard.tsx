'use client'

import type { MeUser } from '@/components/erp/erp-app'
import { ShoppingCart, Bike, Receipt, FileText, Wallet, ArrowRight } from 'lucide-react'

export function AccountantDashboard({ user }: { user: MeUser }) {
  const actions = [
    { label: 'New Sale', icon: ShoppingCart, phase: 'Phase 4' },
    { label: 'Online Order', icon: ShoppingCart, phase: 'Phase 4' },
    { label: 'OFC Order', icon: ShoppingCart, phase: 'Phase 4' },
    { label: 'Purchase', icon: Receipt, phase: 'Phase 5' },
    { label: 'Expense', icon: Wallet, phase: 'Phase 6' },
    { label: 'Receipt', icon: FileText, phase: 'Phase 6' },
    { label: 'Payment', icon: FileText, phase: 'Phase 6' },
    { label: 'Reports', icon: FileText, phase: 'Phase 8' },
  ]

  return (
    <div className="space-y-6">
      <div className="card-3d surface-gradient p-6 sm:p-8">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          KhataPro ERP · Accountant
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mt-1">
          Welcome, {user.displayName.split(' ')[0]}.
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-xl">
          Day-to-day finance operations — sales, purchases, vouchers, reports, daily closing.
          Mobile home preview below shows the Phase 9 layout.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Role" value="Accountant" />
        <StatCard label="Phase" value="1 / 10" mono />
        <StatCard label="Permissions" value={String(user.permissions.length)} mono />
        <StatCard label="Currency" value="PKR" mono />
      </div>

      <div className="card-3d p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Your mobile home</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Phase 9 preview · bottom-nav layout</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {actions.map((a) => (
            <div
              key={a.label}
              className="card-3d card-3d-hover p-4 flex flex-col items-center gap-2 text-center"
            >
              <div className="grid place-items-center size-10 rounded-xl icon-3d">
                <a.icon className="size-5 text-primary-foreground" />
              </div>
              <div className="text-xs font-medium text-foreground">{a.label}</div>
              <div className="text-[10px] text-muted-foreground" data-num>{a.phase}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-primary mt-4 pt-4 border-t border-border">
          <ArrowRight className="size-3.5" />
          <span>Bottom navigation & full mobile polish arrive in Phase 9.</span>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="card-3d card-3d-hover p-4 sm:p-5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      <div
        className="text-xl sm:text-2xl font-semibold mt-2 text-foreground"
        data-num={mono ? true : undefined}
      >
        {value}
      </div>
    </div>
  )
}
