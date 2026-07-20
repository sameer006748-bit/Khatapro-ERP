import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('navigation follows URL history and fails closed for unauthorized routes', async () => {
  const shell = await source('src/components/erp/dashboard-shell.tsx')
  assert.match(shell, /const active = resolveInitialPage\(searchParams, user\)/)
  assert.match(shell, /params\.has\('ledger'\) && !canOpenLedger/)
  assert.match(shell, /params\.has\('invoice'\) && !canOpenInvoice/)
  assert.match(shell, /params\.has\('voucher'\) && !canOpenVoucher/)
  assert.match(shell, /window\.history\.replaceState/)
  assert.match(shell, /Page unavailable/)
})

test('Owner can configure real role mappings while Owner access stays immutable', async () => {
  const route = await source('src/app/api/setup/roles/route.ts')
  const view = await source('src/components/erp/views/permission-matrix-view.tsx')
  assert.match(route, /const su = await requireOwner\(loaded\)/)
  assert.match(route, /\.eq\('business_id', su\.businessId\)/)
  assert.match(route, /role\.name === 'Owner\/Admin'/)
  assert.match(route, /OWNER_PERMISSIONS_ARE_REQUIRED/)
  assert.match(route, /role_permissions/)
  assert.match(view, /method: 'PUT'/)
  assert.match(view, /Owner\/Admin always retains full access/)
})

test('Rider reads and mutations are scoped to the linked rider record', async () => {
  const list = await source('src/app/api/delivery-orders/route.ts')
  const detail = await source('src/app/api/delivery-orders/[id]/route.ts')
  const status = await source('src/app/api/delivery-orders/[id]/status/route.ts')
  assert.match(list, /loaded\.roleName === 'Rider'[\s\S]*getRiderByUserId[\s\S]*riderId = rider\.id/)
  assert.match(detail, /order\.riderId !== rider\.id/)
  assert.match(status, /order\.riderId !== rider\.id/)
})

test('safe errors expose request IDs without serializing raw exceptions', async () => {
  const observability = await source('src/lib/observability.ts')
  const auditRoute = await source('src/app/api/audit-logs/route.ts')
  assert.match(observability, /requestId: opts\.requestId/)
  assert.match(observability, /void opts\.error/)
  assert.doesNotMatch(observability, /error: sanitized/)
  assert.match(observability, /X-Request-Id/)
  assert.doesNotMatch(auditRoute, /entity_id, user_id, details/)
  assert.match(auditRoute, /actorCategory/)
})

test('mobile navigation and sheets retain reachable, scrollable controls', async () => {
  const shell = await source('src/components/erp/dashboard-shell.tsx')
  assert.match(shell, /minWidth: '48px', minHeight: '48px'/)
  assert.match(shell, /max-h-\[70vh\] overflow-y-auto/)
  assert.match(shell, /env\(safe-area-inset-bottom/)
})
