'use client'

import { useEffect, useState, useMemo } from 'react'
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
  Clock,
  ChevronDown,
  Briefcase,
  BarChart3,
  Home as HomeIcon,
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Sparkles,
  DollarSign,
  Banknote,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
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
import { DayBookView } from '@/components/erp/views/day-book-view'
import { PaymentVoucherView, ReceiptVoucherView, ContraEntryView, OwnerCapitalView } from '@/components/erp/views/voucher-forms-view'
import { ExpenseBatchView } from '@/components/erp/views/expense-batch-view'
import { PettyCashView } from '@/components/erp/views/petty-cash-view'
import { VoucherDetailView } from '@/components/erp/views/voucher-detail-view'
import { ProductCategoriesView } from '@/components/erp/views/product-categories-view'
import { ProductsView } from '@/components/erp/views/products-view'
import { StockAdjustmentView } from '@/components/erp/views/stock-adjustment-view'
import { NegativeStockReportView } from '@/components/erp/views/negative-stock-report-view'
import { PendingStockReportView } from '@/components/erp/views/pending-stock-report-view'
import { InventoryView } from '@/components/erp/views/inventory-view'
import { PurchasesView } from '@/components/erp/views/purchases-view'
import { VendorsView } from '@/components/erp/views/vendors-view'
import { CounterSaleView } from '@/components/erp/views/counter-sale-view'
import { OnlineSaleView } from '@/components/erp/views/online-sale-view'
import { OfcSaleView } from '@/components/erp/views/ofc-sale-view'
import { SalesListView } from '@/components/erp/views/sales-list-view'
import { InvoiceDetailView } from '@/components/erp/views/invoice-detail-view'
import { DeliveryView } from '@/components/erp/views/delivery-view'
import { ReportsView } from '@/components/erp/views/reports-view'
import { SalesmanReportsView } from '@/components/erp/views/salesman-reports-view'
import { AccountsView } from '@/components/erp/views/accounts-view'
import { AdvancedView } from '@/components/erp/views/advanced-view'
import { AiSettingsView } from '@/components/erp/views/ai-settings-view'
import { MyProfileView } from '@/components/erp/views/my-profile-view'
import { AiExplainButton } from '@/components/erp/ai-actions'
import { AI_SCREENS, type AiScreen } from '@/lib/ai/safety-core'

import { SupabaseStatusBadge } from '@/components/erp/supabase-status-badge'

const LazyAiAssistant = dynamic(
  () => import('@/components/erp/ai-assistant').then((module) => module.AiAssistant),
  { ssr: false },
)
const AI_SCREEN_SET = new Set<string>(AI_SCREENS)

