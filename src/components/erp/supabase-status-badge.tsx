'use client'

import { useQuery } from '@tanstack/react-query'
import { Database, CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react'

type Status = {
  configured: boolean
  browserConfigured: boolean
  adminConfigured: boolean
  url: string | null
  reachable: boolean
  authReachable: boolean
  adminCanQuery: boolean
  phase1Applied: boolean
  phase2Applied: boolean
  message: string
}

export function SupabaseStatusBadge() {
  const q = useQuery<Status>({
    queryKey: ['supabase-status'],
    queryFn: () => fetch('/api/supabase-status').then((r) => r.json()),
    staleTime: 30_000,
  })

  const s = q.data
  if (!s) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Database className="size-3" />
        Checking…
      </span>
    )
  }

  // Fully ready.
  if (s.configured && s.adminCanQuery && s.phase1Applied && s.phase2Applied) {
    return (
      <span
        className="hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2 py-1 bg-primary/10 text-primary rounded-md font-medium"
        title="System Online"
      >
        <CheckCircle2 className="size-3" />
        System Online
      </span>
    )
  }

  // Needs attention.
  if (s.configured && s.adminCanQuery && (!s.phase1Applied || !s.phase2Applied)) {
    return (
      <span
        className="hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2 py-1 bg-amber-100 text-amber-700 rounded-md font-medium"
        title={s.message}
      >
        <AlertTriangle className="size-3" />
        System needs attention
      </span>
    )
  }

  // Configured but admin not working.
  if (s.configured && s.reachable) {
    return (
      <span
        className="hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2 py-1 bg-amber-100 text-amber-700 rounded-md font-medium"
        title={s.message}
      >
        <AlertCircle className="size-3" />
        System needs attention
      </span>
    )
  }

  // Not configured — running on Prisma/SQLite local preview.
  return (
    <span
      className="hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2 py-1 bg-muted text-muted-foreground rounded-md font-medium"
      title={s.message}
    >
      <Database className="size-3" />
      System status unavailable
    </span>
  )
}
