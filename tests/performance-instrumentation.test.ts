import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  countLoadSessionUserInvocation,
  measurePerformanceStage,
  runWithPerformanceTiming,
  type PerformanceTimingSnapshot,
} from '../src/lib/performance-timing.ts'
import { sessionUserFromHydratedUser } from '../src/lib/auth/session-user.ts'

const root = new URL('../', import.meta.url)
const read = (path: string) => readFile(new URL(path, root), 'utf8')

async function capture(
  requestId: string,
  operation: () => Promise<number>,
): Promise<{ value?: number; error?: unknown; snapshots: PerformanceTimingSnapshot[] }> {
  const snapshots: PerformanceTimingSnapshot[] = []
  try {
    const value = await runWithPerformanceTiming(
      { requestId, route: '/api/test', method: 'GET', startedAt: performance.now() },
      operation,
      (status) => status,
      (completed) => { snapshots.push(completed) },
    )
    assert.equal(snapshots.length, 1)
    return { value, snapshots }
  } catch (error) {
    assert.equal(snapshots.length, 1)
    return { error, snapshots }
  }
}

test('successful 200 timing completes exactly once with the safe schema', async () => {
  const result = await capture('successful-request', async () => {
    countLoadSessionUserInvocation()
    await measurePerformanceStage('session.getServerSession', async () => undefined)
    return 200
  })

  assert.equal(result.value, 200)
  assert.equal(result.snapshots.length, 1)
  const snapshot = result.snapshots[0]
  assert.equal(snapshot.status, 200)
  assert.equal(snapshot.loadSessionUserCount, 1)
  assert.equal(snapshot.duplicateLoadSessionUser, false)
  assert.deepEqual(snapshot.stages.map(({ stage }) => stage), ['session.getServerSession'])
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'duplicateLoadSessionUser', 'durationMs', 'loadSessionUserCount', 'method',
    'requestId', 'route', 'stages', 'status',
  ])
})

test('successful target requests count the callback hydration once, not the route conversion', async () => {
  const authOptions = await read('src/lib/auth/authOptions.ts')
  const helper = await read('src/lib/auth/session-user.ts')
  const result = await capture('target-request', async () => {
    countLoadSessionUserInvocation()
    await measurePerformanceStage('session.getServerSession', async () => undefined)
    return 200
  })

  assert.equal(result.snapshots[0].loadSessionUserCount, 1)
  assert.equal(result.snapshots[0].duplicateLoadSessionUser, false)
  assert.match(authOptions, /async session\([\s\S]*loadSessionUser\(token\.userId as string\)/)
  assert.doesNotMatch(helper, /loadSessionUser|countLoadSessionUserInvocation|cache\(/)
})

test('request timing isolates concurrent nested stages and load counts', async () => {
  const [first, second] = await Promise.all([
    capture('request-a', async () => {
      countLoadSessionUserInvocation()
      countLoadSessionUserInvocation()
      await measurePerformanceStage('session.loadSessionUser', async () => {
        await measurePerformanceStage('session.contextLookup', async () => undefined)
      })
      return 1
    }),
    capture('request-b', async () => {
      countLoadSessionUserInvocation()
      await measurePerformanceStage('endpoint.productList', async () => undefined)
      return 2
    }),
  ])

  assert.equal(first.value, 1)
  assert.equal(first.snapshots[0].loadSessionUserCount, 2)
  assert.equal(first.snapshots[0].duplicateLoadSessionUser, true)
  assert.deepEqual(first.snapshots[0].stages.map(({ stage, occurrence }) => ({ stage, occurrence })), [
    { stage: 'session.contextLookup', occurrence: 1 },
    { stage: 'session.loadSessionUser', occurrence: 1 },
  ])
  assert.equal(second.value, 2)
  assert.equal(second.snapshots[0].loadSessionUserCount, 1)
  assert.equal(second.snapshots[0].duplicateLoadSessionUser, false)
  assert.deepEqual(second.snapshots[0].stages.map(({ stage }) => stage), ['endpoint.productList'])
})

test('401 completion emits exactly one timing snapshot', async () => {
  const result = await capture('unauthorized-request', async () => 401)
  assert.equal(result.value, 401)
  assert.equal(result.snapshots.length, 1)
  assert.equal(result.snapshots[0].status, 401)
})

test('completion snapshot is emitted for an error with safe fixed fields only', async () => {
  const secretFragments = [
    'secret-token', 'session-cookie', 'user-uuid', 'business-uuid',
    'can_view_pl', 'customer-name', '999999',
  ]
  const result = await capture('safe-request-id', async () => {
    await measurePerformanceStage('endpoint.reportWorkload', async () => {
      throw new Error(secretFragments.join(' '))
    })
    return 0
  })

  assert.ok(result.error)
  assert.equal(result.snapshots.length, 1)
  const snapshot = result.snapshots[0]
  assert.equal(snapshot.status, 500)
  assert.equal(snapshot.stages[0]?.outcome, 'error')
  const serialized = JSON.stringify(snapshot)
  for (const fragment of secretFragments) assert.doesNotMatch(serialized, new RegExp(fragment))
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'duplicateLoadSessionUser', 'durationMs', 'loadSessionUserCount', 'method',
    'requestId', 'route', 'stages', 'status',
  ])
  assert.deepEqual(Object.keys(snapshot.stages[0] ?? {}).sort(), [
    'durationMs', 'occurrence', 'outcome', 'stage',
  ])
})

