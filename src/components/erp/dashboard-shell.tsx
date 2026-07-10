'use client'

import { useState, useMemo } from 'react'
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
  Tag,
  PackagePlus,
  TrendingDown,
  Clock,
  ChevronDown,
  Briefcase,
  BarChart3,
  Home as HomeIcon,
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
import { CounterSaleView } from '@/components/erp/views/counter-sale-view'
import { OnlineSaleView } from '@/components/erp/views/online-sale-view'
import { OfcSaleView } from '@/components/erp/views/ofc-sale-view'
import { SalesListView } from '@/components/erp/views/sales-list-view'
import { InvoiceDetailView } from '@/components/erp/views/invoice-detail-view'
import { SupabaseStatusBadge } from '@/components/erp/supabase-status-badge'

// ─────────────────────────────────────────────────────────────
// Navigation model: 8 main categories, each with sub-items.
// Each sub-item has a permission/ownerOnly gate. A category is visible
// only if at least one of its sub-items is visible to the user.
// ─────────────────────────────────────────────────────────────

type SubItem = {
  key: string
  label: string
  short: string
  icon: React.ComponentType<{ className?: string }>
  perm?: string
  ownerOnly?: boolean
}

type NavCategory = {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** Optional direct key for categories that are also a page (e.g. Home). */
  directKey?: string
  items: SubItem[]
}

const NAV_CATEGORIES: NavCategory[] = [
  // 1. Dashboard
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    items: [
      { key: 'home', label: 'Home', short: 'Home', icon: HomeIcon },
    ],
  },
  // 2. Setup
  {
    id: 'setup',
    label: 'Setup',
    icon: Settings,
    items: [
      { key: 'setup', label: 'Setup Overview', short: 'Setup', icon: Settings, perm: 'can_view_setup' },
      { key: 'business-accounts', label: 'Business Accounts', short: 'Accounts', icon: Wallet, perm: 'can_view_setup' },
      { key: 'coa', label: 'Chart of Accounts', short: 'CoA', icon: BookOpen, perm: 'can_view_setup' },
      { key: 'users', label: 'Users & Roles', short: 'Users', icon: Users, ownerOnly: true },
      { key: 'permissions', label: 'Permission Matrix', short: 'Perms', icon: Shield, ownerOnly: true },
    ],
  },
  // 3. Accounting
  {
    id: 'accounting',
    label: 'Accounting',
    icon: Briefcase,
    items: [
      { key: 'journal-voucher', label: 'Journal Voucher', short: 'JV', icon: ClipboardList, perm: 'can_post_journal_voucher' },
      { key: 'opening-balance', label: 'Opening Balance', short: 'Opening', icon: Plus, perm: 'can_post_opening_voucher' },
      { key: 'trial-balance', label: 'Trial Balance', short: 'TB', icon: Scale, perm: 'can_view_trial_balance' },
      { key: 'vouchers', label: 'Vouchers', short: 'Vouchers', icon: ClipboardList, perm: 'can_view_vouchers' },
      { key: 'audit', label: 'Audit Log', short: 'Audit', icon: ScrollText, perm: 'can_view_audit_log' },
      { key: 'biz-day-test', label: 'Biz-Day Test', short: 'Date', icon: FileText },
    ],
  },
  // 4. Products & Stock
  {
    id: 'products-stock',
    label: 'Products & Stock',
    icon: Package,
    items: [
      { key: 'product-categories', label: 'Product Categories', short: 'Cats', icon: Tag, perm: 'can_view_products' },
      { key: 'products', label: 'Products', short: 'Products', icon: Package, perm: 'can_view_products' },
      { key: 'stock-adjustment', label: 'Stock Adjustment', short: 'Adjust', icon: PackagePlus, perm: 'can_view_products' },
      { key: 'negative-stock', label: 'Negative Stock', short: 'Neg', icon: TrendingDown, perm: 'can_view_stock_report' },
      { key: 'pending-stock', label: 'Pending Stock', short: 'Pending', icon: Clock, perm: 'can_view_stock_report' },
    ],
  },
  // 5. Sales (Phase 4)
  {
    id: 'sales',
    label: 'Sales',
    icon: ShoppingCart,
    items: [
      { key: 'counter-sale', label: 'Counter Sale', short: 'Counter', icon: ShoppingCart, perm: 'can_create_sales' },
      { key: 'online-sale', label: 'Online Sale', short: 'Online', icon: ShoppingCart, perm: 'can_create_sales' },
      { key: 'ofc-sale', label: 'OFC Sale', short: 'OFC', icon: ShoppingCart, perm: 'can_create_sales' },
      { key: 'sales-list', label: 'Sales List', short: 'List', icon: ClipboardList, perm: 'can_view_sales' },
    ],
  },
  // 6. Purchases (Phase 5 placeholder)
  {
    id: 'purchases',
    label: 'Purchases',
    icon: Receipt,
    items: [
      { key: 'purchases', label: 'Purchases', short: 'Buy', icon: Receipt, perm: 'can_view_purchases' },
    ],
  },
  // 7. Delivery / Riders (Phase 7 placeholder)
  {
    id: 'delivery',
    label: 'Delivery / Riders',
    icon: Bike,
    items: [
      { key: 'riders', label: 'Riders', short: 'Riders', icon: Bike, perm: 'can_view_riders' },
    ],
  },
  // 8. Reports (Phase 8 placeholder)
  {
    id: 'reports',
    label: 'Reports',
    icon: BarChart3,
    items: [
      { key: 'reports', label: 'Reports', short: 'Reports', icon: FileText, perm: 'can_view_trial_balance' },
    ],
  },
]

