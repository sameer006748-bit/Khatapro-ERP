import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { riderIdentityCandidates } from '../src/lib/delivery/rider-identity.ts'

const dataAccess = await readFile('src/lib/delivery/data-access.ts', 'utf8')
const dashboardRoute = await readFile('src/app/api/rider-dashboard/route.ts', 'utf8')
const ordersRoute = await readFile('src/app/api/delivery-orders/route.ts', 'utf8')
const orderRoute = await readFile('src/app/api/delivery-orders/[id]/route.ts', 'utf8')
const deliveredRoute = await readFile('src/app/api/delivery-orders/[id]/delivered/route.ts', 'utf8')
const returnedRoute = await readFile('src/app/api/delivery-orders/[id]/returned/route.ts', 'utf8')
const statusRoute = await readFile('src/app/api/delivery-orders/[id]/status/route.ts', 'utf8')
const codRoute = await readFile('src/app/api/rider-cod/balances/route.ts', 'utf8')
const shell = await readFile('src/components/erp/dashboard-shell.tsx', 'utf8')
const riderUi = await readFile('src/components/erp/views/rider-dashboard.tsx', 'utf8')

test('Rider identity candidates cover legacy, Auth UUID and profile mappings', () => {
  assert.deepEqual(riderIdentityCandidates({
    userId: 'legacy-user-id',
    supabaseUserUuid: 'auth-uuid',
    profileId: 'profile-uuid',
  }), ['legacy-user-id', 'auth-uuid', 'profile-uuid'])
  assert.deepEqual(riderIdentityCandidates({
    userId: 'same-id',
    supabaseUserUuid: 'same-id',
    profileId: 'same-id',
  }), ['same-id'])
})

test('Rider resolution is active-only, business-scoped and fails closed on ambiguity', () => {
  assert.match(dataAccess, /\.eq\('business_id', businessId\)/)
  assert.match(dataAccess, /\.eq\('is_active', true\)/)
  assert.match(dataAccess, /\.in\('user_id', userIds\)/)
  assert.match(dataAccess, /data\.length !== 1/)
  assert.match(dashboardRoute, /getRiderForSession\(loaded\)/)
  assert.match(dashboardRoute, /RIDER_LINK_REQUIRED/)
})

test('Rider order reads accept own-order permission and remain server-scoped', () => {
  for (const route of [ordersRoute, orderRoute]) {
    assert.match(route, /can_view_own_orders/)
    assert.match(route, /getRiderForSession\(loaded\)/)
  }
  assert.match(ordersRoute, /listDeliveryOrders\(loaded\.businessId, riderId\)/)
  assert.match(ordersRoute, /RIDER_LINK_REQUIRED/)
  assert.match(orderRoute, /order\.riderId !== rider\.id/)
})

test('Delivered, partial, returned and status changes enforce Rider ownership', () => {
  for (const route of [deliveredRoute, returnedRoute, statusRoute]) {
    assert.match(route, /loaded\.roleName === 'Rider'/)
    assert.match(route, /getRiderForSession\(loaded\)/)
    assert.match(route, /order\.riderId !== rider\.id/)
  }
  assert.match(deliveredRoute, /recordDeliveryOutcome/)
  assert.match(deliveredRoute, /deliveredQty/)
  assert.match(deliveredRoute, /returnedQty/)
  assert.match(returnedRoute, /recordDeliveryOutcome/)
  assert.match(codRoute, /riderCodBalances\(loaded\.businessId, riderId\)/)
})

test('Rider Home is action-first and uses plain Rider language', () => {
  for (const label of [
    'Assalam-o-Alaikum',
    'Start Deliveries',
    'Cash to Submit',
    'Completed Today',
    'My Deliveries',
    'Amount to Collect',
    'CASH WITH YOU',
  ]) assert.match(riderUi, new RegExp(label, 'i'))
  assert.doesNotMatch(riderUi, /Trial Balance|Journal|Voucher|Debit|Credit|Ledger posted/)
  assert.doesNotMatch(riderUi, /<table/)
})

test('Rider delivery result flows have large actions and simple feedback', () => {
  for (const label of ['DELIVERED', 'PARTIAL', 'RETURNED', 'Confirm Delivered', 'Confirm Partial', 'Confirm Return']) {
    assert.match(riderUi, new RegExp(label))
  }
  for (const reason of ['Customer refused', 'Customer unavailable', 'Wrong item', 'Other']) {
    assert.match(riderUi, new RegExp(reason))
  }
  for (const feedback of ['Delivery completed', 'Partial delivery saved', 'Return recorded', 'Could not save. Please try again.']) {
    assert.equal(riderUi.includes(feedback), true, feedback)
  }
  assert.match(riderUi, /h-16/)
  assert.match(riderUi, /size-12/)
})

test('Rider navigation is exactly Home, Deliveries, Cash and Profile', () => {
  const riderSlots = shell.slice(shell.indexOf('const RIDER_MOBILE_SLOTS'), shell.indexOf('// Main shell'))
  assert.equal((riderSlots.match(/\{ id:/g) ?? []).length, 4)
  for (const label of ['Home', 'Deliveries', 'Cash', 'Profile']) {
    assert.equal(riderSlots.includes(`label: '${label}'`), true, label)
  }
  assert.doesNotMatch(riderSlots, /Accounting|Reports|Setup|Business Accounts|Audit/)
  assert.match(shell, /href=\{`\/\?page=\$\{slot\.key\}`\}/)
  assert.match(shell, /user\.roleName !== 'Rider' && <LazyAiAssistant/)
  assert.match(shell, /if \(item\.riderOnly\) return user\.roleName === 'Rider'/)
})

test('Rider errors terminate with retry actions instead of blank screens', () => {
  assert.match(riderUi, /Could not load deliveries\./)
  assert.match(riderUi, /Could not load delivery\./)
  assert.match(riderUi, /Try Again/)
  assert.match(riderUi, /12_000/)
})
