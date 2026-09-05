import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'

const read = async (path: string) => (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')
/** These files explain the router failure mode in prose, so bans read code only. */
const codeOnly = (source: string) => source.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const helper = await read('src/lib/navigation/shell-navigation.ts')
const shell = await read('src/components/erp/dashboard-shell.tsx')
const owner = await read('src/components/erp/views/owner-dashboard.tsx')
const salesman = await read('src/components/erp/views/salesman-dashboard.tsx')
const salesList = await read('src/components/erp/views/sales-list-view.tsx')
const trialBalance = await read('src/components/erp/views/trial-balance-view.tsx')
const purchases = await read('src/components/erp/views/purchases-view.tsx')
const rider = await read('src/components/erp/views/rider-dashboard.tsx')
const invoice = await read('src/components/erp/views/invoice-detail-view.tsx')
const ledger = await read('src/components/erp/views/ledger-drilldown-view.tsx')

// ---------------------------------------------------------------------------
// The mobile "More" sheet died because the shell's shared navigation primitive
// had been changed from history.pushState to router.push. Both write the URL
// that useSearchParams() reports, but router.push resolves the target route
// from the server first and Next discards the navigation silently when that
// resolution fails — no error, no spinner, no page change.
//
// Every screen inside KhataPro is the SAME route with different query state, so
// every same-route router.push in the app carried that identical latent risk.
// This file pins the audit: one primitive, used everywhere shell state is
// written, and no router left to reintroduce the failure through.
// ---------------------------------------------------------------------------

test('the app really does have only one internal route, which is why query state is the navigation', async () => {
  const entries = await readdir('src/app', { recursive: true })
  const routes = entries.map((e) => String(e).replace(/\\/g, '/')).filter((e) => e.endsWith('page.tsx')).sort()
  assert.deepEqual(routes, ['offline/page.tsx', 'page.tsx'])
})

test('the shared helper writes shell URLs synchronously and locally', () => {
  assert.match(helper, /export function navigateShell\(url: string\): void \{\n  window\.history\.pushState\(\{\}, '', url\)\n  window\.dispatchEvent\(new PopStateEvent\('popstate'\)\)\n\}/)
  assert.match(helper, /export function openShellPage\(key: string\): void \{\n  navigateShell\(`\/\?page=\$\{key\}`\)\n\}/)
  assert.match(helper, /export function openShellHome\(\): void \{\n  navigateShell\('\/'\)\n\}/)
  assert.doesNotMatch(codeOnly(helper), /useRouter|router\./)
})

test('no view can reintroduce a silently-discarded shell navigation', async () => {
  const views = await readdir('src/components/erp/views')
  for (const file of views.filter((f) => f.endsWith('.tsx'))) {
    const source = codeOnly(await read(`src/components/erp/views/${file}`))
    assert.doesNotMatch(source, /useRouter|router\.push|router\.replace/, `${file} must not navigate through the router`)
  }
  assert.doesNotMatch(codeOnly(shell), /useRouter|router\.push|router\.replace/)
})

// ---------------------------------------------------------------------------
// The surfaces named in the acceptance walkthrough, one test each so a failure
// names the screen that broke.
// ---------------------------------------------------------------------------

test('owner dashboard tiles, attention items and insights open their destination', () => {
  assert.match(owner, /const openDestination = \(destination: string\) => \{ if \(canOpen\(destination\)\) navigateShell\(destination\) \}/)
  assert.match(owner, /onOpen=\{canOpen\(destination\) \? \(\) => navigateShell\(destination\) : undefined\}/)
  // The permission gate in front of it is unchanged: an unreachable destination
  // is not offered, and openDestination re-checks before writing the URL.
  assert.match(owner, /const canOpen = \(destination: string\) => canOpenDashboardDestination\(permissions, destination\)/)
})

test('salesman dashboard quick actions and "View all" reach their pages', () => {
  for (const key of ['counter-sale', 'sales-list', 'my-reports', 'accounts']) {
    assert.match(salesman, new RegExp(`openShellPage\\('${key}'\\)`), `salesman quick action ${key}`)
  }
  assert.doesNotMatch(salesman, /'\/\?page=/)
})

test('Sales List opens each sale entry page', () => {
  for (const key of ['counter-sale', 'online-sale', 'ofc-sale', 'other-sale', 'receipt-voucher']) {
    assert.match(salesList, new RegExp(`openShellPage\\('${key}'\\)`), `sales list action ${key}`)
  }
})

test('Sales List -> Invoice opens the row id, and keeps the historical-return flag', () => {
  const rows = salesList.match(/navigateShell\(`\/\?invoice=\$\{r\.id\}\$\{returnMode \? '&return=1' : ''\}`\)/g)
  assert.equal(rows?.length, 2, 'both the table row and the mobile card must navigate this way')
})

test('Trial Balance drills into an account ledger', () => {
  assert.match(trialBalance, /const openLedger = \(accountId: string\) => navigateShell\(`\/\?ledger=\$\{accountId\}`\)/)
})

test('Purchases reaches Vendors', () => {
  assert.match(purchases, /openShellPage\('vendors'\)/)
})

// ---------------------------------------------------------------------------
// Rider. The four tabs are the whole Rider product, and the home tiles are the
// only other way into Deliveries and Cash.
// ---------------------------------------------------------------------------

test('Rider home tiles open Deliveries and Cash', () => {
  assert.match(rider, /function riderPage\(path: 'delivery' \| 'rider-cash' \| 'my-profile'\): string \{\n  return `\/\?page=\$\{path\}`\n\}/)
  assert.equal(rider.match(/navigateShell\(riderPage\('delivery'\)\)/g)?.length, 2)
  assert.match(rider, /navigateShell\(riderPage\('rider-cash'\)\)/)
})

// ---------------------------------------------------------------------------
// Back out of a detail view. Both of these clear their query parameter by
// writing the bare shell URL, which is the same route — so they were exposed to
// the same silent discard as everything else.
// ---------------------------------------------------------------------------

test('Back from an invoice returns to the page underneath', () => {
  assert.match(invoice, /function back\(\) \{ openShellHome\(\) \}/)
})

test('Back from a ledger drilldown returns to the page underneath', () => {
  assert.match(ledger, /function back\(\) \{\n    openShellHome\(\)\n  \}/)
})

// ---------------------------------------------------------------------------
// Permissions are unchanged by the seam. The shell remains the authority: it
// re-resolves ?page= and re-checks every detail parameter on each query change,
// falls back to Home and rewrites the corrected URL. A caller cannot widen its
// own access by writing a URL through the helper.
// ---------------------------------------------------------------------------

test('the shell still fails closed on every query change, not just the first render', () => {
  const corrector = shell.slice(shell.indexOf('  useEffect(() => {\n    const params = new URLSearchParams(queryString)'), shell.indexOf('const effectiveActive'))
  assert.match(corrector, /const nextPage = resolveInitialPage\(params, user\)/)
  assert.match(corrector, /if \(requestedPage && requestedPage !== nextPage\)/)
  for (const param of ['ledger', 'invoice', 'voucher']) {
    assert.match(corrector, new RegExp(`if \\(params\\.has\\('${param}'\\) && !canOpen${param[0].toUpperCase()}${param.slice(1)}\\) \\{\\n      params\\.delete\\('${param}'\\)`))
  }
  assert.match(corrector, /window\.history\.replaceState\(\{\}, '', nextUrl\)/)
  assert.match(corrector, /\}, \[queryString, user, canOpenLedger, canOpenInvoice, canOpenVoucher\]\)/)
})

test('a detail view the role cannot open is not rendered even if the URL asks for it', () => {
  assert.match(shell, /const effectiveActive = ledgerAccountId && canOpenLedger/)
  assert.match(shell, /: invoiceId && canOpenInvoice/)
  assert.match(shell, /: voucherId && canOpenVoucher/)
})
