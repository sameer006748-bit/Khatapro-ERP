'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Settings,
  Users,
  FileText,
  ScrollText,
  ShoppingCart,
  Receipt,
  Bike,
  Package,
  BookOpen,
  ClipboardList,
  LogOut,
  Wallet,
  Shield,
} from 'lucide-react'
import type { MeUser } from '@/components/erp/erp-app'
import { OwnerDashboard } from '@/components/erp/views/owner-dashboard'
import { AccountantDashboard } from '@/components/erp/views/accountant-dashboard'
import { SalesmanDashboard } from '@/components/erp/views/salesman-dashboard'
import { RiderDashboard } from '@/components/erp/views/rider-dashboard'
import { SetupView } from '@/components/erp/views/setup-view'
import { UsersView } from '@/components/erp/views/users-view'
import { CoaView } from '@/components/erp/views/coa-view'
import { BusinessAccountsView } from '@/components/erp/views/business-accounts-view'
import { AuditLogView } from '@/components/erp/views/audit-log-view'
import { BizDayTestView } from '@/components/erp/views/biz-day-test-view'
import { PermissionMatrixView } from '@/components/erp/views/permission-matrix-view'
import { ComingSoonView } from '@/components/erp/views/coming-soon'

type NavItem = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** Permission code required to see this item; undefined = always visible. */
  perm?: string
  /** Restricted to Owner/Admin regardless of perm. */
  ownerOnly?: boolean
}

const NAV: NavItem[] = [
  { key: 'home', label: 'Home', icon: LayoutDashboard },
  { key: 'setup', label: 'Setup', icon: Settings, perm: 'can_view_setup' },
  { key: 'business-accounts', label: 'Business Accounts', icon: Wallet, perm: 'can_view_setup' },
  { key: 'coa', label: 'Chart of Accounts', icon: BookOpen, perm: 'can_view_setup' },
  { key: 'users', label: 'Users & Roles', icon: Users, ownerOnly: true },
  { key: 'permissions', label: 'Permission Matrix', icon: Shield, ownerOnly: true },
  { key: 'audit', label: 'Audit Log', icon: ScrollText, perm: 'can_view_audit_log' },
  { key: 'biz-day-test', label: 'Biz-Day Test', icon: FileText },
  { key: 'sales', label: 'Sales', icon: ShoppingCart, perm: 'can_view_sales' },
  { key: 'purchases', label: 'Purchases', icon: Receipt, perm: 'can_view_purchases' },
  { key: 'products', label: 'Products', icon: Package, perm: 'can_view_products' },
  { key: 'riders', label: 'Riders', icon: Bike, perm: 'can_view_riders' },
  { key: 'vouchers', label: 'Vouchers', icon: ClipboardList, perm: 'can_view_vouchers' },
  { key: 'reports', label: 'Reports', icon: FileText, perm: 'can_view_trial_balance' },
]

function visibleNav(user: MeUser): NavItem[] {
  return NAV.filter((n) => {
    if (n.ownerOnly) return user.roleName === 'Owner/Admin'
    if (n.perm) return user.permissions.includes(n.perm)
    return true
  })
}

