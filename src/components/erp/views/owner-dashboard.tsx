'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MeUser } from '@/components/erp/erp-app'

export function OwnerDashboard({ user }: { user: MeUser }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Owner / Admin</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Welcome, {user.displayName}. Phase 1 is foundation-only — accounting modules arrive in
          Phase 2 onwards.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Phase" value="1 / 10" sub="Foundation" />
        <StatCard label="Currency" value="PKR" sub="Asia/Karachi" mono />
        <StatCard label="Your role" value={user.roleName} sub={user.email} />
        <StatCard label="Permissions" value={String(user.permissions.length)} sub="codes granted" mono />
      </div>

      <Card className="bg-card">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base">Phase 1 — what is live</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 text-sm space-y-2 text-muted-foreground">
          <ul className="space-y-1.5 list-disc list-inside marker:text-primary">
            <li>Authentication & first-owner bootstrap</li>
            <li>Roles &amp; permissions data model (Owner / Accountant / Salesman / Rider)</li>
            <li>Default Chart of Accounts (17 accounts across 5 categories)</li>
            <li>Business accounts with linked Asset ledger sub-accounts</li>
            <li>Audit log</li>
            <li>Asia/Karachi date grouping utilities</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base">Coming in later phases</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 text-sm grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-muted-foreground">
          <div>Phase 2 — Accounting engine (vouchers, post_voucher, Trial Balance)</div>
          <div>Phase 3 — Products &amp; stock (negative stock allowed)</div>
          <div>Phase 4 — Sales (Counter / Online / OFC, shared invoice serial)</div>
          <div>Phase 5 — Purchases &amp; vendor ledger</div>
          <div>Phase 6 — Voucher module &amp; expense batches</div>
          <div>Phase 7 — Rider &amp; COD workflow</div>
          <div>Phase 8 — Reports (Trial Balance, P&amp;L, Balance Sheet, …)</div>
          <div>Phase 9 — Mobile PWA polish &amp; half-A4 invoice printing</div>
          <div>Phase 10 — AI assistant (Gemini 2.5 Flash, read-only)</div>
        </CardContent>
      </Card>

      <Card className="bg-card border-primary/30">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base text-primary">Phase 1 gate — verify in this UI</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 text-sm space-y-2 text-muted-foreground">
          <p>Open each of these from the sidebar to verify Phase 1:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Setup → Business Accounts → create one (creates linked Asset ledger account)</li>
            <li>Setup → Chart of Accounts → confirm 17 seeded accounts across 5 categories</li>
            <li>Users &amp; Roles → invite an Accountant / Salesman / Rider (Owner-only)</li>
            <li>Sign out, sign in as each role — confirm nav differs per role</li>
            <li>Permission Matrix → confirm role → permission mapping</li>
            <li>Biz-Day Test → confirm Asia/Karachi midnight boundary</li>
            <li>Audit Log → confirm every action above was logged</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  mono,
}: {
  label: string
  value: string
  sub?: string
  mono?: boolean
}) {
  return (
    <Card className="bg-card">
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1" data-num={mono ? true : undefined}>
          {value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
      </CardContent>
    </Card>
  )
}
