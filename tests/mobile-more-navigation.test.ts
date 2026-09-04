import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const shell = await readFile('src/components/erp/dashboard-shell.tsx', 'utf8')

// ---------------------------------------------------------------------------
// Every item in the mobile "More" sheet stopped changing the page: the sheet
// closed and the previous screen stayed on display. The desktop sidebar and the
// product tour share the same function and broke with it.
//
// The shell renders whichever page ?page= names, read through
// useSearchParams(), which the App Router derives from its own canonical URL.
// router.push() only updates that URL after resolving the target route from the
// server, and Next discards the navigation silently when that resolution fails
// (navigateImpl -> `.catch(() => state)`) — no error, no spinner, no page
// change. The patched history.pushState updates the same URL synchronously and
// locally, so it cannot fail this way. The primary mobile tabs kept working
// only because they are prefetched <Link>s that resolve from the route cache.
// ---------------------------------------------------------------------------

test('shell navigation writes the page URL synchronously instead of awaiting a route resolution', () => {
  const selectItem = /function selectItem\(key: string\) \{[\s\S]*?\n  \}/.exec(shell)
  assert.ok(selectItem, 'selectItem must remain the shell navigation function')
  const body = selectItem[0]
  assert.match(body, /window\.history\.pushState\(\{\}, '', `\$\{url\.pathname\}\?\$\{url\.searchParams\.toString\(\)\}`\)/)
  assert.match(body, /window\.dispatchEvent\(new PopStateEvent\('popstate'\)\)/)
  assert.doesNotMatch(body, /router\.push|router\.replace/)
})

test('the shell holds no router, so a silent push cannot come back through this seam', () => {
  assert.doesNotMatch(shell, /useRouter/)
  assert.match(shell, /import \{ useSearchParams \} from 'next\/navigation'/)
})

test('opening a page still clears any detail view that was on screen', () => {
  for (const param of ['ledger', 'invoice', 'voucher']) {
    assert.match(shell, new RegExp(`url\\.searchParams\\.delete\\('${param}'\\)`))
  }
  assert.match(shell, /url\.searchParams\.set\('page', key\)/)
})

// ---------------------------------------------------------------------------
// One shared function, reached from every surface. A per-item patch would have
// left the other surfaces broken.
// ---------------------------------------------------------------------------

test('mobile More, the desktop sidebar and the product tour all navigate through selectItem', () => {
  assert.match(shell, /onSelect=\{\(k\) => \{\s*selectItem\(k\)\s*setMoreOpen\(false\)\s*\}\}/)
  assert.match(shell, /renderSidebarCategories\(cats, effectiveActive, expanded, toggleCategory, selectItem\)/)
  assert.match(shell, /onNavigate=\{selectItem\}/)
  assert.match(shell, /onClick=\{\(\) => onSelect\(item\.key\)\}/)
})

// ---------------------------------------------------------------------------
// The pages reached from the More sheet, by role. These keys are what the
// acceptance walkthrough taps; a rename here silently empties a role's menu.
// ---------------------------------------------------------------------------

test('Owner reaches its More pages: Online Sale, Accounts & Balances, Trial Balance, Business Accounts', () => {
  assert.match(shell, /key: 'online-sale', label: 'Online Sale',[^\n]*perm: 'can_create_sales'/)
  assert.match(shell, /key: 'accounts', label: 'Accounts & Balances',[^\n]*perm: 'can_view_account_balances'/)
  assert.match(shell, /key: 'trial-balance', label: 'Trial Balance',[^\n]*perm: 'can_view_trial_balance'/)
  assert.match(shell, /key: 'business-accounts', label: 'Business Accounts',[^\n]*perm: 'can_view_setup'/)
})

test('Accountant reaches its More pages: Day Book, Vouchers, Trial Balance, Accounts & Balances', () => {
  assert.match(shell, /key: 'day-book', label: 'Day Book',[^\n]*perm: 'can_view_day_book'/)
  assert.match(shell, /key: 'vouchers', label: 'Vouchers',[^\n]*perm: 'can_view_day_book'/)
  assert.match(shell, /key: 'petty-cash', label: 'Petty Cash',[^\n]*perm: 'can_manage_petty_cash'/)
})

