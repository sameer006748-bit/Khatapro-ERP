'use client'

import type { MeUser } from '@/components/erp/erp-app'
import { Wallet, BookOpen, Users, Shield, ScrollText, FileText, ArrowRight, Lock } from 'lucide-react'

export function SetupView({ user }: { user: MeUser }) {
  const isOwner = user.roleName === 'Owner/Admin'

  const cards = [
    {
      title: 'Business Accounts',
      desc: 'Cash / Petty Cash / Bank / Easypaisa / JazzCash / Wallet / Custom. Each creates a linked Asset ledger account.',
      route: 'business-accounts',
      icon: Wallet,
      ownerOnly: false,
    },
    {
      title: 'Chart of Accounts',
      desc: 'Default Pakistani garments SMB CoA — 17 accounts across Asset / Liability / Equity / Income / Expense.',
      route: 'coa',
      icon: BookOpen,
      ownerOnly: false,
    },
    {
      title: 'Users & Roles',
      desc: 'Invite users and assign one of the four system roles. Owner/Admin only.',
      route: 'users',
      icon: Users,
      ownerOnly: true,
    },
    {
      title: 'Permission Matrix',
      desc: 'Inspect which permissions each role has been granted. Owner/Admin only.',
      route: 'permissions',
      icon: Shield,
      ownerOnly: true,
    },
    {
      title: 'Audit Log',
      desc: 'Every mutating action — bootstrap, user invite, business account creation, etc.',
      route: 'audit',
      icon: ScrollText,
      ownerOnly: false,
    },
    {
      title: 'Biz-Day Test',
      desc: 'Verify Asia/Karachi midnight boundary grouping for UTC instants.',
      route: 'biz-day-test',
      icon: FileText,
      ownerOnly: false,
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">Setup</h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Foundation configuration. Use the sidebar items under Setup to manage each section.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {cards.map((c) => {
          const locked = c.ownerOnly && !isOwner
          return (
            <div
              key={c.title}
              className={`card-3d ${locked ? '' : 'card-3d-hover'} p-5 flex flex-col`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="grid place-items-center size-10 rounded-xl icon-3d">
                  <c.icon className="size-5 text-primary-foreground" />
                </div>
                {c.ownerOnly && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider bg-accent text-accent-foreground px-2 py-0.5 rounded-md font-medium">
                    {locked ? <Lock className="size-2.5" /> : null}
                    Owner
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-foreground">{c.title}</h3>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed flex-1">
                {c.desc}
              </p>
              <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs">
                {locked ? (
                  <span className="text-destructive flex items-center gap-1">
                    <Lock className="size-3" /> Restricted
                  </span>
                ) : (
                  <span className="text-primary flex items-center gap-1">
                    Open <ArrowRight className="size-3" />
                  </span>
                )}
                <span className="text-muted-foreground" data-num>
                  {c.route}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
