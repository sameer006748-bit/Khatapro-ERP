'use client'

import type { MeUser } from '@/components/erp/erp-app'
import { WalletCards, ListTree, FolderTree, UserCog, ShieldCheck, History, ArrowRight, Lock } from 'lucide-react'
import { PageHeader } from '@/components/erp/page-header'

export function SetupView({
  user,
  canOpen,
  onNavigate,
}: {
  user: MeUser
  canOpen: (key: string) => boolean
  onNavigate: (key: string) => void
}) {

  const cards = [
    {
      title: 'Business Accounts',
      desc: 'Manage the cash, bank and mobile-wallet accounts used for daily payments.',
      route: 'business-accounts',
      icon: WalletCards,
      ownerOnly: false,
    },
    {
      title: 'Chart of Accounts',
      desc: 'Organize the accounts used to classify assets, liabilities, equity, income and expenses.',
      route: 'coa',
      icon: ListTree,
      ownerOnly: false,
    },
    {
      title: 'Account Categories',
      desc: 'Name the categories your business uses under each accounting type.',
      route: 'account-classification',
      icon: FolderTree,
      ownerOnly: false,
    },
    {
      title: 'Users & Roles',
      desc: 'Invite team members and assign roles that match their responsibilities.',
      route: 'users',
      icon: UserCog,
      ownerOnly: true,
    },
    {
      title: 'Roles & Permissions',
      desc: 'Review what each role can view or manage across the business.',
      route: 'permissions',
      icon: ShieldCheck,
      ownerOnly: true,
    },
    {
      title: 'Audit Log',
      desc: 'Review a dated history of important changes and actions.',
      route: 'audit',
      icon: History,
      ownerOnly: false,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Setup" description="Manage business accounts, team access and accounting setup." />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {cards.map((c) => {
          const locked = !canOpen(c.route)
          const content = (
            <>
              <div className="flex items-start justify-between mb-3">
                <div className="grid place-items-center size-10 rounded-xl icon-3d">
                    <c.icon className="size-5 text-primary-foreground" strokeWidth={1.9} />
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
              </div>
            </>
          )

          return (
            locked ? (
              <div key={c.title} className="card-3d p-5 flex flex-col" aria-disabled="true">
                {content}
              </div>
            ) : (
              <button
                key={c.title}
                type="button"
                onClick={() => onNavigate(c.route)}
                className="card-3d card-3d-hover p-5 flex flex-col w-full min-h-44 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                {content}
              </button>
            )
          )
        })}
      </div>
    </div>
  )
}
