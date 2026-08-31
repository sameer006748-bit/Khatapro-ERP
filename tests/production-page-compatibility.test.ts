import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  classifyPostgrestCompatibilityError,
  detectLedgerCapability,
  isolateDashboardMetric,
  resetDashboardCapabilityCacheForTests,
} from '../src/lib/dashboard/compatibility.ts'

const availability = await readFile('src/lib/accounting/availability.ts', 'utf8')
const coaRoute = await readFile('src/app/api/setup/coa/route.ts', 'utf8')
const trialBalanceRoute = await readFile('src/app/api/trial-balance/route.ts', 'utf8')
const dayBookRoute = await readFile('src/app/api/day-book/route.ts', 'utf8')
const expensesRoute = await readFile('src/app/api/expenses/route.ts', 'utf8')
const reportsRoute = await readFile('src/app/api/reports/route.ts', 'utf8')
const accountsView = await readFile('src/components/erp/views/accounts-view.tsx', 'utf8')
const reportsView = await readFile('src/components/erp/views/reports-view.tsx', 'utf8')
const counterSaleView = await readFile('src/components/erp/views/counter-sale-view.tsx', 'utf8')
const onlineSaleView = await readFile('src/components/erp/views/online-sale-view.tsx', 'utf8')
const ofcSaleView = await readFile('src/components/erp/views/ofc-sale-view.tsx', 'utf8')
const otherSaleView = await readFile('src/components/erp/views/other-sale-view.tsx', 'utf8')
const expenseView = await readFile('src/components/erp/views/expense-batch-view.tsx', 'utf8')

function client(tableError: any = null, rpcError: any = null) {
  return {
    from: () => ({ select: () => ({ limit: async () => ({ error: tableError }) }) }),
    rpc: async () => ({ error: rpcError }),
  }
}

test('missing table, RPC, and column are compatibility failures', () => {
  assert.equal(classifyPostgrestCompatibilityError({ code: 'PGRST205', message: 'table absent' }), 'missing-table')
  assert.equal(classifyPostgrestCompatibilityError({ code: 'PGRST202', message: 'function absent' }), 'missing-rpc')
  assert.equal(classifyPostgrestCompatibilityError({ code: 'PGRST204', message: 'column absent' }), 'missing-column')
})

test('missing UUID-ledger RPC selects the production operational path', async () => {
  resetDashboardCapabilityCacheForTests()
  assert.deepEqual(await detectLedgerCapability(client(null, {
    code: 'PGRST202',
    message: 'Could not find ledger_profit_loss in the schema cache',
  }) as any, 'business', '2026-07-27'), {
    path: 'operational-fallback',
    reason: 'missing-rpc',
  })
})

test('UUID-ledger path is selected only after both probes succeed', async () => {
  resetDashboardCapabilityCacheForTests()
  assert.equal((await detectLedgerCapability(client() as any, 'business', '2026-07-27')).path, 'uuid-ledger')
})

test('real authentication and permission errors remain failures', async () => {
  for (const error of [
    { code: 'PGRST301', message: 'JWT expired' },
    { code: '42501', message: 'permission denied' },
  ]) {
    resetDashboardCapabilityCacheForTests()
    await assert.rejects(() => detectLedgerCapability(client(error) as any, 'business', '2026-07-27'))
  }
})

test('one unavailable source permits a partial page payload', async () => {
  const [missing, healthy] = await Promise.all([
    isolateDashboardMetric(async () => { throw { code: 'PGRST205', message: 'missing table' } }),
    isolateDashboardMetric(async () => 'operational-data'),
  ])
  assert.equal(missing.available, false)
  assert.deepEqual(healthy, { value: 'operational-data', available: true, error: null })
})

test('accounting APIs detect capability before querying new ledger objects', () => {
  for (const route of [coaRoute, dayBookRoute, expensesRoute]) {
    assert.match(route, /getAccountingAvailability/)
    assert.match(route, /unavailableAccountingPayload/)
  }
  assert.match(reportsRoute, /isSchemaUnavailableError/)
  assert.match(availability, /This accounting feature is currently unavailable/)
  assert.match(trialBalanceRoute, /trialBalanceViaLegacySupabase/)
  assert.match(trialBalanceRoute, /safeApiError/)
})

test('unsupported UI sections use business-facing language and do not retry', () => {
  assert.match(accountsView, /This accounting feature is currently unavailable/)
  assert.match(reportsView, /This accounting feature is currently unavailable/)
  assert.match(accountsView, /retry: false/)
  assert.match(reportsView, /retry: false/)
  assert.match(expenseView, /availability\.message/)
  for (const view of [counterSaleView, onlineSaleView, ofcSaleView, otherSaleView]) {
    assert.match(view, /usePaymentAccounts/)
    assert.doesNotMatch(view, /availability\.message/)
  }
})

test('Other Sale uses the live salesmen route', () => {
  assert.match(otherSaleView, /apiFetchJson\('\/api\/salesmen'/)
  assert.doesNotMatch(otherSaleView, /apiFetchJson\('\/api\/sales\/salesmen'/)
})
