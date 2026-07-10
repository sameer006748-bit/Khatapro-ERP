'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoginForm } from '@/components/erp/login-form'
import { RegisterFirstOwnerForm } from '@/components/erp/register-first-owner'
import { DashboardShell } from '@/components/erp/dashboard-shell'

export type MeUser = {
  id: string
  email: string
  displayName: string
  roleName: string
  roleId: string
  businessId: string
  profileId: string
  permissions: string[]
}

async function fetchMe(): Promise<{ user: MeUser | null }> {
  const r = await fetch('/api/me', { cache: 'no-store' })
  if (!r.ok) return { user: null }
  return r.json()
}

async function fetchBootstrap(): Promise<{ bootstrapOpen: boolean }> {
  const r = await fetch('/api/bootstrap-status', { cache: 'no-store' })
  if (!r.ok) return { bootstrapOpen: false }
  return r.json()
}

export function ErpApp() {
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe, refetchOnMount: true })
  const boot = useQuery({ queryKey: ['bootstrap'], queryFn: fetchBootstrap })

  const isLoading = me.isLoading || boot.isLoading
  const user = me.data?.user ?? null
  const bootstrapOpen = boot.data?.bootstrapOpen ?? false

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm tracking-wider">LOADING…</div>
      </div>
    )
  }

  if (user) {
    return <DashboardShell user={user} onSignOut={() => me.refetch()} />
  }

  return (
    <AuthGate
      bootstrapOpen={bootstrapOpen}
      onSignedIn={() => {
        void me.refetch()
        void boot.refetch()
      }}
      onBootstrapChanged={() => boot.refetch()}
    />
  )
}

function AuthGate({
  bootstrapOpen,
  onSignedIn,
  onBootstrapChanged,
}: {
  bootstrapOpen: boolean
  onSignedIn: () => void
  onBootstrapChanged: () => void
}) {
  // Local UI state — toggled only by user click handlers, never set in an effect.
  const [showRegister, setShowRegister] = useState(false)

  if (bootstrapOpen && showRegister) {
    return (
      <RegisterFirstOwnerForm
        onBack={() => setShowRegister(false)}
        onRegistered={() => {
          onBootstrapChanged()
          setShowRegister(false)
        }}
      />
    )
  }

  return (
    <LoginForm
      allowRegister={bootstrapOpen}
      onShowRegister={() => setShowRegister(true)}
      onSignedIn={onSignedIn}
    />
  )
}
