import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const setup = await readFile('src/components/erp/views/setup-view.tsx', 'utf8')
const shell = await readFile('src/components/erp/dashboard-shell.tsx', 'utf8')

const mappings = {
  'Business Accounts': 'business-accounts',
  'Chart of Accounts': 'coa',
  'Account Classification': 'account-classification',
  'Users & Roles': 'users',
  'Roles & Permissions': 'permissions',
  'Audit Log': 'audit',
}

test('all client Setup cards map to registered page keys', () => {
  for (const [title, key] of Object.entries(mappings)) {
    assert.match(setup, new RegExp(`title: '${title.replace(/[&]/g, '\\$&')}',[\\s\\S]*?route: '${key}'`))
    assert.match(shell, new RegExp(`key: '${key}'`))
  }
})

test('every Setup target resolves to its existing view component', () => {
  for (const [key, component] of Object.entries({
    'business-accounts': 'BusinessAccountsView',
    coa: 'CoaView',
    'account-classification': 'AccountClassificationView',
    users: 'UsersView',
    permissions: 'PermissionMatrixView',
    audit: 'AuditLogView',
  })) {
    assert.match(shell, new RegExp(`active === '${key}'\\) return <${component}`))
  }
})

// Regression: the rendered page used to be re-checked against the sidebar
// categories, so a registered, permitted page with no navigation slot — every
// Setup detail page and every legacy voucher deep link — silently fell back to
// Home even though ?page= kept its value in the URL.
test('a registered page without a navigation slot renders itself, not Home', () => {
  const resolved = shell.slice(shell.indexOf('const effectiveActive'), shell.indexOf('function selectItem'))
  assert.doesNotMatch(resolved, /visibleItems\.some/)
  assert.doesNotMatch(resolved, /: 'home'/)
  assert.match(resolved, /: active\s*$/m)
})

test('Setup detail pages are registered outside the sidebar but stay permission-gated', () => {
  assert.match(shell, /const SETUP_DETAIL_PAGES[\s\S]*?key: 'account-classification'[\s\S]*?perm: 'can_view_setup'/)
  const navSource = shell.slice(shell.indexOf('const NAV_CATEGORIES'), shell.indexOf('const INTERNAL_PAGES'))
  assert.doesNotMatch(navSource, /account-classification/)
  assert.match(shell, /for \(const item of SETUP_DETAIL_PAGES\) PAGE_REGISTRY\.set\(item\.key, item\)/)
})

test('a deep link to a page this role cannot see still fails closed to Home', () => {
  const resolver = shell.slice(shell.indexOf('function resolveInitialPage'), shell.indexOf('export function DashboardShell'))
  assert.match(resolver, /if \(page && PAGE_REGISTRY\.has\(page\)\)/)
  assert.match(resolver, /if \(isItemVisible\(user, item\)\) return page/)
  assert.match(resolver, /return 'home'/)
  // …and the corrected key is written back to the URL so the address bar cannot
  // keep advertising a page the role never got.
  assert.match(shell, /if \(requestedPage && requestedPage !== nextPage\)/)
  assert.match(shell, /window\.history\.replaceState\(\{\}, '', nextUrl\)/)
})

test('business-day diagnostics remain owner-only and outside client navigation', () => {
  const navSource = shell.slice(shell.indexOf('const NAV_CATEGORIES'), shell.indexOf('const INTERNAL_PAGES'))
  assert.doesNotMatch(navSource, /biz-day-test|Biz-Day Test|Business Day Diagnostic/)
  assert.doesNotMatch(setup, /biz-day-test|Biz-Day Test|Business Day Diagnostic/)
  assert.match(shell, /const INTERNAL_PAGES[\s\S]*key: 'biz-day-test'[\s\S]*ownerOnly: true/)
  assert.match(shell, /active === 'biz-day-test'\) return <BizDayTestView/)
})

test('available cards are full semantic buttons with native keyboard activation', () => {
  assert.match(setup, /<button[\s\S]*?type="button"[\s\S]*?onClick=\{\(\) => onNavigate\(c\.route\)\}/)
  assert.match(setup, /min-h-44/)
  assert.match(setup, /focus-visible:ring-2/)
})

test('unavailable cards are non-interactive and do not advertise Open', () => {
  assert.match(setup, /const locked = !canOpen\(c\.route\)/)
  assert.match(setup, /locked \? \([\s\S]*?<div key=\{c\.title\}[\s\S]*?aria-disabled="true"/)
  assert.match(setup, /locked \? \([\s\S]*?Restricted[\s\S]*?\) : \([\s\S]*?Open/)
})

test('navigation rejects unknown keys and retains the existing permission gate', () => {
  assert.match(shell, /const item = PAGE_REGISTRY\.get\(key\)/)
  assert.match(shell, /if \(!item \|\| !isItemVisible\(user, item\)\) return/)
  assert.match(shell, /canOpen=\{\(key\) => \{[\s\S]*?isItemVisible\(user, item\)/)
})

test('card navigation uses query-page history so browser Back remains available', () => {
  assert.match(shell, /window\.history\.pushState\(\{\}, '', `\/\?page=\$\{key\}`\)/)
  assert.match(shell, /window\.dispatchEvent\(new PopStateEvent\('popstate'\)\)/)
})
