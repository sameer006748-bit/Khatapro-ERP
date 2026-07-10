'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MeUser } from '@/components/erp/erp-app'

export function SetupView({ user }: { user: MeUser }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Foundation configuration. Use the sidebar items under Setup to manage each section.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <SetupCard
          title="Business Accounts"
          desc="Cash / Petty Cash / Bank / Easypaisa / JazzCash / Wallet / Custom. Each creates a linked Asset ledger account."
          route="business-accounts"
        />
        <SetupCard
          title="Chart of Accounts"
          desc="Default Pakistani garments SMB CoA — 17 accounts across Asset / Liability / Equity / Income / Expense."
          route="coa"
        />
        <SetupCard
          title="Users & Roles"
          desc="Invite users and assign one of the four system roles. Owner/Admin only."
          route="users"
          ownerOnly
          isOwner={user.roleName === 'Owner/Admin'}
        />
        <SetupCard
          title="Permission Matrix"
          desc="Inspect which permissions each role has been granted. Owner/Admin only."
          route="permissions"
          ownerOnly
          isOwner={user.roleName === 'Owner/Admin'}
        />
        <SetupCard
          title="Audit Log"
          desc="Every mutating action — bootstrap, user invite, business account creation, etc."
          route="audit"
        />
        <SetupCard
          title="Biz-Day Test"
          desc="Verify Asia/Karachi midnight boundary grouping for UTC instants."
          route="biz-day-test"
        />
      </div>
    </div>
  )
}

function SetupCard({
  title,
  desc,
  route,
  ownerOnly,
  isOwner,
}: {
  title: string
  desc: string
  route: string
  ownerOnly?: boolean
  isOwner?: boolean
}) {
  return (
    <Card className="bg-card">
      <CardHeader className="border-b border-border pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          {ownerOnly && (
            <span className="text-[10px] uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5">
              Owner
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-3 text-sm text-muted-foreground">
        <p>{desc}</p>
        <p className="mt-3 text-xs">
          {ownerOnly && !isOwner ? (
            <span className="text-destructive">Restricted to Owner/Admin.</span>
          ) : (
            <span className="text-primary">Open from sidebar →</span>
          )}
          <span className="ml-1 text-muted-foreground" data-num>
            {route}
          </span>
        </p>
      </CardContent>
    </Card>
  )
}
