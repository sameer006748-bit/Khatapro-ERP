import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  PRODUCT_TOUR_RESTART_EVENT,
  PRODUCT_TOUR_VERSION,
  buildProductTour,
  onboardingStorageKey,
  readOnboardingState,
  resetOnboardingState,
  writeOnboardingState,
} from '../src/lib/onboarding/product-tour.ts'
import { PAGE_HELP } from '../src/lib/onboarding/page-help.ts'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

const shell = await readFile('src/components/erp/dashboard-shell.tsx', 'utf8')
const guide = await readFile('src/components/erp/product-tour.tsx', 'utf8')
const profile = await readFile('src/components/erp/views/my-profile-view.tsx', 'utf8')

const ownerPages = [
  'home', 'counter-sale', 'online-sale', 'ofc-sale', 'other-sale', 'sales-list',
  'delivery', 'purchases', 'vendors', 'expense-batch', 'accounts', 'petty-cash',
  'owner-capital', 'inventory', 'day-book', 'journal-voucher', 'receipt-voucher',
  'payment-voucher', 'contra-entry', 'trial-balance', 'coa', 'reports', 'setup',
  'business-accounts', 'users', 'permissions',
]

const accountantPages = [
  'home', 'accounts', 'petty-cash', 'purchases', 'vendors', 'expense-batch',
  'day-book', 'journal-voucher', 'receipt-voucher', 'payment-voucher',
  'contra-entry', 'trial-balance', 'coa', 'reports',
]

const salesmanPages = ['home', 'counter-sale', 'online-sale', 'sales-list', 'my-reports']
const riderPages = ['home', 'delivery', 'my-profile']

test('Owner/Admin receives the complete nine-step business overview', () => {
  const tour = buildProductTour('Owner/Admin', ownerPages)
  assert.ok(tour)
  assert.equal(tour.steps.length, 9)
  assert.deepEqual(tour.steps.map((step) => step.id), [
    'home', 'daily-work', 'delivery', 'purchases', 'money', 'inventory', 'accounting', 'settings', 'finish',
  ])
  assert.equal(tour.finishPageKey, 'counter-sale')
})

test('Accountant receives seven focused money, entry and report steps', () => {
  const tour = buildProductTour('Accountant', accountantPages)
  assert.ok(tour)
  assert.equal(tour.steps.length, 7)
  assert.deepEqual(tour.steps.map((step) => step.id), [
    'home', 'money', 'purchases-expenses', 'daily-accounting', 'contra', 'reports', 'finish',
  ])
  assert.doesNotMatch(JSON.stringify(tour), /users|permissions|owner-capital/i)
})

test('Salesman receives a five-step sales-only guide', () => {
  const tour = buildProductTour('Salesman', salesmanPages)
  assert.ok(tour)
  assert.equal(tour.steps.length, 5)
  assert.deepEqual(tour.steps.map((step) => step.id), ['home', 'sales', 'primary-sale', 'own-work', 'finish'])
  assert.doesNotMatch(JSON.stringify(tour), /balance sheet|permission|rider settlement|owner settings/i)
})

test('Rider receives the intentionally short three-step delivery guide', () => {
  const tour = buildProductTour('Rider', riderPages)
  assert.ok(tour)
  assert.equal(tour.steps.length, 3)
  assert.deepEqual(tour.steps.map((step) => step.id), ['orders', 'delivery-actions', 'cod'])
  assert.doesNotMatch(JSON.stringify(tour), /accounting|purchase|permission|financial report/i)
})

test('steps requiring inaccessible navigation are excluded', () => {
  const limitedAccountant = buildProductTour('Accountant', ['home', 'accounts', 'day-book'])
  assert.ok(limitedAccountant)
  assert.deepEqual(limitedAccountant.steps.map((step) => step.id), ['home', 'money', 'daily-accounting', 'reports', 'finish'])
  assert.ok(limitedAccountant.steps.every((step) => !step.pageKey || ['home', 'accounts', 'day-book'].includes(step.pageKey)))
  assert.equal(buildProductTour('Unknown Role', ownerPages), null)
})

test('first eligible login has no state until completed or dismissed', () => {
  const storage = new MemoryStorage()
  assert.equal(readOnboardingState(storage, 'user-first'), null)
  assert.match(guide, /if \(!existing \|\| existing\.role !== tour\.role\) setWelcomeOpen\(true\)/)
  assert.match(guide, /Welcome to KhataPro/)
  assert.match(guide, /Start Tour/)
  assert.match(guide, /Skip for now/)
})

