'use client'

import type { MeUser } from '@/components/erp/erp-app'
import { Package, CheckCircle2, RotateCcw, Wallet, ArrowRight } from 'lucide-react'

export function RiderDashboard({ user }: { user: MeUser }) {
  const actions = [
    { label: 'My Orders', icon: Package, phase: 'Phase 7' },
    { label: 'Delivered', icon: CheckCircle2, phase: 'Phase 7' },
    { label: 'Returned', icon: RotateCcw, phase: 'Phase 7' },
    { label: 'COD Submit', icon: Wallet, phase: 'Phase 7' },
  ]

  return (
    <div className="space-y-6">
      <div className="card-3d surface-gradient p-6 sm:p-8">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          KhataPro ERP · Rider
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mt-1">
          Welcome, {user.displayName.split(' ')[0]}.
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-xl">
          Your assigned online orders, delivery status, COD submission, and your own rider ledger.
        </p>
      </div>

      <div className="card-3d p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-foreground">Your mobile home</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Phase 9 preview</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {actions.map((a) => (
            <div
              key={a.label}
              className="card-3d card-3d-hover p-4 flex flex-col items-center gap-2 text-center"
            >
              <div className="grid place-items-center size-11 rounded-xl icon-3d">
                <a.icon className="size-5 text-primary-foreground" />
              </div>
              <div className="text-xs font-medium text-foreground">{a.label}</div>
              <div className="text-[10px] text-muted-foreground" data-num>{a.phase}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-primary mt-4 pt-4 border-t border-border">
          <ArrowRight className="size-3.5" />
          <span>Rider assignment, COD submission and rider ledger arrive in Phase 7.</span>
        </div>
      </div>
    </div>
  )
}
