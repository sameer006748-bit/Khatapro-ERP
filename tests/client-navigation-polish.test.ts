import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const shell = await readFile('src/components/erp/dashboard-shell.tsx', 'utf8')
const setup = await readFile('src/components/erp/views/setup-view.tsx', 'utf8')
const assistant = await readFile('src/components/erp/ai-assistant.tsx', 'utf8')
const status = await readFile('src/components/erp/supabase-status-badge.tsx', 'utf8')
const outOfCitySale = await readFile('src/components/erp/views/ofc-sale-view.tsx', 'utf8')
const salesList = await readFile('src/components/erp/views/sales-list-view.tsx', 'utf8')
const permissions = await readFile('src/components/erp/views/permission-matrix-view.tsx', 'utf8')
const pwa = await readFile('src/components/pwa/service-worker-register.tsx', 'utf8')
const globalCss = await readFile('src/app/globals.css', 'utf8')

test('client navigation uses clear business wording in desktop and mobile labels', () => {
  assert.match(shell, /label: 'Daily Work'/)
  assert.match(shell, /label: 'Out-of-City Sale', short: 'Out-of-City'/)
  assert.match(shell, /label: 'Roles & Permissions', short: 'Permissions'/)
  assert.match(shell, /id: 'work', label: 'Daily Work'/)
  assert.doesNotMatch(shell, /label: 'OFC Sale'|label: 'Day Work'/)
})

test('destination screens carry the polished navigation terminology through the workflow', () => {
  assert.match(outOfCitySale, />Out-of-City Sale</)
  assert.match(outOfCitySale, /Post Out-of-City Sale/)
  assert.match(salesList, /> Out-of-City Sale/)
  assert.doesNotMatch(outOfCitySale, />OFC Sale|Post OFC Sale|OFC sale posted/)
  assert.doesNotMatch(salesList, /> OFC Sale|Online \/ OFC sale/)
  assert.match(permissions, /Roles &amp; Permissions/)
})

test('navigation keeps one semantic Lucide icon family and a consistent visual rhythm', () => {
  assert.match(shell, /icon: CalendarCheck2/)
  assert.match(shell, /key: 'online-sale'[\s\S]*?icon: Globe2/)
  assert.match(shell, /key: 'delivery'[\s\S]*?icon: PackageCheck/)
  assert.match(shell, /key: 'inventory'[\s\S]*?icon: Boxes/)
  assert.match(shell, /type LucideIcon/)
  assert.match(shell, /className="size-\[18px\]" strokeWidth=\{1\.9\}/)
})

test('navigation active, hover, focus, and accessibility states stay restrained and clear', () => {
  assert.match(shell, /bg-primary\/\[0\.09\]/)
  assert.match(shell, /hover:bg-muted\/70/)
  assert.match(shell, /focus-visible:ring-2 focus-visible:ring-ring\/60/)
  assert.match(shell, /aria-current=\{isActive \? 'page' : undefined\}/)
  assert.match(shell, /aria-expanded=\{isExpanded\}/)
})

test('Setup cards use client-facing descriptions without diagnostic or route-slug leakage', () => {
  assert.match(setup, /Manage business accounts, team access and accounting setup\./)
  assert.match(setup, /title: 'Roles & Permissions'/)
  assert.doesNotMatch(setup, /biz-day-test|Biz-Day Test|\{c\.route\}/)
  assert.doesNotMatch(setup, /UTC instants|Owner\/Admin only|linked Asset ledger/)
})

test('KhataPro AI launcher uses a calm outline treatment instead of a black floating action', () => {
  assert.match(assistant, /variant="outline"/)
  assert.match(assistant, /border-primary\/25 bg-card\/95/)
  assert.match(assistant, /aria-label="Ask KhataPro AI"/)
  assert.match(assistant, /aria-haspopup="dialog"/)
  assert.doesNotMatch(assistant, /bg-black|bg-slate-9|bg-zinc-9/)
})

test('header status exposes business-safe wording instead of raw service messages', () => {
  assert.match(status, />\s*System Online\s*</)
  assert.match(status, /title="All services are available"/)
  assert.match(status, /title="Some services need attention"/)
  assert.doesNotMatch(status, /title=\{s\.message\}/)
})

// ---------------------------------------------------------------------------
// Bottom floating stack — the mobile nav, the AI launcher and the PWA banners
// used to be positioned independently, so the install banner covered the mobile
// nav and the AI launcher sat on top of a screen's last primary action (e.g.
// Post Expense Batch). Each layer now takes its offset from one shared slot.
// ---------------------------------------------------------------------------

test('every fixed bottom layer takes its offset from the shared stack', () => {
  for (const slot of [
    '--kp-mobile-nav-bottom',
    '--kp-fab-bottom',
    '--kp-banner-bottom',
    '--kp-banner-stacked-bottom',
    '--kp-content-bottom',
  ]) {
    assert.match(globalCss, new RegExp(`${slot}: calc\\(`))
  }
  assert.match(shell, /bottom: 'var\(--kp-mobile-nav-bottom\)'/)
  assert.match(assistant, /bottom: 'var\(--kp-fab-bottom\)'/)
  assert.match(pwa, /bottom: 'var\(--kp-banner-bottom\)'/)
  assert.match(pwa, /updateAvailable \? 'var\(--kp-banner-stacked-bottom\)' : 'var\(--kp-banner-bottom\)'/)
})

test('no floating layer hard-codes a competing bottom offset', () => {
  assert.doesNotMatch(assistant, /bottom-\d|bottom: '\d/)
  assert.doesNotMatch(pwa, /bottom-\d|bottom: '\d/)
  // Two layers sharing one slot would put them on top of each other.
  assert.doesNotMatch(assistant, /--kp-mobile-nav-bottom|--kp-banner/)
  assert.doesNotMatch(pwa, /--kp-mobile-nav-bottom|--kp-fab-bottom/)
})

test('page content reserves room so its primary action clears the stack', () => {
  assert.match(shell, /paddingBottom: 'var\(--kp-content-bottom\)'/)
  assert.doesNotMatch(shell, /pb-28 md:pb-8/)
  // The reserved room must clear the AI launcher, which is the tallest
  // persistent layer on both breakpoints.
  const reserved = (source: string, name: string) => {
    const found = new RegExp(`${name}: calc\\(([0-9.]+)rem`).exec(source)
    assert.ok(found, `${name} must be declared in rem`)
    return Number(found[1])
  }
  const mobile = globalCss.slice(0, globalCss.indexOf('@media (min-width: 768px)'))
  const desktop = globalCss.slice(globalCss.indexOf('@media (min-width: 768px)'))
  for (const [scope, css] of [['mobile', mobile], ['desktop', desktop]] as const) {
    const fab = reserved(css, '--kp-fab-bottom')
    const content = reserved(css, '--kp-content-bottom')
    // 3rem is the launcher's own height (h-12).
    assert.ok(content >= fab + 3, `${scope} content padding must clear the AI launcher`)
  }
})

test('the PWA install banner stays dismissible instead of being removed', () => {
  assert.match(pwa, /const DISMISS_KEY = 'khatapro-install-dismissed'/)
  assert.match(pwa, /aria-label="Dismiss"/)
  assert.match(pwa, /localStorage\.setItem\(DISMISS_KEY, 'true'\)/)
  assert.match(pwa, /const showInstall = installPrompt && !isStandalone && !isInstalled/)
})