// ──────────────────────────────────────────────────────────────────────────
// Navigation model: 6 compact top-level groups — Home, Daily Work, Money,
// Inventory, Advanced Accounting, Settings.
// Each sub-item has a permission/ownerOnly gate. A category is visible
// only if at least one of its sub-items is visible to the user.
// ──────────────────────────────────────────────────────────────────────────

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
  {
    id: 'dashboard',
    label: 'Home',
    icon: HomeIcon,
    items: [
      { key: 'home', label: 'Dashboard', short: 'Home', icon: LayoutDashboard },
    ],
  },
  {
    id: 'daily-work',
    label: 'Daily Work',
    icon: Briefcase,
    items: [
      { key: 'counter-sale', label: 'Counter Sale', short: 'Counter', icon: ShoppingCart, perm: 'can_create_sales' },
      { key: 'online-sale', label: 'Online Sale', short: 'Online', icon: ShoppingCart, perm: 'can_create_sales' },
      { key: 'ofc-sale', label: 'OFC Sale', short: 'OFC', icon: ShoppingCart, perm: 'can_create_sales' },
      { key: 'sales-list', label: 'Sales List', short: 'List', icon: ClipboardList, perm: 'can_view_sales' },
      { key: 'delivery', label: 'Delivery / Riders', short: 'Delivery', icon: Bike, perm: 'can_view_delivery_orders' },
      { key: 'purchases', label: 'Purchase Bills', short: 'Purchases', icon: Receipt, perm: 'can_view_purchases' },
      { key: 'vendors', label: 'Vendors', short: 'Vendors', icon: Users, perm: 'can_view_purchases' },
      { key: 'expense-batch', label: 'Add Expense', short: 'Expenses', icon: Receipt, perm: 'can_create_expense_batch' },
      { key: 'my-reports', label: 'Salesman Reports', short: 'Reports', icon: BarChart3, perm: 'can_view_own_sales' },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    icon: Wallet,
    items: [
      { key: 'accounts', label: 'Accounts & Balances', short: 'Accounts', icon: DollarSign, perm: 'can_view_account_balances' },
      { key: 'petty-cash', label: 'Petty Cash', short: 'Petty', icon: Wallet, perm: 'can_manage_petty_cash' },
      { key: 'owner-capital', label: 'Capital & Drawings', short: 'Capital', icon: Banknote, ownerOnly: true },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: Package,
    items: [
      { key: 'inventory', label: 'Products & Stock', short: 'Stock', icon: Package, perm: 'can_view_products' },
    ],
  },
  {
    id: 'accounting',
    label: 'Advanced Accounting',
    icon: BookOpen,
    items: [
      { key: 'day-book', label: 'Day Book', short: 'Day Book', icon: BookOpen, perm: 'can_view_day_book' },
      { key: 'journal-voucher', label: 'Journal Voucher', short: 'JV', icon: ClipboardList, perm: 'can_create_journal_voucher' },
      { key: 'receipt-voucher', label: 'Receipt Voucher', short: 'Receipt', icon: ArrowDownToLine, perm: 'can_create_receipt_voucher' },
      { key: 'payment-voucher', label: 'Payment Voucher', short: 'Payment', icon: ArrowUpFromLine, perm: 'can_create_payment_voucher' },
      { key: 'contra-entry', label: 'Contra Entry', short: 'Contra', icon: ArrowLeftRight, perm: 'can_create_contra' },
      { key: 'trial-balance', label: 'Trial Balance', short: 'TB', icon: Scale, perm: 'can_view_trial_balance' },
      { key: 'opening-balance', label: 'Opening Balance', short: 'Opening', icon: Plus, perm: 'can_post_opening_voucher' },
      { key: 'coa', label: 'Chart of Accounts', short: 'CoA', icon: BookOpen, perm: 'can_view_setup' },
      { key: 'reports', label: 'Financial Reports', short: 'Reports', icon: FileText, perm: 'can_view_trial_balance' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    items: [
      { key: 'setup', label: 'Setup Overview', short: 'Setup', icon: Settings, perm: 'can_view_setup' },
      { key: 'business-accounts', label: 'Business Accounts', short: 'Accounts', icon: Wallet, perm: 'can_view_setup' },
      { key: 'users', label: 'Users & Roles', short: 'Users', icon: Users, ownerOnly: true },
      { key: 'permissions', label: 'Permission Matrix', short: 'Perms', icon: Shield, ownerOnly: true },
      { key: 'audit', label: 'Audit Log', short: 'Audit', icon: ScrollText, perm: 'can_view_audit_log' },
      { key: 'ai-settings', label: 'AI Settings', short: 'AI', icon: Sparkles, ownerOnly: true },
      { key: 'biz-day-test', label: 'Biz-Day Test', short: 'Biz-Day', icon: Clock, ownerOnly: true },
      { key: 'my-profile', label: 'My Profile', short: 'Profile', icon: Shield },
    ],
  },
]

/** Flat map of every registered page key to its SubItem for quick lookup. */
const PAGE_REGISTRY: Map<string, SubItem> = new Map()
for (const cat of NAV_CATEGORIES) {
  for (const item of cat.items) {
    PAGE_REGISTRY.set(item.key, item)
  }
}

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

// ──────────────────────────────────────────────────────────────────────────
// Mobile nav: 5 primary slots — Home, Work, Stock, Reports, More.
// "Work" maps to the first available accounting action for the role.
// "Stock" maps to Products. "Reports" maps to Trial Balance / Negative Stock.
// ──────────────────────────────────────────────────────────────────────────

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
    if (u.roleName === 'Rider' && u.permissions.includes('can_view_own_orders')) return 'delivery'
    if (u.permissions.includes('can_create_sales')) return 'counter-sale'
    if (u.permissions.includes('can_view_day_book')) return 'day-book'
    if (u.permissions.includes('can_post_journal_voucher')) return 'journal-voucher'
    if (u.permissions.includes('can_view_trial_balance')) return 'trial-balance'
    return null
  }},
  { id: 'stock', label: 'Stock', icon: Package, resolve: (u) => {
    if (u.permissions.includes('can_view_products')) return 'inventory'
    return null
  }},
  { id: 'reports', label: 'Reports', icon: BarChart3, resolve: (u) => {
    if (u.permissions.includes('can_view_own_sales') && !u.permissions.includes('can_view_trial_balance')) return 'my-reports'
    if (u.permissions.includes('can_view_trial_balance')) return 'reports'
    return null
  }},
]