test('Salesman reaches its More pages: Online, Out-of-City, Other Sale and My Sales Reports', () => {
  assert.match(shell, /key: 'ofc-sale', label: 'Out-of-City Sale',[^\n]*perm: 'can_create_sales'/)
  assert.match(shell, /key: 'other-sale', label: 'Other Sale',[^\n]*perm: 'can_create_sales'/)
  assert.match(shell, /key: 'my-reports', label: 'My Sales Reports',[^\n]*perm: 'can_view_own_sales'/)
})

// ---------------------------------------------------------------------------
// Fail closed. Reaching a page the role cannot see must land on Home, whether
// the key arrives from a deep link or from a programmatic caller such as the
// product tour.
// ---------------------------------------------------------------------------

test('navigation refuses a key this role cannot see', () => {
  const selectItem = /function selectItem\(key: string\) \{[\s\S]*?\n  \}/.exec(shell)![0]
  assert.match(selectItem, /const item = PAGE_REGISTRY\.get\(key\)/)
  assert.match(selectItem, /if \(!item \|\| !isItemVisible\(user, item\)\) return/)
})

test('an unauthorized deep link still resolves to Home and the URL is corrected', () => {
  assert.match(shell, /if \(page && PAGE_REGISTRY\.has\(page\)\)/)
  assert.match(shell, /return 'home'/)
  assert.match(shell, /window\.history\.replaceState\(\{\}, '', nextUrl\)/)
})

// ---------------------------------------------------------------------------
// Rider is untouched: four tabs, no More sheet, primary tabs still <Link>s.
// ---------------------------------------------------------------------------

test('Rider keeps exactly Home, Deliveries, Cash and Profile', () => {
  const slots = /const RIDER_MOBILE_SLOTS: MobileSlot\[\] = \[[\s\S]*?\n\]/.exec(shell)
  assert.ok(slots, 'RIDER_MOBILE_SLOTS must remain declared')
  assert.equal((slots[0].match(/resolve:/g) ?? []).length, 4)
  assert.match(slots[0], /id: 'home',[^\n]*resolve: \(\) => 'home'/)
  assert.match(slots[0], /id: 'deliveries',[^\n]*resolve: \(\) => 'delivery'/)
  assert.match(slots[0], /id: 'cash',[^\n]*resolve: \(\) => 'rider-cash'/)
  assert.match(slots[0], /id: 'profile',[^\n]*resolve: \(\) => 'my-profile'/)
})

test('Rider has no More sheet, and its primary tabs stay prefetched links', () => {
  assert.match(shell, /const mobileMoreCategories = user\.roleName === 'Rider' \? \[\] : cats/)
  assert.match(shell, /href=\{`\/\?page=\$\{slot\.key\}`\}/)
})

test('every Rider tab is a page this role is allowed to open', () => {
  // selectItem now gates on PAGE_REGISTRY + isItemVisible, and the Rider
  // sidebar goes through it, so each Rider key must be registered and visible.
  assert.match(shell, /for \(const item of INTERNAL_PAGES\) PAGE_REGISTRY\.set\(item\.key, item\)/)
  assert.match(shell, /\{ key: 'rider-cash',[^\n]*riderOnly: true \}/)
  assert.match(shell, /if \(item\.riderOnly\) return user\.roleName === 'Rider'/)
  assert.match(shell, /if \(item\.key === 'delivery' && user\.roleName === 'Rider'\)/)
  // 'home' and 'my-profile' are registered from NAV_CATEGORIES without a
  // permission, which is what keeps them open to Rider.
  assert.match(shell, /\{ key: 'home', label: 'Dashboard', short: 'Home', icon: LayoutDashboard \}/)
  assert.match(shell, /\{ key: 'my-profile', label: 'My Profile', short: 'Profile', icon: CircleUserRound \}/)
})
