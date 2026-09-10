import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { sessionUserFromDatabaseContext } from '../src/lib/auth/session-user.ts'

const root = new URL('../', import.meta.url)
const read = (path: string) => readFile(new URL(path, root), 'utf8')

const identity = { id: 'auth-user-1', email: 'user@example.com' }
const context = {
  profile_id: 'profile-1',
  business_id: 'business-1',
  role_id: 'role-salesman',
  role_name: 'Salesman',
  display_name: 'Sales User',
  phone: null,
  permission_codes: ['can_create_sales', 'can_view_own_sales'],
}

test('consolidated context produces the exact SessionUser authorization shape', () => {
  assert.deepEqual(sessionUserFromDatabaseContext(identity, context), {
    userId: identity.id,
    supabaseUserUuid: identity.id,
    profileId: context.profile_id,
    businessId: context.business_id,
    roleId: context.role_id,
    roleName: context.role_name,
    displayName: context.display_name,
    email: identity.email,
    phone: null,
    permissions: new Set(context.permission_codes),
  })
})

test('missing profile, invalid role context, or missing business scope fails closed', () => {
  assert.equal(sessionUserFromDatabaseContext(identity, null), null)
  assert.equal(sessionUserFromDatabaseContext(identity, { ...context, role_id: '' }), null)
  assert.equal(sessionUserFromDatabaseContext(identity, { ...context, role_name: '' }), null)
  assert.equal(sessionUserFromDatabaseContext(identity, { ...context, business_id: '' }), null)
})

test('permission set is exact and denied permissions stay denied without Owner fallback', () => {
  const session = sessionUserFromDatabaseContext(identity, context)
  assert.ok(session)
  assert.deepEqual([...session.permissions], context.permission_codes)
  assert.equal(session.permissions.has('can_view_sales'), false)
  assert.equal(session.permissions.has('can_manage_setup'), false)
  assert.equal(session.roleName, 'Salesman')
})

test('malformed permission output fails closed instead of inferring permissions', () => {
  assert.equal(sessionUserFromDatabaseContext(identity, { ...context, permission_codes: null }), null)
  assert.equal(sessionUserFromDatabaseContext(identity, { ...context, permission_codes: [''] }), null)
})

test('RPC is active-only, business-safe, invoker-rights, and service-role-only', async () => {
  const migration = await read('supabase/migrations/20260910093415_consolidate_session_user_context.sql')
  assert.match(migration, /where profile\.user_id = p_user_id\s+and profile\.is_active/i)
  assert.match(migration, /role\.id = profile\.role_id\s+and role\.business_id = profile\.business_id/i)
  assert.match(migration, /security invoker\s+set search_path = ''/i)
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/i)
  assert.match(migration, /grant execute[\s\S]*to service_role/i)
  assert.doesNotMatch(migration, /Owner\/Admin|security definer/i)
})

test('hydration retains one Auth Admin call and one consolidated database call per request', async () => {
  const permissions = await read('src/lib/auth/permissions.ts')
  const loader = permissions.slice(
    permissions.indexOf('async function _loadSessionUser'),
    permissions.indexOf('export function hasPermission'),
  )

  assert.equal((loader.match(/auth\.admin\.getUserById/g) ?? []).length, 1)
  assert.equal((loader.match(/\.rpc\('load_session_user_context'/g) ?? []).length, 1)
  assert.match(loader, /session\.authAdminUser/)
  assert.match(loader, /session\.contextLookup/)
  assert.doesNotMatch(loader, /session\.profileLookup|session\.rolePermissionWave|session\.permissionCodes/)
  assert.doesNotMatch(loader, /\.from\('profiles'\)|\.from\('roles'\)|\.from\('role_permissions'\)|\.from\('permissions'\)/)
})

test('Salesman and Rider own-record authorization remains downstream and unchanged', async () => {
  const [salesRoute, riderRoute] = await Promise.all([
    read('src/app/api/sales/counter/route.ts'),
    read('src/app/api/delivery-orders/route.ts'),
  ])

  assert.match(salesRoute, /can_view_own_sales/)
  assert.match(salesRoute, /resolveSalesmanIdForUser/)
  assert.match(salesRoute, /listInvoices\(su\.businessId, \{ type, salesmanId \}\)/)
  assert.match(riderRoute, /can_view_own_orders/)
  assert.match(riderRoute, /getRiderForSession\(loaded\)/)
  assert.match(riderRoute, /listDeliveryOrders\(loaded\.businessId, riderId\)/)
})
