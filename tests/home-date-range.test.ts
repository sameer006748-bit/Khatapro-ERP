import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const dates = await readFile('src/lib/dates.ts', 'utf8')
const hook = await readFile('src/hooks/use-owner-dashboard.ts', 'utf8')
const page = await readFile('src/components/erp/views/owner-dashboard.tsx', 'utf8')
const route = await readFile('src/app/api/dashboard/owner/route.ts', 'utf8')

test('Today, Last 3 Days, Last 7 Days, This Month presets use Karachi business dates', () => {
  assert.match(page, /bizPresetDateRange\('today'\)/)
  assert.match(dates, /BUSINESS_TZ = 'Asia\/Karachi'/)
  assert.match(dates, /preset === 'last3'/)
  assert.match(dates, /preset === 'last7'/)
  assert.match(dates, /preset === 'month'/)
})

test('Last 3 Days and Last 7 Days use calendar-day counting including weekends', () => {
  assert.match(dates, /function calendarDaysBefore/)
  assert.match(dates, /return addBusinessDays\(dateStr, -count\)/)
  assert.doesNotMatch(dates, /dow !== 0 && dow !== 6/)
})

test('Monday Last 3 Days spans Saturday through Monday (calendar dates)', async () => {
  const { bizPresetDateRange } = await import('../src/lib/dates.ts')
  const monday = new Date(Date.UTC(2026, 6, 27))
  const range = bizPresetDateRange('last3', monday)
  assert.strictEqual(range.from, '2026-07-25')
  assert.strictEqual(range.to, '2026-07-27')
})

test('Monday Last 7 Days spans the prior 6 full calendar dates through Monday', async () => {
  const { bizPresetDateRange } = await import('../src/lib/dates.ts')
  const monday = new Date(Date.UTC(2026, 6, 27))
  const range = bizPresetDateRange('last7', monday)
  assert.strictEqual(range.from, '2026-07-21')
  assert.strictEqual(range.to, '2026-07-27')
})

test('Karachi midnight boundaries use +05:00 fixed offset', () => {
  assert.match(dates, /T00:00:00\+05:00/)
  assert.match(dates, /T23:59:59\.999\+05:00/)
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

test('no stale Yesterday or This Week primary labels remain', () => {
  assert.doesNotMatch(page, /Yesterday/)
  assert.doesNotMatch(page, /This Week/)
})

test('no migration files changed', () => {
  const changed = execFileSync('git', ['diff', '--name-only', 'ec05323cc1adf1593b322b1b332e014e73a41b11'], { encoding: 'utf8' })
  assert.doesNotMatch(changed, /^supabase\/migrations\//m)
})
