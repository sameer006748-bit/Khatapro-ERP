'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Settings,
  ShoppingCart,
  Globe2,
  Truck,
  ShoppingBag,
  ReceiptText,
  PackageCheck,
  PackagePlus,
  Store,
  HandCoins,
  Boxes,
  BookOpen,
  NotebookTabs,
  LogOut,
  WalletCards,
  Coins,
  Landmark,
  ShieldCheck,
  History,
  MoreHorizontal,
  Scale,
  BookPlus,
  Clock,
  ChevronDown,
  CalendarCheck2,
  ChartColumnBig,
  Home as HomeIcon,
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Sparkles,
  ListTree,
  FolderTree,
  FileChartColumn,
  PanelTop,
  UserCog,
  CircleUserRound,
  type LucideIcon,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { MeUser } from '@/components/erp/erp-app'
import { KhataProLogo } from '@/components/erp/logo'
import { OwnerDashboard } from '@/components/erp/views/owner-dashboard'
import { SalesmanDashboard } from '@/components/erp/views/salesman-dashboard'
import { RiderDashboard } from '@/components/erp/views/rider-dashboard'
import { SetupView } from '@/components/erp/views/setup-view'
import { UsersView } from '@/components/erp/views/users-view'
import { CoaView } from '@/components/erp/views/coa-view'
import { AccountClassificationView } from '@/components/erp/views/account-classification-view'
import { BusinessAccountsView } from '@/components/erp/views/business-accounts-view'
import { AuditLogView } from '@/components/erp/views/audit-log-view'
import { BizDayTestView } from '@/components/erp/views/biz-day-test-view'
import { PermissionMatrixView } from '@/components/erp/views/permission-matrix-view'
import { VouchersView } from '@/components/erp/views/vouchers-view'
import { TrialBalanceView } from '@/components/erp/views/trial-balance-view'
import { LedgerDrilldownView } from '@/components/erp/views/ledger-drilldown-view'
import { OpeningBalanceView } from '@/components/erp/views/opening-balance-view'
import { DayBookView } from '@/components/erp/views/day-book-view'
import { OwnerCapitalView } from '@/components/erp/views/voucher-forms-view'
import { ExpenseBatchView } from '@/components/erp/views/expense-batch-view'
import { PettyCashView } from '@/components/erp/views/petty-cash-view'
import { VoucherDetailView } from '@/components/erp/views/voucher-detail-view'
import { InventoryView } from '@/components/erp/views/inventory-view'
import { PurchasesView } from '@/components/erp/views/purchases-view'
import { VendorsView } from '@/components/erp/views/vendors-view'
import { CounterSaleView } from '@/components/erp/views/counter-sale-view'
import { OnlineSaleView } from '@/components/erp/views/online-sale-view'
import { OfcSaleView } from '@/components/erp/views/ofc-sale-view'
import { OtherSaleView } from '@/components/erp/views/other-sale-view'
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
import { ContextualPageHelp } from '@/components/erp/contextual-page-help'
import { ProductTourGuide } from '@/components/erp/product-tour'
import { AI_SCREENS, type AiScreen } from '@/lib/ai/safety-core'
import { getPageHelp } from '@/lib/onboarding/page-help'
import type { TourStep } from '@/lib/onboarding/product-tour'

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
  icon: LucideIcon
  perm?: string
  ownerOnly?: boolean
}