function isItemVisible(user: MeUser, item: SubItem): boolean {
  if (item.ownerOnly) return user.roleName === 'Owner/Admin'
  if (item.perm) return user.permissions.includes(item.perm)
  return true
}

function visibleCategories(user: MeUser): Array<NavCategory & { visibleItems: SubItem[] }> {
  return NAV_CATEGORIES.map((cat) => ({
    ...cat,
    visibleItems: cat.items.filter((item) => isItemVisible(user, item)),
  })).filter((cat) => cat.visibleItems.length > 0)
}

/** Find which category contains a given item key. */
function categoryForKey(key: string): string | null {
  for (const cat of NAV_CATEGORIES) {
    if (cat.items.some((i) => i.key === key)) return cat.id
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// Mobile nav: 5 primary slots — Home, Work, Stock, Reports, More.
// "Work" maps to the first available accounting action for the role.
// "Stock" maps to Products. "Reports" maps to Trial Balance / Negative Stock.
// ─────────────────────────────────────────────────────────────

type MobileSlot = {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** Resolve to a nav key, or null if not available for this role. */
  resolve: (user: MeUser) => string | null
}

const MOBILE_SLOTS: MobileSlot[] = [
  { id: 'home', label: 'Home', icon: HomeIcon, resolve: () => 'home' },
  { id: 'work', label: 'Work', icon: Briefcase, resolve: (u) => {
    if (u.permissions.includes('can_post_journal_voucher')) return 'journal-voucher'
    if (u.permissions.includes('can_view_trial_balance')) return 'trial-balance'
    if (u.permissions.includes('can_create_sales')) return 'sales'
    if (u.permissions.includes('can_view_own_orders')) return 'riders'
    return null
  }},
  { id: 'stock', label: 'Stock', icon: Package, resolve: (u) => {
    if (u.permissions.includes('can_view_products')) return 'products'
    return null
  }},
  { id: 'reports', label: 'Reports', icon: BarChart3, resolve: (u) => {
    if (u.permissions.includes('can_view_stock_report')) return 'negative-stock'
    if (u.permissions.includes('can_view_trial_balance')) return 'trial-balance'
    return null
  }},
]

// ─────────────────────────────────────────────────────────────
// Main shell
// ─────────────────────────────────────────────────────────────

export function DashboardShell({ user, onSignOut }: { user: MeUser; onSignOut: () => void }) {
  const [active, setActive] = useState('home')
  const [moreOpen, setMoreOpen] = useState(false)
  const searchParams = useSearchParams()
  const ledgerAccountId = searchParams.get('ledger')
  const invoiceId = searchParams.get('invoice')

  const cats = useMemo(() => visibleCategories(user), [user])

  // Expand state: default-expand the category that contains the active item.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const init = new Set<string>(['dashboard']) // dashboard always expanded
    const cat = categoryForKey('home')
    if (cat) init.add(cat)
    return init
  })

  // If ?ledger= or ?invoice= is in the URL, show that view instead.
  const effectiveActive = ledgerAccountId
    ? 'ledger-drilldown'
    : invoiceId
    ? 'invoice-detail'
    : cats.some((c) => c.visibleItems.some((i) => i.key === active))
    ? active
    : 'home'

  // When active changes, auto-expand its category.
  function selectItem(key: string) {
    if (ledgerAccountId) window.history.pushState({}, '', '/')
    setActive(key)
    const cat = categoryForKey(key)
    if (cat) {
      setExpanded((prev) => {
        const next = new Set(prev)
        next.add(cat)
        return next
      })
    }
  }

  function toggleCategory(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Mobile: resolve the 4 primary slots + "More" for everything else.
  const mobilePrimary: MobilePrimarySlot[] = MOBILE_SLOTS.map((slot) => ({
    ...slot,
    key: slot.resolve(user),
  })).filter((s): s is MobilePrimarySlot => s.key !== null)

  // Mobile "More": all visible items grouped by category, EXCLUDING the ones
  // already shown as primary slots.
  const mobilePrimaryKeys = new Set(mobilePrimary.map((s) => s.key))
  const mobileMoreCategories = cats
    .map((cat) => ({
      ...cat,
      visibleItems: cat.visibleItems.filter((item) => !mobilePrimaryKeys.has(item.key)),
    }))
    .filter((cat) => cat.visibleItems.length > 0)

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
        {/* Sidebar (desktop) — grouped collapsible categories */}
        <aside className="hidden md:flex w-64 border-r border-border bg-sidebar/60 flex-col backdrop-blur-sm">
          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {cats.map((cat) => (
              <SidebarCategory
                key={cat.id}
                category={cat}
                activeKey={effectiveActive}
                isExpanded={expanded.has(cat.id)}
                onToggle={() => toggleCategory(cat.id)}
                onSelect={selectItem}
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
                <ViewRouter user={user} active={effectiveActive} ledgerAccountId={ledgerAccountId} invoiceId={invoiceId} />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Mobile: liquid-glass pill bottom nav */}
      <MobilePillNav
        primary={mobilePrimary}
        active={effectiveActive}
        onSelect={selectItem}
        hasMore={mobileMoreCategories.some((c) => c.visibleItems.length > 0)}
        onMore={() => setMoreOpen(true)}
      />

      {/* Mobile "more" sheet — grouped by category */}
      {mobileMoreCategories.some((c) => c.visibleItems.length > 0) && (
        <MobileMoreSheet
          categories={mobileMoreCategories}
          active={active}
          open={moreOpen}
          onOpenChange={setMoreOpen}
          onSelect={(k) => {
            selectItem(k)
            setMoreOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Desktop sidebar: collapsible category with sub-items
// ─────────────────────────────────────────────────────────────

function SidebarCategory({
  category,
  activeKey,
  isExpanded,
  onToggle,
  onSelect,
}: {
  category: NavCategory & { visibleItems: SubItem[] }
  activeKey: string
  isExpanded: boolean
  onToggle: () => void
  onSelect: (k: string) => void
}) {
  // Special case: categories with exactly 1 visible item behave as a direct
  // button (no expand/collapse) — clicking goes straight to that item.
  const isDirect = category.visibleItems.length === 1
  const directItem = isDirect ? category.visibleItems[0] : null
  const isActive = directItem ? activeKey === directItem.key : activeKey !== 'home' && category.items.some((i) => i.key === activeKey)

  if (isDirect && directItem) {
    return (
      <button
        onClick={() => onSelect(directItem.key)}
        className={cn(
          'relative w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg press-sm',
          isActive
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
        )}
      >
        {isActive && (
          <motion.span
            layoutId="sidebar-active"
            className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-primary"
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        <directItem.icon className={cn('size-4 shrink-0', isActive && 'text-primary')} />
        <span className="truncate">{category.label}</span>
      </button>
    )
  }

  return (
    <div>
      {/* Category header (click to expand/collapse) */}
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg press-sm',
          isActive
            ? 'text-foreground font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
        )}
      >
        <category.icon className={cn('size-4 shrink-0', isActive && 'text-primary')} />
        <span className="truncate flex-1 text-left">{category.label}</span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 transition-transform',
            isExpanded && 'rotate-180',
          )}
        />
      </button>

      {/* Sub-items (collapsible) */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-2">
              {category.visibleItems.map((item) => {
                const isActive = activeKey === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => onSelect(item.key)}
                    className={cn(
                      'relative w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded-md press-sm',
                      isActive
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute -left-2 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-primary"
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      />
                    )}
                    <item.icon className={cn('size-3.5 shrink-0', isActive && 'text-primary')} />
                    <span className="truncate">{item.label}</span>
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Mobile: liquid-glass pill bottom nav
// ─────────────────────────────────────────────────────────────

type MobilePrimarySlot = MobileSlot & { key: string }

function MobilePillNav({
  primary,
  active,
  onSelect,
  hasMore,
  onMore,
}: {
  primary: MobilePrimarySlot[]
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
      {primary.map((slot) => {
        const isActive = active === slot.key
        return (
          <button
            key={slot.id}
            onClick={() => onSelect(slot.key!)}
            className="relative flex items-center justify-center press-sm"
            aria-label={slot.label}
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
              <slot.icon className="size-5" />
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

// ─────────────────────────────────────────────────────────────
// Mobile "More" sheet — grouped by category
// ─────────────────────────────────────────────────────────────

function MobileMoreSheet({
  categories,
  active,
  open,
  onOpenChange,
  onSelect,
}: {
  categories: Array<NavCategory & { visibleItems: SubItem[] }>
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
            className="absolute left-1/2 -translate-x-1/2 glass-card rounded-2xl p-4 w-[calc(100vw-2rem)] max-w-md max-h-[70vh] overflow-y-auto"
            style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.34, 1.4, 0.64, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {categories.map((cat) => (
              <div key={cat.id} className="mb-4 last:mb-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 px-1 flex items-center gap-1.5">
                  <cat.icon className="size-3" />
                  {cat.label}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {cat.visibleItems.map((item) => {
                    const isActive = active === item.key
                    return (
                      <button
                        key={item.key}
                        onClick={() => onSelect(item.key)}
                        className={cn(
                          'flex flex-col items-center gap-1.5 p-3 rounded-xl press-sm',
                          isActive ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted/60',
                        )}
                      >
                        <item.icon className={cn('size-5', isActive && 'text-primary')} />
                        <span className="text-[11px] font-medium truncate w-full text-center">
                          {item.short}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─────────────────────────────────────────────────────────────
// View router (unchanged logic)
// ─────────────────────────────────────────────────────────────

function ViewRouter({
  user,
  active,
  ledgerAccountId,
  invoiceId,
}: {
  user: MeUser
  active: string
  ledgerAccountId: string | null
  invoiceId: string | null
}) {
  // Ledger drill-down takes precedence when ?ledger= is set.
  if (active === 'ledger-drilldown' && ledgerAccountId) {
    return <LedgerDrilldownView accountId={ledgerAccountId} />
  }
  // Invoice detail when ?invoice= is set.
  if (active === 'invoice-detail' && invoiceId) {
    return <InvoiceDetailView invoiceId={invoiceId} />
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

  // Phase 4 — Sales
  if (active === 'counter-sale') return <CounterSaleView user={user} />
  if (active === 'online-sale') return <OnlineSaleView user={user} />
  if (active === 'ofc-sale') return <OfcSaleView user={user} />
  if (active === 'sales-list') return <SalesListView />

  if (active === 'purchases') return <ComingSoonView title="Purchases & Vendors" phase="Phase 5" />
  if (active === 'riders') return <ComingSoonView title="Riders & COD" phase="Phase 7" />
  if (active === 'vouchers') return <JournalVoucherView />
  if (active === 'reports') return <ComingSoonView title="Reports" phase="Phase 8" />

  return <OwnerDashboard user={user} />
}