export function DashboardShell({ user, onSignOut }: { user: MeUser; onSignOut: () => void }) {
  const [active, setActive] = useState('home')
  const nav = visibleNav(user)

  // Reset to home if the active item is no longer visible (e.g. role change).
  const effectiveActive = nav.some((n) => n.key === active) ? active : 'home'

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="h-12 border-b border-border flex items-center px-3 sm:px-4 bg-card/30 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="size-6 bg-primary" />
          <span className="font-semibold tracking-tight">Khata ERP</span>
          <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">·</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">{user.roleName}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:inline text-xs text-muted-foreground" data-num>
            {new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={async () => {
              await signOut({ redirect: false })
              onSignOut()
            }}
          >
            <LogOut className="size-3.5 mr-1.5" /> Sign out
          </Button>
        </div>
      </header>

      {/* Desktop: sidebar + main / Mobile: main + bottom nav */}
      <div className="flex-1 flex">
        {/* Sidebar (desktop) */}
        <aside className="hidden md:flex w-56 border-r border-border bg-sidebar/50 flex-col">
          <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {nav.map((n) => (
              <NavButton
                key={n.key}
                item={n}
                active={effectiveActive === n.key}
                onClick={() => setActive(n.key)}
              />
            ))}
          </nav>
          <div className="p-2 border-t border-border">
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              <div className="font-medium text-foreground truncate">{user.displayName}</div>
              <div className="truncate">{user.email}</div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto pb-20 md:pb-6">
          <div className="p-4 sm:p-6 max-w-7xl mx-auto">
            <ViewRouter user={user} active={effectiveActive} />
          </div>
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 border-t border-border bg-card/95 backdrop-blur-md grid grid-cols-5 z-40">
        {nav.slice(0, 5).map((n) => (
          <button
            key={n.key}
            onClick={() => setActive(n.key)}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium',
              effectiveActive === n.key ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <n.icon className="size-5" />
            <span className="truncate max-w-[60px]">{n.label.split(' ')[0]}</span>
          </button>
        ))}
      </nav>

      {/* Mobile "more" sheet — for nav items beyond the first 5 */}
      {nav.length > 5 && (
        <MobileMoreSheet
          items={nav.slice(5)}
          active={effectiveActive}
          onSelect={setActive}
        />
      )}
    </div>
  )
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2.5 py-2 text-sm',
        active
          ? 'bg-primary/10 text-primary border-l-2 border-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/40 border-l-2 border-transparent',
      )}
    >
      <item.icon className="size-4" />
      <span className="truncate">{item.label}</span>
    </button>
  )
}

function MobileMoreSheet({
  items,
  active,
  onSelect,
}: {
  items: NavItem[]
  active: string
  onSelect: (k: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="md:hidden fixed bottom-4 right-4 size-10 bg-primary text-primary-foreground grid place-items-center shadow-lg z-50"
        aria-label="More"
      >
        <span className="text-lg leading-none">+</span>
      </button>
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-50"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute bottom-0 inset-x-0 bg-card border-t border-border p-3 max-h-[60vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">More</div>
            <div className="grid grid-cols-2 gap-1">
              {items.map((n) => (
                <button
                  key={n.key}
                  onClick={() => {
                    onSelect(n.key)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex items-center gap-2 p-2 text-sm',
                    active === n.key ? 'bg-primary/10 text-primary' : 'text-foreground',
                  )}
                >
                  <n.icon className="size-4" />
                  <span className="truncate">{n.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ViewRouter({ user, active }: { user: MeUser; active: string }) {
  if (active === 'home') {
    if (user.roleName === 'Owner/Admin') return <OwnerDashboard user={user} />
    if (user.roleName === 'Accountant') return <AccountantDashboard user={user} />
    if (user.roleName === 'Salesman') return <SalesmanDashboard user={user} />
    if (user.roleName === 'Rider') return <RiderDashboard user={user} />
    return <OwnerDashboard user={user} />
  }
  if (active === 'setup') return <SetupView user={user} />
  if (active === 'business-accounts') return <BusinessAccountsView user={user} />
  if (active === 'coa') return <CoaView />
  if (active === 'users') return <UsersView user={user} />
  if (active === 'permissions') return <PermissionMatrixView user={user} />
  if (active === 'audit') return <AuditLogView />
  if (active === 'biz-day-test') return <BizDayTestView />

  // Phase 2+ screens — stubbed for Phase 1.
  if (active === 'sales') return <ComingSoonView title="Sales" phase="Phase 4" />
  if (active === 'purchases') return <ComingSoonView title="Purchases & Vendors" phase="Phase 5" />
  if (active === 'products') return <ComingSoonView title="Products & Stock" phase="Phase 3" />
  if (active === 'riders') return <ComingSoonView title="Riders & COD" phase="Phase 7" />
  if (active === 'vouchers') return <ComingSoonView title="Vouchers & Expenses" phase="Phase 2 & 6" />
  if (active === 'reports') return <ComingSoonView title="Reports" phase="Phase 8" />

  return <OwnerDashboard user={user} />
}
