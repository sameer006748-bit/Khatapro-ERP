import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const dates = await readFile('src/lib/dates.ts', 'utf8')
const hook = await readFile('src/hooks/use-owner-dashboard.ts', 'utf8')
const page = await readFile('src/components/erp/views/owner-dashboard.tsx', 'utf8')
const route = await readFile('src/app/api/dashboard/owner/route.ts', 'utf8')

test('Today is the default and every preset uses Karachi business dates', () => {
  assert.match(page, /bizPresetDateRange\('today'\)/)
  assert.match(dates, /BUSINESS_TZ = 'Asia\/Karachi'/)
  assert.match(dates, /preset === 'yesterday'/)
  assert.match(dates, /\| 'week'/)
  assert.match(dates, /preset === 'month'/)
})

test('yesterday, week, and month boundaries use date-only arithmetic', () => {
  assert.match(dates, /addBusinessDays\(today, -1\)/)
  assert.match(dates, /\(weekday \+ 6\) % 7/)
  assert.match(dates, /\$\{today\.slice\(0, 8\)\}01/)
})

test('custom range validates start/end before applying', () => {
  assert.match(page, /isBusinessDateRange\(nextRange\)/)
  assert.match(page, /End date must be on or after start date/)
  assert.match(page, /Start date/)
  assert.match(page, /End date/)
  assert.match(page, /Apply/)
  assert.match(page, /Reset/)
})

test('one shared range reaches the existing owner API and creates one query key', () => {
  assert.match(hook, /URLSearchParams\(\{ from: range\.from, to: range\.to \}\)/)
  assert.match(hook, /queryKey: \['owner-dashboard', range\.from, range\.to\]/)
  assert.match(hook, /queryFn: \(\) => fetchOwnerDashboard\(range\)/)
  assert.match(route, /url\.searchParams\.get\('from'\)/)
  assert.match(route, /url\.searchParams\.get\('to'\)/)
})

test('all period metrics use the same validated range', () => {
  for (const call of ['getTodaySalesAggregate(bid, range.from, range.to)', 'getPeriodPurchases(bid, range.from, range.to)', 'getTodayExpenses(bid, range.from, range.to)', 'getTodayCollections(bid, range.from, range.to)']) assert.ok(route.includes(call), call)
  assert.match(route, /getPeriodAccountMovement\(bid, arAccount\.id, range\.from, range\.to, 'asset'\)/)
  assert.match(route, /getPeriodAccountMovement\(bid, apAccount\.id, range\.from, range\.to, 'liability'\)/)
})

test('current balance and stock snapshots are explicitly not historical', () => {
  for (const label of ['Current Cash', 'Current Bank', 'Current Receivables', 'Current Payables', 'Current Low / Negative Stock']) assert.ok(page.includes(label), label)
  assert.match(route, /Ledger movement only; current balance snapshots are intentionally separate/)
})

test('the active range is visible and mobile presets remain scrollable', () => {
  assert.match(page, /overflow-x-auto/)
  assert.match(page, /Active range:/)
  assert.match(page, /grid-cols-1 sm:grid-cols/)
})

test('Home authorization and accounting presentation logic remain intact', () => {
  assert.match(route, /loaded\.roleName === 'Owner\/Admin'/)
  assert.match(route, /requirePermission\(loaded, 'can_view_trial_balance'\)/)
  assert.match(page, /const approxProfit = todaySales - todayExpenses/)
  assert.doesNotMatch(page, /parseFloat|Math\.round|toFixed/)
})

test('no migration files changed', () => {
  const changed = execFileSync('git', ['diff', '--name-only', 'ec05323cc1adf1593b322b1b332e014e73a41b11'], { encoding: 'utf8' })
  assert.doesNotMatch(changed, /^supabase\/migrations\//m)
})
