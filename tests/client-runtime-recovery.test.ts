import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('Trial Balance uses the legacy production report without a null-total response', async () => {
  const route = await source('src/app/api/trial-balance/route.ts')
  const access = await source('src/lib/accounting/voucher-supabase.ts')
  const view = await source('src/components/erp/views/trial-balance-view.tsx')

  assert.match(route, /trialBalanceViaLegacySupabase/)
  assert.doesNotMatch(route, /grandDebit:\s*null/)
  assert.match(access, /admin\.rpc\('trial_balance'/)
  assert.match(view, /apiFetchJson/)
  assert.match(view, /q\.isError/)
  assert.match(view, /Unable to load Trial Balance/)
})

test('Audit Log reads its supported production source and renders a local retry state', async () => {
  const route = await source('src/app/api/audit-logs/route.ts')
  const view = await source('src/components/erp/views/audit-log-view.tsx')

  assert.match(route, /isSupabaseConfigured/)
  assert.doesNotMatch(route, /isUsingSupabase/)
  assert.match(view, /apiFetchJson/)
  assert.match(view, /q\.isError/)
  assert.match(view, /q\.data\?\.rows\?\.length/)
})