// ──────────────────────────────────────────────────────────────────────────
// Main shell
// ──────────────────────────────────────────────────────────────────────────

function resolveInitialPage(searchParams: URLSearchParams, user: MeUser): string {
  const page = searchParams.get('page')
  if (page && PAGE_REGISTRY.has(page)) {
    const item = PAGE_REGISTRY.get(page)!
    if (isItemVisible(user, item)) return page
  }
  return 'home'
}

export function DashboardShell({ user, onSignOut }: { user: MeUser; onSignOut: () => void }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const searchParams = useSearchParams()
  const queryString = searchParams.toString()
  const ledgerAccountId = searchParams.get('ledger')
  const invoiceId = searchParams.get('invoice')
  const voucherId = searchParams.get('voucher')

  const active = resolveInitialPage(searchParams, user)

  const cats = useMemo(() => visibleCategories(user), [user])

  // Expand state: all groups collapsed by default; only the active page's
  // group starts open (Home is a direct entry, never a collapsible group).
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const init = new Set<string>()
    const activeCat = categoryForKey(active)
    if (activeCat && activeCat !== 'dashboard') init.add(activeCat)
    return init
  })

  const canOpenLedger = user.permissions.includes('can_view_ledgers')
  const canOpenInvoice = user.permissions.includes('can_view_sales') || user.permissions.includes('can_view_own_sales')
  const canOpenVoucher = user.permissions.includes('can_view_day_book') || user.permissions.includes('can_view_vouchers')

  // Native history navigation changes the query string independently of local
  // component state. Keep the rendered page and selected navigation item in
  // lockstep, and fail closed when a direct URL requests a page/detail the
  // current role cannot see.
  useEffect(() => {
    const params = new URLSearchParams(queryString)
    const requestedPage = params.get('page')
    const nextPage = resolveInitialPage(params, user)

    let corrected = false
    if (requestedPage && requestedPage !== nextPage) {
      params.set('page', nextPage)
      corrected = true
    }
    if (params.has('ledger') && !canOpenLedger) {
      params.delete('ledger')
      corrected = true
    }
    if (params.has('invoice') && !canOpenInvoice) {
      params.delete('invoice')
      corrected = true
    }
    if (params.has('voucher') && !canOpenVoucher) {
      params.delete('voucher')
      corrected = true
    }

    if (corrected) {
      const nextUrl = params.size > 0 ? `/?${params.toString()}` : '/'
      window.history.replaceState({}, '', nextUrl)
    }
  }, [queryString, user, canOpenLedger, canOpenInvoice, canOpenVoucher])

  // If ?ledger= or ?invoice= or ?voucher= is in the URL, show that view instead.
  const effectiveActive = ledgerAccountId && canOpenLedger
    ? 'ledger-drilldown'
    : invoiceId && canOpenInvoice
    ? 'invoice-detail'
    : voucherId && canOpenVoucher
    ? 'voucher-detail'
    : cats.some((c) => c.visibleItems.some((i) => i.key === active))
    ? active
    : 'home'

  // When active changes, auto-expand its category and sync ?page= to URL.
  function selectItem(key: string) {
    const url = new URL(window.location.href)
    url.searchParams.delete('ledger')
    url.searchParams.delete('invoice')
    url.searchParams.delete('voucher')
    url.searchParams.set('page', key)
    window.history.pushState({}, '', url.toString())
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
      <header className="h-14 border-b border-white/10 flex items-center px-4 sm:px-6 bg-white/70 dark:bg-white/5 backdrop-blur-2xl sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <KhataProLogo size="sm" showWordmark={false} />
          <span className="font-semibold tracking-tight text-foreground hidden sm:inline">
            KhataPro <span className="text-primary">ERP</span>
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <SupabaseStatusBadge />
          <span className="hidden lg:inline text-[11px] text-muted-foreground" data-num>
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
        {/* Sidebar (desktop) — premium glass surface */}
        <aside className="hidden md:flex w-72 border-r border-white/10 bg-white/70 dark:bg-white/5 backdrop-blur-2xl flex-col shadow-[0_8px_32px_rgba(0,0,0,0.04)]">
          <nav className="flex-1 overflow-y-auto p-4 space-y-1">
            {renderSidebarCategories(cats, effectiveActive, expanded, toggleCategory, selectItem)}
          </nav>
          <div className="p-4 border-t border-white/10">
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-xl p-3 shadow-[0_4px_16px_rgba(0,0,0,0.04)]">
              <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-transparent" />
              <div className="relative flex items-center gap-3">
                <div className="size-10 rounded-full bg-primary/10 text-primary grid place-items-center text-sm font-bold">
                  {user.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground truncate">
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
            {AI_SCREEN_SET.has(effectiveActive) && (
              <div className="flex justify-end mb-3">
                <AiExplainButton screen={effectiveActive as AiScreen} />
              </div>
            )}
            <AnimatePresence mode="wait">
              <motion.div
                key={effectiveActive + (ledgerAccountId ?? '')}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <ViewRouter user={user} active={effectiveActive} ledgerAccountId={ledgerAccountId} invoiceId={invoiceId} voucherId={voucherId} />
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
      <LazyAiAssistant user={user} activeScreen={effectiveActive} />
    </div>
  )
}

