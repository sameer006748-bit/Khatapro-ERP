export const PRODUCT_TOUR_VERSION = 'v1'
export const PRODUCT_TOUR_RESTART_EVENT = 'khatapro-product-tour-restart'

export type SupportedTourRole = 'Owner/Admin' | 'Accountant' | 'Salesman' | 'Rider'

export type TourStep = {
  id: string
  title: string
  body: string
  target?: string
  categoryId?: string
  pageKey?: string
}

export type ProductTour = {
  role: SupportedTourRole
  steps: TourStep[]
  finishPageKey: string
  finishLabel: string
}

export type OnboardingState = {
  status: 'completed' | 'dismissed'
  role: SupportedTourRole
  version: string
  updatedAt: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type StepCandidate = TourStep & {
  requiresAnyPage?: string[]
  targetCandidates?: Array<{ pageKey: string; target: string; categoryId?: string }>
}

const ALL_SALES_PAGES = ['counter-sale', 'online-sale', 'ofc-sale', 'other-sale']
const ACCOUNTING_PAGES = ['day-book', 'journal-voucher', 'receipt-voucher', 'payment-voucher', 'contra-entry', 'trial-balance', 'coa', 'reports']

const ROLE_STEPS: Record<SupportedTourRole, StepCandidate[]> = {
  'Owner/Admin': [
    {
      id: 'home',
      title: 'Your business at a glance',
      body: 'Home shows the current business position. Use the period selector to review today, recent days, this month or a custom range.',
      target: '[data-tour="page-content"]',
      pageKey: 'home',
      requiresAnyPage: ['home'],
    },
    {
      id: 'daily-work',
      title: 'Daily Work',
      body: 'Use Daily Work for everyday sales and customer transactions, including counter, online and out-of-city orders.',
      target: '[data-tour="nav-category-daily-work"]',
      categoryId: 'daily-work',
      requiresAnyPage: [...ALL_SALES_PAGES, 'sales-list'],
    },
    {
      id: 'delivery',
      title: 'Deliveries & Riders',
      body: 'Assign online orders, record delivery outcomes and review cash still held by riders.',
      target: '[data-tour="nav-page-delivery"]',
      categoryId: 'daily-work',
      pageKey: 'delivery',
      requiresAnyPage: ['delivery'],
    },
    {
      id: 'purchases',
      title: 'Purchases & Vendors',
      body: 'Record stock purchases, review purchase returns and keep vendor activity together.',
      target: '[data-tour="nav-page-purchases"]',
      categoryId: 'daily-work',
      pageKey: 'purchases',
      requiresAnyPage: ['purchases', 'vendors'],
    },
    {
      id: 'money',
      title: 'Money',
      body: 'Review business balances, manage petty cash and record supported internal transfers or owner funds.',
      target: '[data-tour="nav-category-money"]',
      categoryId: 'money',
      requiresAnyPage: ['accounts', 'petty-cash', 'owner-capital', 'contra-entry'],
    },
    {
      id: 'inventory',
      title: 'Inventory',
      body: 'Manage products, categories, current stock and stock adjustments from one workspace.',
      target: '[data-tour="nav-page-inventory"]',
      categoryId: 'inventory',
      pageKey: 'inventory',
      requiresAnyPage: ['inventory'],
    },
    {
      id: 'accounting',
      title: 'Accounting & Reports',
      body: 'Use this section to review books, ledgers, balances and financial reports without changing daily sales workflows.',
      target: '[data-tour="nav-category-accounting"]',
      categoryId: 'accounting',
      requiresAnyPage: ACCOUNTING_PAGES,
    },
    {
      id: 'settings',
      title: 'Settings & Access',
      body: 'Manage business accounts, users, roles and the access each team member needs.',
      target: '[data-tour="nav-category-settings"]',
      categoryId: 'settings',
      requiresAnyPage: ['setup', 'business-accounts', 'users', 'permissions'],
    },
    {
      id: 'finish',
      title: "You're ready to start",
      body: 'KhataPro is ready for your daily work. You can reopen this guide anytime from My Profile.',
    },
  ],
  Accountant: [
    {
      id: 'home',
      title: 'Your accounting overview',
      body: 'Home gives you a quick view of the business areas available to your role.',
      target: '[data-tour="page-content"]',
      pageKey: 'home',
      requiresAnyPage: ['home'],
    },
    {
      id: 'money',
      title: 'Money & Balances',
      body: 'Review business account balances and manage petty cash where your role allows it.',
      target: '[data-tour="nav-category-money"]',
      categoryId: 'money',
      requiresAnyPage: ['accounts', 'petty-cash'],
    },
    {
      id: 'purchases-expenses',
      title: 'Purchases & Expenses',
      body: 'Use the available daily-work pages to record purchases, vendor activity and business expenses.',
      target: '[data-tour="nav-category-daily-work"]',
      categoryId: 'daily-work',
      requiresAnyPage: ['purchases', 'vendors', 'expense-batch'],
    },
    {
      id: 'daily-accounting',
      title: 'Daily Accounting',
      body: 'Use these entries for receipts, payments, journals and day-to-day book review.',
      target: '[data-tour="nav-category-accounting"]',
      categoryId: 'accounting',
      requiresAnyPage: ACCOUNTING_PAGES,
    },
    {
      id: 'contra',
      title: 'Internal Transfers',
      body: 'Contra records money moved between business accounts through the supported workflow.',
      target: '[data-tour="nav-page-contra-entry"]',
      categoryId: 'accounting',
      pageKey: 'contra-entry',
      requiresAnyPage: ['contra-entry'],
    },
    {
      id: 'reports',
      title: 'Reports',
      body: 'Use the reports available to your role to review balances, account activity and financial position.',
      requiresAnyPage: ['reports', 'trial-balance', 'day-book'],
      targetCandidates: [
        { pageKey: 'reports', target: '[data-tour="nav-page-reports"]', categoryId: 'accounting' },
        { pageKey: 'trial-balance', target: '[data-tour="nav-page-trial-balance"]', categoryId: 'accounting' },
        { pageKey: 'day-book', target: '[data-tour="nav-page-day-book"]', categoryId: 'accounting' },
      ],
    },
    {
      id: 'finish',
      title: "You're ready to start",
      body: 'Your guide only includes workspaces available to your accounting role. You can restart it from My Profile.',
    },
  ],
  Salesman: [
    {
      id: 'home',
      title: 'Your work summary',
      body: 'Home keeps your available sales work and summary in one place.',
      target: '[data-tour="page-content"]',
      pageKey: 'home',
      requiresAnyPage: ['home'],
    },
    {
      id: 'sales',
      title: 'Create a sale',
      body: 'Use Daily Work for the sale types available to you. Choose the option that matches the customer order.',
      target: '[data-tour="nav-category-daily-work"]',
      categoryId: 'daily-work',
      requiresAnyPage: ALL_SALES_PAGES,
    },
    {
      id: 'primary-sale',
      title: 'Your sales workspace',
      body: 'Add products, confirm customer and payment details, then review the bill before posting.',
      requiresAnyPage: ALL_SALES_PAGES,
      targetCandidates: ALL_SALES_PAGES.map((pageKey) => ({
        pageKey,
        target: `[data-tour="nav-page-${pageKey}"]`,
        categoryId: 'daily-work',
      })),
    },
    {
      id: 'own-work',
      title: 'Review your work',
      body: 'Use your available sales list or personal reports to review posted work and follow up when needed.',
      requiresAnyPage: ['sales-list', 'my-reports'],
      targetCandidates: [
        { pageKey: 'sales-list', target: '[data-tour="nav-page-sales-list"]', categoryId: 'daily-work' },
        { pageKey: 'my-reports', target: '[data-tour="nav-page-my-reports"]', categoryId: 'daily-work' },
      ],
    },
    {
      id: 'finish',
      title: "You're ready to sell",
      body: 'Your guide only shows sales work available to your role. You can restart it from My Profile.',
    },
  ],
  Rider: [
    {
      id: 'orders',
      title: 'Your assigned orders',
      body: 'Home shows the orders assigned to you and the details needed for delivery.',
      target: '[data-tour="page-content"]',
      pageKey: 'home',
      requiresAnyPage: ['home'],
    },
    {
      id: 'delivery-actions',
      title: 'Record the delivery result',
      body: 'Use the delivery actions to record Delivered, Partial Delivery, Returned or Partial Return.',
      target: '[data-tour="nav-page-delivery"]',
      categoryId: 'daily-work',
      pageKey: 'delivery',
      requiresAnyPage: ['delivery'],
    },
    {
      id: 'cod',
      title: 'Check remaining cash',
      body: 'Your remaining cash amount is shown with your delivery work. Settlement is handled by authorized staff.',
      target: '[data-tour="nav-page-delivery"]',
      categoryId: 'daily-work',
      pageKey: 'delivery',
      requiresAnyPage: ['delivery'],
    },
  ],
}

function isSupportedRole(roleName: string): roleName is SupportedTourRole {
  return roleName in ROLE_STEPS
}

export function onboardingStorageKey(userId: string, version = PRODUCT_TOUR_VERSION): string {
  return `khataPro:onboarding:${version}:${encodeURIComponent(userId)}`
}

export function readOnboardingState(storage: StorageLike, userId: string): OnboardingState | null {
  try {
    const raw = storage.getItem(onboardingStorageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OnboardingState>
    if (
      (parsed.status !== 'completed' && parsed.status !== 'dismissed')
      || parsed.version !== PRODUCT_TOUR_VERSION
      || typeof parsed.role !== 'string'
      || !isSupportedRole(parsed.role)
    ) return null
    return parsed as OnboardingState
  } catch {
    return null
  }
}

export function writeOnboardingState(
  storage: StorageLike,
  userId: string,
  role: SupportedTourRole,
  status: OnboardingState['status'],
): void {
  try {
    storage.setItem(onboardingStorageKey(userId), JSON.stringify({
      status,
      role,
      version: PRODUCT_TOUR_VERSION,
      updatedAt: new Date().toISOString(),
    } satisfies OnboardingState))
  } catch {
    // The guide must remain usable when browser storage is unavailable.
  }
}

export function resetOnboardingState(storage: StorageLike, userId: string): void {
  try {
    storage.removeItem(onboardingStorageKey(userId))
  } catch {
    // A blocked preference store must not prevent a manual guide restart.
  }
}

export function buildProductTour(roleName: string, visiblePageKeys: Iterable<string>): ProductTour | null {
  if (!isSupportedRole(roleName)) return null
  const visible = new Set(visiblePageKeys)

  const steps = ROLE_STEPS[roleName].flatMap((candidate): TourStep[] => {
    if (candidate.requiresAnyPage && !candidate.requiresAnyPage.some((key) => visible.has(key))) return []
    const { requiresAnyPage: _required, targetCandidates, ...step } = candidate
    void _required
    if (!targetCandidates) return [step]
    const target = targetCandidates.find((option) => visible.has(option.pageKey))
    return target ? [{ ...step, ...target }] : []
  })

  const preferredFinish = (roleName === 'Owner/Admin' || roleName === 'Salesman') && visible.has('counter-sale')
    ? 'counter-sale'
    : 'home'

  return {
    role: roleName,
    steps,
    finishPageKey: preferredFinish,
    finishLabel: preferredFinish === 'counter-sale' ? 'Go to Counter Sale' : 'Stay on Home',
  }
}
