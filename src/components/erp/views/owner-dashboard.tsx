'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MeUser } from '@/components/erp/erp-app'
import { ShieldCheck, BookOpen, Wallet, ScrollText, CalendarClock, ArrowRight } from 'lucide-react'

export function OwnerDashboard({ user }: { user: MeUser }) {
  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="card-3d surface-gradient p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              KhataPro ERP · Phase 1 / 10
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mt-1">
              Welcome, {user.displayName.split(' ')[0]}.
            </h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              Foundation is live. Accounting modules (vouchers, sales, purchases, reports) arrive
              in Phase 2 onwards — each gated on your approval.
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg shadow-sm">
            <ShieldCheck className="size-4 text-primary" />
            <span className="text-xs font-medium text-foreground">{user.roleName}</span>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={BookOpen} label="Phase" value="1 / 10" sub="Foundation" mono />
        <StatCard icon={Wallet} label="Currency" value="PKR" sub="Asia/Karachi" mono />
        <StatCard icon={ShieldCheck} label="Your role" value={user.roleName} sub={user.email} />
        <StatCard
          icon={ScrollText}
          label="Permissions"
          value={String(user.permissions.length)}
          sub="codes granted"
          mono
        />
      </div>

      {/* What's live + roadmap */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="card-3d card-3d-hover border-border bg-card">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-base">Phase 1 — what is live</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-sm space-y-2.5 text-muted-foreground">
            <ul className="space-y-2">
              {[
                'Authentication & first-owner bootstrap',
                'Roles & permissions data model (Owner / Accountant / Salesman / Rider)',
                'Default Chart of Accounts (17 accounts across 5 categories)',
                'Business accounts with linked Asset ledger sub-accounts',
                'Audit log',
                'Asia/Karachi date grouping utilities',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="card-3d card-3d-hover border-border bg-card">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-base">Coming in later phases</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-sm space-y-2 text-muted-foreground">
            {[
              ['Phase 2', 'Accounting engine (vouchers, post_voucher, Trial Balance)'],
              ['Phase 3', 'Products & stock (negative stock allowed)'],
              ['Phase 4', 'Sales (Counter / Online / OFC, shared invoice serial)'],
              ['Phase 5', 'Purchases & vendor ledger'],
              ['Phase 6', 'Voucher module & expense batches'],
              ['Phase 7', 'Rider & COD workflow'],
              ['Phase 8', 'Reports (Trial Balance, P&L, Balance Sheet, …)'],
              ['Phase 9', 'Mobile PWA polish & half-A4 invoice printing'],
              ['Phase 10', 'AI assistant (Gemini 2.5 Flash, read-only)'],
            ].map(([p, t]) => (
              <div key={p} className="flex items-baseline gap-3">
                <span className="text-xs font-semibold text-primary w-16 shrink-0" data-num>
                  {p}
                </span>
                <span className="text-foreground/80">{t}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Phase 1 gate checklist */}
      <Card className="card-3d border-primary/30 bg-card">
        <CardHeader className="border-b border-border pb-3">
          <CardTitle className="text-base text-primary flex items-center gap-2">
            <CalendarClock className="size-4" />
            Phase 1 gate — verify in this UI
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 text-sm space-y-2 text-muted-foreground">
          <p>Open each of these from the sidebar to verify Phase 1:</p>
          <ol className="space-y-1.5 mt-2">
            {[
              'Setup → Business Accounts → create one (creates linked Asset ledger account)',
              'Setup → Chart of Accounts → confirm 17 seeded accounts across 5 categories',
              'Users & Roles → invite an Accountant / Salesman / Rider (Owner-only)',
              'Sign out, sign in as each role — confirm nav differs per role',
              'Permission Matrix → confirm role → permission mapping',
              'Biz-Day Test → confirm Asia/Karachi midnight boundary',
              'Audit Log → confirm every action above was logged',
            ].map((t, i) => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="grid place-items-center size-5 rounded-md bg-accent text-accent-foreground text-[10px] font-semibold shrink-0 mt-0.5" data-num>
                  {i + 1}
                </span>
                <span className="text-foreground/80">{t}</span>
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-1.5 text-xs text-primary mt-3 pt-3 border-t border-border">
            <ArrowRight className="size-3.5" />
            <span>Approve Phase 1 to unlock Phase 2 (Accounting Engine).</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  mono?: boolean
}) {
  return (
    <div className="card-3d card-3d-hover p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </div>
        <div className="grid place-items-center size-7 rounded-lg icon-3d-muted">
          <Icon className="size-3.5 text-muted-foreground" />
        </div>
      </div>
      <div
        className="text-xl sm:text-2xl font-semibold mt-2 text-foreground"
        data-num={mono ? true : undefined}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  )
}