type NavCategory = {
  id: string
  label: string
  icon: LucideIcon
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
    icon: CalendarCheck2,
    items: [
      { key: 'counter-sale', label: 'Counter Sale', short: 'Counter', icon: ShoppingCart, perm: 'can_create_sales' },
      { key: 'online-sale', label: 'Online Sale', short: 'Online', icon: Globe2, perm: 'can_create_sales' },
      { key: 'ofc-sale', label: 'Out-of-City Sale', short: 'Out-of-City', icon: Truck, perm: 'can_create_sales' },
      { key: 'other-sale', label: 'Other Sale', short: 'Other', icon: ShoppingBag, perm: 'can_create_sales' },
      { key: 'sales-list', label: 'Sales List', short: 'Sales', icon: ReceiptText, perm: 'can_view_sales' },
      { key: 'delivery', label: 'Deliveries & Riders', short: 'Delivery', icon: PackageCheck, perm: 'can_view_delivery_orders' },
      { key: 'purchases', label: 'Purchases', short: 'Purchases', icon: PackagePlus, perm: 'can_view_purchases' },
      { key: 'vendors', label: 'Vendors', short: 'Vendors', icon: Store, perm: 'can_view_purchases' },
      { key: 'expense-batch', label: 'Expenses', short: 'Expenses', icon: HandCoins, perm: 'can_create_expense_batch' },
      { key: 'my-reports', label: 'My Sales Reports', short: 'My Reports', icon: ChartColumnBig, perm: 'can_view_own_sales' },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    icon: WalletCards,
    items: [
      { key: 'accounts', label: 'Accounts & Balances', short: 'Accounts', icon: WalletCards, perm: 'can_view_account_balances' },
      { key: 'petty-cash', label: 'Petty Cash', short: 'Petty Cash', icon: Coins, perm: 'can_manage_petty_cash' },
      { key: 'owner-capital', label: 'Capital & Drawings', short: 'Capital', icon: Landmark, ownerOnly: true },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: Boxes,
    items: [
      { key: 'inventory', label: 'Products & Stock', short: 'Stock', icon: Boxes, perm: 'can_view_products' },
    ],
  },
  {
    id: 'accounting',
    label: 'Advanced Accounting',
    icon: NotebookTabs,
    items: [
      { key: 'day-book', label: 'Day Book', short: 'Day Book', icon: BookOpen, perm: 'can_view_day_book' },
      { key: 'vouchers', label: 'Vouchers', short: 'Vouchers', icon: NotebookTabs, perm: 'can_view_day_book' },
      { key: 'trial-balance', label: 'Trial Balance', short: 'TB', icon: Scale, perm: 'can_view_trial_balance' },
      { key: 'opening-balance', label: 'Opening Balance', short: 'Opening', icon: BookPlus, perm: 'can_post_opening_voucher' },
      { key: 'coa', label: 'Chart of Accounts', short: 'Accounts', icon: ListTree, perm: 'can_view_setup' },
      { key: 'reports', label: 'Financial Reports', short: 'Reports', icon: FileChartColumn, perm: 'can_view_trial_balance' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    items: [
      { key: 'setup', label: 'Setup Overview', short: 'Setup', icon: PanelTop, perm: 'can_view_setup' },
      { key: 'business-accounts', label: 'Business Accounts', short: 'Accounts', icon: WalletCards, perm: 'can_view_setup' },
      { key: 'users', label: 'Users & Roles', short: 'Users', icon: UserCog, ownerOnly: true },
      { key: 'permissions', label: 'Roles & Permissions', short: 'Permissions', icon: ShieldCheck, ownerOnly: true },
      { key: 'audit', label: 'Audit Log', short: 'Audit', icon: History, perm: 'can_view_audit_log' },
      { key: 'ai-settings', label: 'KhataPro AI', short: 'AI', icon: Sparkles, ownerOnly: true },
      { key: 'my-profile', label: 'My Profile', short: 'Profile', icon: CircleUserRound },
    ],
  },
]

// Kept for direct owner-only diagnostics, but intentionally excluded from all
// normal client navigation and Setup surfaces.
const INTERNAL_PAGES: SubItem[] = [
  { key: 'biz-day-test', label: 'Business Day Diagnostic', short: 'Business Day', icon: Clock, ownerOnly: true },
]

// Setup detail pages: opened from the Setup overview cards (and by deep link)
// instead of taking a slot of their own in the main navigation.
const SETUP_DETAIL_PAGES: SubItem[] = [
  { key: 'account-classification', label: 'Account Classification', short: 'Classification', icon: FolderTree, perm: 'can_view_setup' },
]

// Legacy deep links stay available for tours, bookmarks and contextual actions;
// the visible navigation is consolidated under the single Vouchers workspace.
const LEGACY_VOUCHER_PAGES: SubItem[] = [
  { key: 'journal-voucher', label: 'Vouchers', short: 'Vouchers', icon: NotebookTabs, perm: 'can_create_journal_voucher' },
  { key: 'receipt-voucher', label: 'Vouchers', short: 'Vouchers', icon: ArrowDownToLine, perm: 'can_create_receipt_voucher' },
  { key: 'payment-voucher', label: 'Vouchers', short: 'Vouchers', icon: ArrowUpFromLine, perm: 'can_create_payment_voucher' },
  { key: 'contra-entry', label: 'Vouchers', short: 'Vouchers', icon: ArrowLeftRight, perm: 'can_create_contra' },
]

/** Flat map of every registered page key to its SubItem for quick lookup. */
const PAGE_REGISTRY: Map<string, SubItem> = new Map()
for (const cat of NAV_CATEGORIES) {
  for (const item of cat.items) {
    PAGE_REGISTRY.set(item.key, item)
  }
}
for (const item of INTERNAL_PAGES) PAGE_REGISTRY.set(item.key, item)
for (const item of SETUP_DETAIL_PAGES) PAGE_REGISTRY.set(item.key, item)
for (const item of LEGACY_VOUCHER_PAGES) PAGE_REGISTRY.set(item.key, item)

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
  icon: LucideIcon
  /** Resolve to a nav key, or null if not available for this role. */
  resolve: (user: MeUser) => string | null
}

const MOBILE_SLOTS: MobileSlot[] = [
  { id: 'home', label: 'Home', icon: HomeIcon, resolve: () => 'home' },
  { id: 'work', label: 'Daily Work', icon: CalendarCheck2, resolve: (u) => {
    if (u.roleName === 'Rider' && u.permissions.includes('can_view_own_orders')) return 'delivery'
    if (u.permissions.includes('can_create_sales')) return 'counter-sale'
    if (u.permissions.includes('can_view_day_book')) return 'day-book'
    if (u.permissions.includes('can_post_journal_voucher')) return 'journal-voucher'
    if (u.permissions.includes('can_view_trial_balance')) return 'trial-balance'
    return null
  }},
  { id: 'stock', label: 'Stock', icon: Boxes, resolve: (u) => {
    if (u.permissions.includes('can_view_products')) return 'inventory'
    return null
  }},
  { id: 'reports', label: 'Reports', icon: FileChartColumn, resolve: (u) => {
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
  const tourNavigationState = useRef<{ expanded: Set<string>; moreOpen: boolean } | null>(null)
  const searchParams = useSearchParams()
  const queryString = searchParams.toString()
  const ledgerAccountId = searchParams.get('ledger')
  const invoiceId = searchParams.get('invoice')
  const returnRequested = searchParams.get('return') === '1'
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
  // `active` needs no further validation: resolveInitialPage already checked it
  // against PAGE_REGISTRY and this role's permissions, and returned 'home' when
  // either failed. Re-checking it against the sidebar categories here would drop
  // every page that deliberately has no navigation slot — the Setup detail pages
  // and the legacy voucher deep links — back to Home despite being registered
  // and permitted.
  const effectiveActive = ledgerAccountId && canOpenLedger
    ? 'ledger-drilldown'
    : invoiceId && canOpenInvoice
    ? 'invoice-detail'
    : voucherId && canOpenVoucher
    ? 'voucher-detail'
    : active

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

  const visiblePageKeys = useMemo(
    () => cats.flatMap((category) => category.visibleItems.map((item) => item.key)),
    [cats],
  )

  const handleTourStepChange = useCallback((step: TourStep | null) => {
    if (!step) {
      const previous = tourNavigationState.current
      if (previous) {
        setExpanded(previous.expanded)
        setMoreOpen(previous.moreOpen)
        tourNavigationState.current = null
      }
      return
    }

    setExpanded((current) => {
      if (!tourNavigationState.current) {
        tourNavigationState.current = { expanded: new Set(current), moreOpen }
      }
      if (!step.categoryId || current.has(step.categoryId)) return current
      const next = new Set(current)
      next.add(step.categoryId)
      return next
    })

    const onMobile = window.matchMedia('(max-width: 767px)').matches
    if (!onMobile) return
    const isPrimaryPage = step.pageKey
      ? MOBILE_SLOTS.some((slot) => slot.resolve(user) === step.pageKey)
      : false
    setMoreOpen(Boolean(step.categoryId && !isPrimaryPage))
  }, [moreOpen, user])

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
          <nav className="flex-1 overflow-y-auto p-4 space-y-1" aria-label="Main navigation">
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

        {/* Main content. The reserved bottom room keeps a screen's last primary
            action clear of the floating bottom stack (nav, AI button, banners). */}
        <main className="flex-1 overflow-y-auto" style={{ paddingBottom: 'var(--kp-content-bottom)' }}>
          <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
            {(AI_SCREEN_SET.has(effectiveActive) || getPageHelp(effectiveActive)) && (
              <div className="flex flex-wrap justify-end gap-2 mb-3">
                <ContextualPageHelp pageKey={effectiveActive} />
                {AI_SCREEN_SET.has(effectiveActive) && <AiExplainButton screen={effectiveActive as AiScreen} />}
              </div>
            )}
            <AnimatePresence mode="wait">
              <motion.div
                data-tour="page-content"
                key={effectiveActive + (ledgerAccountId ?? '')}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <ViewRouter user={user} active={effectiveActive} ledgerAccountId={ledgerAccountId} invoiceId={invoiceId} returnRequested={returnRequested} voucherId={voucherId} />
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
      <ProductTourGuide
        user={user}
        visiblePageKeys={visiblePageKeys}
        onNavigate={selectItem}
        onStepChange={handleTourStepChange}
      />
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
        type="button"
        data-tour={`nav-page-${directItem.key}`}
        onClick={() => onSelect(directItem.key)}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'relative w-full min-h-10 flex items-center gap-2.5 px-2.5 py-1.5 text-sm rounded-xl press-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
          isActive
            ? 'bg-primary/[0.09] text-foreground font-semibold shadow-[inset_0_0_0_1px_rgba(16,185,129,0.12)]'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/70',
        )}
      >
        {isActive && (
          <motion.span
            layoutId="sidebar-active"
            className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-primary"
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        <span className={cn(
          'grid size-7 shrink-0 place-items-center rounded-lg transition-colors',
          isActive ? 'bg-primary/[0.14] text-primary' : 'text-muted-foreground',
        )}>
          <directItem.icon className="size-[18px]" strokeWidth={1.9} />
        </span>
        <span className="truncate">{category.label}</span>
      </button>
    )
  }

  return (
    <div>
      {/* Category header (click to expand/collapse) */}
      <button
        type="button"
        data-tour={`nav-category-${category.id}`}
        onClick={onToggle}
        aria-expanded={isExpanded}
        className={cn(
          'w-full min-h-10 flex items-center gap-2.5 px-2.5 py-1.5 text-sm rounded-xl press-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
          isActive
            ? 'text-foreground font-semibold bg-primary/[0.04]'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/70',
        )}
      >
        <span className={cn(
          'grid size-7 shrink-0 place-items-center rounded-lg transition-colors',
          isActive ? 'bg-primary/[0.12] text-primary' : 'text-muted-foreground',
        )}>
          <category.icon className="size-[18px]" strokeWidth={1.9} />
        </span>
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
                    type="button"
                    data-tour={`nav-page-${item.key}`}
                    onClick={() => onSelect(item.key)}
                    aria-current={isItemActive ? 'page' : undefined}
                    className={cn(
                      'relative w-full min-h-10 flex items-center gap-2.5 px-2 py-1.5 text-[13px] rounded-lg press-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                      isItemActive
                        ? 'bg-primary/[0.09] text-foreground font-semibold'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                    )}
                  >
                    {isItemActive && (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute -left-2 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-primary"
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      />
                    )}
                    <span className={cn(
                      'grid size-7 shrink-0 place-items-center rounded-lg transition-colors',
                      isItemActive ? 'bg-primary/[0.14] text-primary' : 'text-muted-foreground',
                    )}>
                      <item.icon className="size-[18px]" strokeWidth={1.9} />
                    </span>
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
        bottom: 'var(--kp-mobile-nav-bottom)',
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
            type="button"
            data-tour={`nav-page-${slot.key}`}
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
              <slot.icon className="size-5" strokeWidth={1.9} />
            </span>
          </button>
        )
      })}
      {hasMore && (
        <button
          type="button"
          onClick={onMore}
          className="relative flex items-center justify-center press-sm"
          aria-label="More navigation"
          style={{ minWidth: '48px', minHeight: '48px' }}
        >
          <span className="grid place-items-center size-11 rounded-full text-muted-foreground">
            <MoreHorizontal className="size-5" strokeWidth={1.9} />
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
              <div key={cat.id} className="mb-4 last:mb-0" data-tour={`nav-category-${cat.id}`}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 px-1 flex items-center gap-1.5">
                  <cat.icon className="size-3.5" strokeWidth={1.9} />
                  {cat.label}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {cat.visibleItems.map((item) => {
                    const isActive = active === item.key
                    return (
                      <button
                        key={item.key}
                        type="button"
                        data-tour={`nav-page-${item.key}`}
                        onClick={() => onSelect(item.key)}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'min-w-0 flex flex-col items-center gap-1.5 p-3 rounded-xl press-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                          isActive ? 'bg-primary/[0.09] text-foreground' : 'text-foreground hover:bg-muted/60',
                        )}
                      >
                        <span className={cn(
                          'grid size-9 place-items-center rounded-xl',
                          isActive ? 'bg-primary/[0.14] text-primary' : 'bg-muted/70 text-muted-foreground',
                        )}>
                          <item.icon className="size-5" strokeWidth={1.9} />
                        </span>
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
  returnRequested,
  voucherId,
}: {
  user: MeUser
  active: string
  ledgerAccountId: string | null
  invoiceId: string | null
  returnRequested: boolean
  voucherId: string | null
}) {
  // Ledger drill-down takes precedence when ?ledger= is set.
  if (active === 'ledger-drilldown' && ledgerAccountId) {
    return <LedgerDrilldownView accountId={ledgerAccountId} />
  }
  // Invoice detail when ?invoice= is set.
  if (active === 'invoice-detail' && invoiceId) {
    return <InvoiceDetailView invoiceId={invoiceId} openReturn={returnRequested} />
  }
  // Voucher detail when ?voucher= is set.
  if (active === 'voucher-detail' && voucherId) {
    return <VoucherDetailView voucherId={voucherId} onBack={() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')) }} />
  }

  if (active === 'home') {
    // One shared command center for both business-wide roles; section order and
    // section visibility are derived from permissions inside the component.
    if (user.roleName === 'Owner/Admin' || user.roleName === 'Accountant') return <OwnerDashboard user={user} />
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
  if (active === 'setup') return <SetupView
    user={user}
    canOpen={(key) => {
      const item = PAGE_REGISTRY.get(key)
      return Boolean(item && isItemVisible(user, item))
    }}
    onNavigate={(key) => {
      const item = PAGE_REGISTRY.get(key)
      if (!item || !isItemVisible(user, item)) return
      window.history.pushState({}, '', `/?page=${key}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }}
  />
  if (active === 'business-accounts') return <BusinessAccountsView user={user} />
  if (active === 'coa') return <CoaView />
  if (active === 'account-classification') return <AccountClassificationView user={user} />
  if (active === 'users') return <UsersView user={user} />
  if (active === 'permissions') return <PermissionMatrixView user={user} />
  if (active === 'vouchers') return <VouchersView user={user} />
  if (active === 'journal-voucher') return <VouchersView user={user} initialTab="journal" />
  if (active === 'receipt-voucher') return <VouchersView user={user} initialTab="receipt" />
  if (active === 'payment-voucher') return <VouchersView user={user} initialTab="payment" />
  if (active === 'contra-entry') return <VouchersView user={user} initialTab="contra" />
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
  if (active === 'other-sale') return <OtherSaleView user={user} />
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