/** Render the six top-level sidebar groups */
function renderSidebarCategories(
  cats: Array<NavCategory & { visibleItems: SubItem[] }>,
  activeKey: string,
  expanded: Set<string>,
  onToggle: (id: string) => void,
  onSelect: (k: string) => void,
) {
  return (
    <div className="space-y-0.5">
      {cats.map((cat) => (
        <SidebarCategory
          key={cat.id}
          category={cat}
          activeKey={activeKey}
          isExpanded={expanded.has(cat.id)}
          onToggle={() => onToggle(cat.id)}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Desktop sidebar: collapsible category with sub-items
// ──────────────────────────────────────────────────────────────────────────

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
                const isItemActive = activeKey === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => onSelect(item.key)}
                    className={cn(
                      'relative w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded-md press-sm',
                      isItemActive
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
                    )}
                  >
                    {isItemActive && (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute -left-2 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-primary"
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      />
                    )}
                    <item.icon className={cn('size-3.5 shrink-0', isItemActive && 'text-primary')} />
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

// ──────────────────────────────────────────────────────────────────────────
// Mobile: liquid-glass pill bottom nav
// ──────────────────────────────────────────────────────────────────────────

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
      className="md:hidden fixed left-1/2 -translate-x-1/2 z-40 glass-pill rounded-full px-3 py-3 flex items-center gap-2"
      style={{
        bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
        maxWidth: 'calc(100vw - 2rem)',
        minHeight: '64px',
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
            style={{ minWidth: '48px', minHeight: '48px' }}
          >
            {isActive && (
              <motion.span
                layoutId="pill-active"
                className="absolute inset-0 rounded-full bg-primary shadow-md"
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
            <span
              className={cn(
                'relative z-10 grid place-items-center size-11 rounded-full',
                isActive ? 'text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              <slot.icon className="size-6" />
            </span>
          </button>
        )
      })}
      {hasMore && (
        <button
          onClick={onMore}
          className="relative flex items-center justify-center press-sm"
          aria-label="More navigation"
          style={{ minWidth: '48px', minHeight: '48px' }}
        >
          <span className="grid place-items-center size-11 rounded-full text-muted-foreground">
            <MoreHorizontal className="size-6" />
          </span>
        </button>
      )}
    </nav>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Mobile "More" sheet — grouped by category
// ──────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────
// View router (unchanged logic)
// ──────────────────────────────────────────────────────────────────────────

function ViewRouter({
  user,
  active,
  ledgerAccountId,
  invoiceId,
  voucherId,
}: {
  user: MeUser
  active: string
  ledgerAccountId: string | null
  invoiceId: string | null
  voucherId: string | null
}) {
  // Ledger drill-down takes precedence when ?ledger= is set.
  if (active === 'ledger-drilldown' && ledgerAccountId) {
    return <LedgerDrilldownView accountId={ledgerAccountId} />
  }
  // Invoice detail when ?invoice= is set.
  if (active === 'invoice-detail' && invoiceId) {
    return <InvoiceDetailView invoiceId={invoiceId} />
  }
  // Voucher detail when ?voucher= is set.
  if (active === 'voucher-detail' && voucherId) {
    return <VoucherDetailView voucherId={voucherId} onBack={() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')) }} />
  }

  if (active === 'home') {
    if (user.roleName === 'Owner/Admin') return <OwnerDashboard user={user} />
    if (user.roleName === 'Accountant') return <AccountantDashboard user={user} />
    if (user.roleName === 'Salesman') return <SalesmanDashboard user={user} />
    if (user.roleName === 'Rider') return <RiderDashboard user={user} />
    // No Owner fallback: unknown roles must never see Owner-only business data.
    return (
      <div className="card-3d p-8 text-center max-w-md mx-auto">
        <p className="text-sm font-medium text-foreground">Welcome, {user.displayName}.</p>
        <p className="text-xs text-muted-foreground mt-1">Your dashboard isn’t configured for this role. Use the menu to open your available workspaces, or open My Profile.</p>
      </div>
    )
  }
  if (active === 'setup') return <SetupView user={user} />
  if (active === 'business-accounts') return <BusinessAccountsView user={user} />
  if (active === 'coa') return <CoaView />
  if (active === 'users') return <UsersView user={user} />
  if (active === 'permissions') return <PermissionMatrixView user={user} />
  if (active === 'journal-voucher') return <JournalVoucherView user={user} />
  if (active === 'receipt-voucher') return <ReceiptVoucherView user={user} />
  if (active === 'payment-voucher') return <PaymentVoucherView user={user} />
  if (active === 'contra-entry') return <ContraEntryView user={user} />
  if (active === 'owner-capital') return <OwnerCapitalView user={user} />
  if (active === 'petty-cash') return <PettyCashView user={user} />
  if (active === 'expense-batch') return <ExpenseBatchView user={user} />
  if (active === 'day-book') return <DayBookView user={user} onSelectVoucher={(id) => { window.history.pushState({}, '', `/?voucher=${id}`); window.dispatchEvent(new PopStateEvent('popstate')) }} />
  if (active === 'opening-balance') return <OpeningBalanceView user={user} />
  if (active === 'trial-balance') return <TrialBalanceView />
  if (active === 'audit') return <AuditLogView />
  if (active === 'biz-day-test') return <BizDayTestView />

  // Inventory (merged Products & Stock)
  if (active === 'inventory') return <InventoryView user={user} />
  // Old URLs redirect to inventory
  if (active === 'product-categories' || active === 'products' || active === 'stock-adjustment' || active === 'negative-stock' || active === 'pending-stock') {
    return <InventoryView user={user} />
  }

  // Phase 4 — Sales
  if (active === 'counter-sale') return <CounterSaleView user={user} />
  if (active === 'online-sale') return <OnlineSaleView user={user} />
  if (active === 'ofc-sale') return <OfcSaleView user={user} />
  if (active === 'sales-list') return <SalesListView />

  if (active === 'purchases') return <PurchasesView user={user} />
  if (active === 'vendors') return <VendorsView user={user} />

  // Phase 7 — Delivery & Riders
  if (active === 'delivery') return <DeliveryView user={user} />
  if (active === 'riders') return <DeliveryView user={user} />

  // Phase 8 — Reports
  if (active === 'reports') return <ReportsView user={user} />
  if (active === 'my-reports') return <SalesmanReportsView user={user} />

  // AI Settings (Phase 10)
  if (active === 'ai-settings' && user.roleName === 'Owner/Admin') return <AiSettingsView />
  if (active === 'my-profile') return <MyProfileView user={user} />

  // Advanced
  if (active === 'accounts') return <AccountsView user={user} />
  if (active === 'advanced') return <AdvancedView user={user} />

  if (active === 'vouchers') return <DayBookView user={user} onSelectVoucher={(id) => { window.history.pushState({}, '', `/?voucher=${id}`); window.dispatchEvent(new PopStateEvent('popstate')) }} />

  return (
    <div className="card-3d p-8 text-center max-w-md mx-auto">
      <p className="text-sm font-medium text-foreground">Page unavailable</p>
      <p className="text-xs text-muted-foreground mt-1">This page is not available for your role.</p>
    </div>
  )
}
