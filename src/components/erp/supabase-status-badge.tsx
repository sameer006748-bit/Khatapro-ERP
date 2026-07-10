'use client'

import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Database, CheckCircle2, AlertCircle } from 'lucide-react'

type Status = {
  configured: boolean
  browserConfigured: boolean
  adminConfigured: boolean
  url: string | null
  reachable: boolean
  authReachable: boolean
  adminCanQuery: boolean
  message: string
}

export function SupabaseStatusBadge() {
  const q = useQuery<Status>({
    queryKey: ['supabase-status'],
    queryFn: () => fetch('/api/supabase-status').then((r) => r.json()),
    staleTime: 60_000,
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

  // Connected: admin key works AND we can query a table.
  if (s.configured && s.adminCanQuery) {
    return (
      <span
        className="hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2 py-1 bg-primary/10 text-primary rounded-md font-medium"
        title={`Supabase connected: ${s.url}`}
      >
        <CheckCircle2 className="size-3" />
        Supabase
      </span>
    )
  }

  // Configured but admin not working (migrations not applied or key missing).
  if (s.configured && s.reachable) {
    return (
      <span
        className="hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2 py-1 bg-amber-100 text-amber-700 rounded-md font-medium"
        title={s.message}
      >
        <AlertCircle className="size-3" />
        Supabase (pending)
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
      Local preview
    </span>
  )
}

void cn
