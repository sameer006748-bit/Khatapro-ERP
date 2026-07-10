'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
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
  MoreHorizontal,
  Scale,
  Plus,
  Sparkles,
  Tag,
  PackagePlus,
  TrendingDown,
  Clock,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import type { MeUser } from '@/components/erp/erp-app'
import { KhataProLogo } from '@/components/erp/logo'
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
import { JournalVoucherView } from '@/components/erp/views/journal-voucher-view'
import { TrialBalanceView } from '@/components/erp/views/trial-balance-view'
import { LedgerDrilldownView } from '@/components/erp/views/ledger-drilldown-view'
import { OpeningBalanceView } from '@/components/erp/views/opening-balance-view'
import { ProductCategoriesView } from '@/components/erp/views/product-categories-view'
import { ProductsView } from '@/components/erp/views/products-view'
import { StockAdjustmentView } from '@/components/erp/views/stock-adjustment-view'
import { NegativeStockReportView } from '@/components/erp/views/negative-stock-report-view'
import { PendingStockReportView } from '@/components/erp/views/pending-stock-report-view'
import { SupabaseStatusBadge } from '@/components/erp/supabase-status-badge'

type NavItem = {
  key: string
  label: string
  short: string
  icon: React.ComponentType<{ className?: string }>
  perm?: string
  ownerOnly?: boolean
}

const NAV: NavItem[] = [
  { key: 'home', label: 'Home', short: 'Home', icon: LayoutDashboard },
  { key: 'setup', label: 'Setup', short: 'Setup', icon: Settings, perm: 'can_view_setup' },
  { key: 'business-accounts', label: 'Business Accounts', short: 'Accounts', icon: Wallet, perm: 'can_view_setup' },
  { key: 'coa', label: 'Chart of Accounts', short: 'CoA', icon: BookOpen, perm: 'can_view_setup' },
  { key: 'users', label: 'Users & Roles', short: 'Users', icon: Users, ownerOnly: true },
  { key: 'permissions', label: 'Permission Matrix', short: 'Perms', icon: Shield, ownerOnly: true },
  { key: 'journal-voucher', label: 'Journal Voucher', short: 'JV', icon: ClipboardList, perm: 'can_post_journal_voucher' },
  { key: 'opening-balance', label: 'Opening Balance', short: 'Opening', icon: Plus, perm: 'can_post_opening_voucher' },
  { key: 'trial-balance', label: 'Trial Balance', short: 'TB', icon: Scale, perm: 'can_view_trial_balance' },
  { key: 'audit', label: 'Audit Log', short: 'Audit', icon: ScrollText, perm: 'can_view_audit_log' },
  { key: 'biz-day-test', label: 'Biz-Day Test', short: 'Date', icon: FileText },
  { key: 'product-categories', label: 'Product Categories', short: 'Cats', icon: Tag, perm: 'can_view_products' },
  { key: 'products', label: 'Products', short: 'Products', icon: Package, perm: 'can_view_products' },
  { key: 'stock-adjustment', label: 'Stock Adjustment', short: 'Adjust', icon: PackagePlus, perm: 'can_view_products' },
  { key: 'negative-stock', label: 'Negative Stock', short: 'Neg', icon: TrendingDown, perm: 'can_view_stock_report' },
  { key: 'pending-stock', label: 'Pending Stock', short: 'Pending', icon: Clock, perm: 'can_view_stock_report' },
  { key: 'sales', label: 'Sales', short: 'Sales', icon: ShoppingCart, perm: 'can_view_sales' },
  { key: 'purchases', label: 'Purchases', short: 'Buy', icon: Receipt, perm: 'can_view_purchases' },
  { key: 'riders', label: 'Riders', short: 'Riders', icon: Bike, perm: 'can_view_riders' },
  { key: 'vouchers', label: 'Vouchers', short: 'Vouchers', icon: ClipboardList, perm: 'can_view_vouchers' },
  { key: 'reports', label: 'Reports', short: 'Reports', icon: FileText, perm: 'can_view_trial_balance' },
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
  const [moreOpen, setMoreOpen] = useState(false)
  const nav = visibleNav(user)
  const searchParams = useSearchParams()
  const ledgerAccountId = searchParams.get('ledger')

  // If ?ledger= is in the URL, show the ledger drill-down instead.
  const effectiveActive = ledgerAccountId ? 'ledger-drilldown' : (nav.some((n) => n.key === active) ? active : 'home')

  // Mobile: first 4 items + "More" entry.
  const mobilePrimary = nav.slice(0, 4)
  const mobileOverflow = nav.slice(4)

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="h-14 border-b border-border flex items-center px-4 sm:px-6 bg-card/70 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <KhataProLogo size="sm" showWordmark={false} />
          <span className="font-semibold tracking-tight text-foreground hidden sm:inline">
            KhataPro <span className="text-primary">ERP</span>
          </span>
          <span className="hidden md:inline text-xs text-muted-foreground ml-2 px-2 py-0.5 bg-muted rounded-md">
            {user.roleName}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <SupabaseStatusBadge />
          <span className="hidden lg:inline text-xs text-muted-foreground" data-num>
            {new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs press-sm h-8"
            onClick={async () => {
              await signOut({ redirect: false })
              onSignOut()
            }}
          >
            <LogOut className="size-3.5 mr-1.5" /> Sign out
          </Button>
        </div>
      </header>

      {/* Desktop: sidebar + main / Mobile: main + bottom pill nav */}
      <div className="flex-1 flex">
        {/* Sidebar (desktop) */}
        <aside className="hidden md:flex w-60 border-r border-border bg-sidebar/60 flex-col backdrop-blur-sm">
          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {nav.map((n) => (
              <SidebarNavButton
                key={n.key}
                item={n}
                active={effectiveActive === n.key}
                onClick={() => {
                  // Strip ?ledger= when switching nav items.
                  if (ledgerAccountId) window.history.pushState({}, '', '/')
                  setActive(n.key)
                }}
              />
            ))}
          </nav>
          <div className="p-3 border-t border-border">
            <div className="card-3d p-3">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-full bg-accent grid place-items-center text-xs font-semibold text-accent-foreground">
                  {user.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm text-foreground truncate">
                    {user.displayName}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">{user.email}</div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto pb-28 md:pb-8">
          <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={effectiveActive + (ledgerAccountId ?? '')}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <ViewRouter user={user} active={effectiveActive} ledgerAccountId={ledgerAccountId} />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Mobile: liquid-glass pill bottom nav */}
      <MobilePillNav
        primary={mobilePrimary}
        active={effectiveActive}
        onSelect={(k) => {
          if (ledgerAccountId) window.history.pushState({}, '', '/')
          setActive(k)
        }}
        hasMore={mobileOverflow.length > 0}
        onMore={() => setMoreOpen(true)}
      />

      {/* Mobile "more" sheet */}
      {mobileOverflow.length > 0 && (
        <MobileMoreSheet
          items={mobileOverflow}
          active={active}
          open={moreOpen}
          onOpenChange={setMoreOpen}
          onSelect={(k) => {
            if (ledgerAccountId) window.history.pushState({}, '', '/')
            setActive(k)
            setMoreOpen(false)
          }}
        />
      )}
    </div>
  )
}

