'use client'

import { Card, CardContent } from '@/components/ui/card'

export function ComingSoonView({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Card className="bg-card border-primary/30">
        <CardContent className="p-6">
          <div className="text-sm text-muted-foreground">
            <span className="text-primary font-medium">{phase}</span> — not built in Phase 1.
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Phase 1 is foundation-only (auth, roles, CoA, business accounts, audit, biz-day
            utilities). Each subsequent phase is gated on user approval.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
