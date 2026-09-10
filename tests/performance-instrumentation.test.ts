import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  countLoadSessionUserInvocation,
  measurePerformanceStage,
  runWithPerformanceTiming,
  type PerformanceTimingSnapshot,
} from '../src/lib/performance-timing.ts'

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

test('request timing isolates concurrent nested stages and load counts', async () => {
  const [first, second] = await Promise.all([
    capture('request-a', async () => {
      countLoadSessionUserInvocation()
      countLoadSessionUserInvocation()
      await measurePerformanceStage('session.loadSessionUser', async () => {
        await measurePerformanceStage('session.profileLookup', async () => undefined)
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
    { stage: 'session.profileLookup', occurrence: 1 },
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

test('target GET routes opt in and time getServerSession without changing guards', async () => {
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
    assert.match(route, /session\.getServerSession/)
    assert.match(route, /performanceTiming: true/)
    assert.match(route, /loadSessionUser\(/)
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
  assert.match(permissions, /session\.profileLookup/)
  assert.match(permissions, /session\.rolePermissionWave/)
  assert.match(permissions, /session\.permissionCodes/)
})