function SidebarNavButton({
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
        'relative w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg press-sm',
        active
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-primary"
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        />
      )}
      <item.icon className={cn('size-4 shrink-0', active && 'text-primary')} />
      <span className="truncate">{item.label}</span>
    </button>
  )
}

function MobilePillNav({
  primary,
  active,
  onSelect,
  hasMore,
  onMore,
}: {
  primary: NavItem[]
  active: string
  onSelect: (k: string) => void
  hasMore: boolean
  onMore: () => void
}) {
  return (
    <nav
      className="md:hidden fixed left-1/2 -translate-x-1/2 z-40 glass-pill rounded-full px-2 py-2 flex items-center gap-1"
      style={{
        bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
        maxWidth: 'calc(100vw - 1.5rem)',
      }}
      aria-label="Primary"
    >
      {primary.map((n) => {
        const isActive = active === n.key
        return (
          <button
            key={n.key}
            onClick={() => onSelect(n.key)}
            className="relative flex items-center justify-center press-sm"
            aria-label={n.label}
            aria-current={isActive ? 'page' : undefined}
          >
            {isActive && (
              <motion.span
                layoutId="pill-active"
                className="absolute inset-0 rounded-full bg-primary shadow-sm"
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
            <span
              className={cn(
                'relative z-10 grid place-items-center size-11 rounded-full',
                isActive ? 'text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              <n.icon className="size-5" />
            </span>
          </button>
        )
      })}
      {hasMore && (
        <button
          onClick={onMore}
          className="relative flex items-center justify-center press-sm"
          aria-label="More navigation"
        >
          <span className="grid place-items-center size-11 rounded-full text-muted-foreground">
            <MoreHorizontal className="size-5" />
          </span>
        </button>
      )}
    </nav>
  )
}

function MobileMoreSheet({
  items,
  active,
  open,
  onOpenChange,
  onSelect,
}: {
  items: NavItem[]
  active: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onSelect: (k: string) => void
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="md:hidden fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => onOpenChange(false)}
        >
          <motion.div
            className="absolute left-1/2 -translate-x-1/2 glass-card rounded-2xl p-3 w-[calc(100vw-2rem)] max-w-sm"
            style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.34, 1.4, 0.64, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 px-2">
              More
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {items.map((n) => {
                const isActive = active === n.key
                return (
                  <button
                    key={n.key}
                    onClick={() => onSelect(n.key)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-3 rounded-xl press-sm',
                      isActive ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted/60',
                    )}
                  >
                    <n.icon className={cn('size-5', isActive && 'text-primary')} />
                    <span className="text-[11px] font-medium truncate w-full text-center">
                      {n.short}
                    </span>
                  </button>
                )
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ViewRouter({
  user,
  active,
  ledgerAccountId,
}: {
  user: MeUser
  active: string
  ledgerAccountId: string | null
}) {
  // Ledger drill-down takes precedence when ?ledger= is set.
  if (active === 'ledger-drilldown' && ledgerAccountId) {
    return <LedgerDrilldownView accountId={ledgerAccountId} />
  }

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
  if (active === 'journal-voucher') return <JournalVoucherView />
  if (active === 'opening-balance') return <OpeningBalanceView />
  if (active === 'trial-balance') return <TrialBalanceView />
  if (active === 'audit') return <AuditLogView />
  if (active === 'biz-day-test') return <BizDayTestView />

  // Phase 3 — Products & Stock
  if (active === 'product-categories') return <ProductCategoriesView user={user} />
  if (active === 'products') return <ProductsView user={user} />
  if (active === 'stock-adjustment') return <StockAdjustmentView user={user} />
  if (active === 'negative-stock') return <NegativeStockReportView />
  if (active === 'pending-stock') return <PendingStockReportView />

  if (active === 'sales') return <ComingSoonView title="Sales" phase="Phase 4" />
  if (active === 'purchases') return <ComingSoonView title="Purchases & Vendors" phase="Phase 5" />
  if (active === 'riders') return <ComingSoonView title="Riders & COD" phase="Phase 7" />
  if (active === 'vouchers') return <JournalVoucherView />
  if (active === 'reports') return <ComingSoonView title="Reports" phase="Phase 8" />

  return <OwnerDashboard user={user} />
}

// Avoid unused-import error.
void Sparkles
