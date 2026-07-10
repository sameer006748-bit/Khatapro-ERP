'use client'

import { ArrowRight } from 'lucide-react'

export function ComingSoonView({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
      <div className="card-3d border-primary/30 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="grid place-items-center size-12 rounded-xl icon-3d shrink-0">
            <ArrowRight className="size-5 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <div className="text-base font-semibold text-foreground">
              <span className="text-primary">{phase}</span> — not built in Phase 1.
            </div>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Phase 1 is foundation-only (auth, roles, CoA, business accounts, audit, biz-day
              utilities). Each subsequent phase is gated on user approval.
            </p>
            <div className="mt-4 pt-4 border-t border-border flex items-center gap-1.5 text-xs text-primary">
              <ArrowRight className="size-3.5" />
              <span>Approve Phase 1 to unlock subsequent phases.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