test('completed and dismissed states suppress the same current tour version', () => {
  const storage = new MemoryStorage()
  writeOnboardingState(storage, 'user-complete', 'Accountant', 'completed')
  writeOnboardingState(storage, 'user-dismiss', 'Salesman', 'dismissed')
  assert.equal(readOnboardingState(storage, 'user-complete')?.status, 'completed')
  assert.equal(readOnboardingState(storage, 'user-dismiss')?.status, 'dismissed')
  assert.equal(readOnboardingState(storage, 'user-complete')?.version, PRODUCT_TOUR_VERSION)
})

test('Restart Product Tour resets and starts only the current user guide', () => {
  const storage = new MemoryStorage()
  writeOnboardingState(storage, 'current-user', 'Rider', 'completed')
  writeOnboardingState(storage, 'other-user', 'Owner/Admin', 'completed')
  resetOnboardingState(storage, 'current-user')
  assert.equal(readOnboardingState(storage, 'current-user'), null)
  assert.equal(readOnboardingState(storage, 'other-user')?.status, 'completed')
  assert.equal(PRODUCT_TOUR_RESTART_EVENT, 'khatapro-product-tour-restart')
  assert.match(profile, /Restart Product Tour/)
  assert.match(profile, /new Event\(PRODUCT_TOUR_RESTART_EVENT\)/)
  assert.match(guide, /resetOnboardingState\(window\.localStorage, user\.id\)/)
  assert.match(guide, /setTourOpen\(true\)/)
})

test('persistence keys are versioned and scoped to a stable user identity', () => {
  const first = onboardingStorageKey('user-a')
  const second = onboardingStorageKey('user-b')
  assert.notEqual(first, second)
  assert.match(first, new RegExp(`:${PRODUCT_TOUR_VERSION}:user-a$`))
  assert.doesNotMatch(first, /business|role/)
})

test('blocked browser preference storage never breaks tour controls', () => {
  const blocked = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
    removeItem() { throw new Error('blocked') },
  }
  assert.equal(readOnboardingState(blocked, 'user-a'), null)
  assert.doesNotThrow(() => writeOnboardingState(blocked, 'user-a', 'Owner/Admin', 'completed'))
  assert.doesNotThrow(() => resetOnboardingState(blocked, 'user-a'))
})

test('tour and help copy contain no technical or internal implementation wording', () => {
  const copy = [
    ...(['Owner/Admin', 'Accountant', 'Salesman', 'Rider'] as const).flatMap((role) => {
      const tour = buildProductTour(role, ownerPages)
      return tour?.steps.flatMap((step) => [step.title, step.body]) ?? []
    }),
    ...Object.values(PAGE_HELP).flatMap((help) => [help.title, help.body]),
  ].join(' ')
  assert.doesNotMatch(copy, /Supabase|migration|\bRPC\b|\bUUID\b|schema|service_role|Biz-Day Test|developer route|debug/i)
})

test('stable tour targets are wired into desktop, mobile and content surfaces', () => {
  for (const role of ['Owner/Admin', 'Accountant', 'Salesman', 'Rider']) {
    const tour = buildProductTour(role, ownerPages)
    assert.ok(tour)
    for (const step of tour.steps) {
      if (!step.target) continue
      assert.match(step.target, /^\[data-tour="(?:page-content|nav-(?:page|category)-[a-z-]+)"\]$/)
    }
  }
  assert.match(shell, /data-tour="page-content"/)
  assert.match(shell, /data-tour=\{`nav-category-\$\{category\.id\}`\}/)
  assert.match(shell, /data-tour=\{`nav-page-\$\{item\.key\}`\}/)
  assert.match(shell, /data-tour=\{`nav-page-\$\{slot\.key\}`\}/)
})

test('contextual help covers all requested major pages from one shared config', () => {
  const expected = [
    'home', 'counter-sale', 'online-sale', 'ofc-sale', 'sales-list', 'delivery',
    'purchases', 'accounts', 'petty-cash', 'contra-entry', 'inventory', 'day-book',
    'ledger-drilldown', 'trial-balance', 'coa', 'reports', 'users', 'permissions',
  ]
  assert.deepEqual(Object.keys(PAGE_HELP).sort(), expected.sort())
  assert.match(shell, /<ContextualPageHelp pageKey=\{effectiveActive\}/)
})

test('tour dialogs retain keyboard, Escape, focus and mobile-size safeguards', () => {
  assert.match(guide, /onOpenChange=\{\(open\) => \{[\s\S]*skipTour\(\)/)
  assert.match(guide, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto/)
  assert.match(guide, /aria-live="polite"/)
  assert.match(guide, /min-h-11/)
  assert.match(guide, /onStepChange\?\.\(tourOpen && step \? step : null\)/)
})