test('target GET routes reuse the one fresh SessionUser hydration from getServerSession', async () => {
  const routes = await Promise.all([
    'src/app/api/dashboard/owner/route.ts',
    'src/app/api/sales/counter/route.ts',
    'src/app/api/setup/business-accounts/route.ts',
    'src/app/api/products/route.ts',
    'src/app/api/salesmen/route.ts',
    'src/app/api/customers/route.ts',
    'src/app/api/reports/route.ts',
  ].map(read))

  for (const route of routes) {
    const getHandler = route.includes('const getSales =')
      ? route.slice(route.indexOf('const getSales ='), route.indexOf("export const GET ="))
      : route.includes('async function getSetupBusinessAccounts')
        ? route.slice(route.indexOf('async function getSetupBusinessAccounts'), route.indexOf('async function postSetupBusinessAccounts'))
        : route.includes('export const GET =')
          ? route.slice(route.indexOf('export const GET ='), route.indexOf('const CreateSchema') > 0 ? route.indexOf('const CreateSchema') : route.length)
          : route
    assert.match(getHandler, /session\.getServerSession/)
    assert.match(route, /performanceTiming: true/)
    assert.match(getHandler, /sessionUserFromHydratedUser\(session\.user\)/)
    assert.doesNotMatch(getHandler, /loadSessionUser\(/)
  }
  assert.match(routes[1], /can_view_sales/)
  assert.match(routes[1], /can_view_own_sales/)
  assert.match(routes[5], /can_create_sales[\s\S]*can_view_sales[\s\S]*can_view_customer_ledger/)
  assert.match(routes[6], /hasPermission\(loaded, requiredPerm\)/)
})

test('loadSessionUser still delegates through React cache and counts each caller', async () => {
  const permissions = await read('src/lib/auth/permissions.ts')
  assert.match(permissions, /const cachedLoadSessionUser = cache\(_loadSessionUser\)/)
  assert.match(permissions, /countLoadSessionUserInvocation\(\)[\s\S]{0,120}measurePerformanceStage\('session\.loadSessionUser',[\s\S]{0,120}cachedLoadSessionUser\(userId\)/)
  assert.match(permissions, /session\.authAdminUser/)
  assert.match(permissions, /session\.contextLookup/)
  assert.doesNotMatch(permissions, /session\.profileLookup|session\.rolePermissionWave|session\.permissionCodes/)
})

test('fresh session hydration stays per request and is not stored in the JWT', async () => {
  const authOptions = await read('src/lib/auth/authOptions.ts')
  const sessionCallback = authOptions.slice(
    authOptions.indexOf('async session('),
    authOptions.indexOf('return session', authOptions.indexOf('async session(')) + 'return session'.length,
  )
  const jwtCallback = authOptions.slice(
    authOptions.indexOf('async jwt('),
    authOptions.indexOf('async session('),
  )

  assert.match(sessionCallback, /loadSessionUser\(token\.userId as string\)/)
  assert.match(sessionCallback, /permissions = Array\.from\(su\.permissions\)/)
  assert.match(sessionCallback, /phone = su\.phone/)
  assert.doesNotMatch(jwtCallback, /permissions|businessId|roleId|roleName|profileId/)
})

test('hydrated-session conversion is exact and fails closed without fallbacks', async () => {
  const complete = {
    id: 'auth-user',
    supabaseUserUuid: 'auth-user',
    profileId: 'profile-1',
    businessId: 'business-1',
    roleId: 'role-1',
    roleName: 'Salesman',
    displayName: 'Test User',
    email: '',
    phone: null,
    permissions: ['can_view_own_sales'],
  }
  const exact = sessionUserFromHydratedUser(complete)
  assert.ok(exact)
  assert.deepEqual(exact, {
    userId: 'auth-user',
    supabaseUserUuid: 'auth-user',
    profileId: 'profile-1',
    businessId: 'business-1',
    roleId: 'role-1',
    roleName: 'Salesman',
    displayName: 'Test User',
    email: '',
    phone: null,
    permissions: new Set(['can_view_own_sales']),
  })

  for (const invalid of [
    null,
    { id: 'auth-user', permissions: [] },
    { ...complete, businessId: '' },
    { ...complete, permissions: [''] },
  ]) assert.equal(sessionUserFromHydratedUser(invalid), null)

  const helper = await read('src/lib/auth/session-user.ts')
  assert.doesNotMatch(helper, /Owner\/Admin|new Set\(\['|\?\?\s*['"][^'"]+['"]/i)
})
