import { AsyncLocalStorage } from 'node:async_hooks'

export type PerformanceStage =
  | 'session.getServerSession'
  | 'session.loadSessionUser'
  | 'session.authAdminUser'
  | 'session.profileLookup'
  | 'session.rolePermissionWave'
  | 'session.permissionCodes'
  | 'preflight.dashboardCapability'
  | 'preflight.legacySchema'
  | 'preflight.phaseTable'
  | 'preflight.accountingAvailability'
  | 'endpoint.dashboardPayload'
  | 'endpoint.salesmanIdentity'
  | 'endpoint.invoiceList'
  | 'endpoint.invoiceQuery'
  | 'endpoint.businessAccountsRpc'
  | 'endpoint.businessAccountsChart'
  | 'endpoint.productList'
  | 'endpoint.productQuery'
  | 'endpoint.salesmenList'
  | 'endpoint.salesmenQuery'
  | 'endpoint.customersList'
  | 'endpoint.customersQuery'
  | 'endpoint.reportWorkload'

export type PerformanceStageRecord = {
  stage: PerformanceStage
  occurrence: number
  durationMs: number
  outcome: 'ok' | 'error'
}

export type PerformanceTimingSnapshot = {
  requestId: string
  route: string
  method: string
  status: number
  durationMs: number
  loadSessionUserCount: number
  duplicateLoadSessionUser: boolean
  stages: PerformanceStageRecord[]
}

type PerformanceContext = {
  requestId: string
  route: string
  method: string
  startedAt: number
  stages: PerformanceStageRecord[]
  stageCounts: Map<PerformanceStage, number>
  loadSessionUserCount: number
}

type PerformanceSeed = Pick<PerformanceContext, 'requestId' | 'route' | 'method' | 'startedAt'>

const performanceContext = new AsyncLocalStorage<PerformanceContext>()

function now(): number {
  try {
    return performance.now()
  } catch {
    return 0
  }
}

export async function measurePerformanceStage<T>(
  stage: PerformanceStage,
  operation: () => Promise<T> | T,
): Promise<T> {
  const context = performanceContext.getStore()
  if (!context) return operation()

  const startedAt = now()
  let outcome: PerformanceStageRecord['outcome'] = 'ok'
  try {
    return await operation()
  } catch (error) {
    outcome = 'error'
    throw error
  } finally {
    const occurrence = (context.stageCounts.get(stage) ?? 0) + 1
    context.stageCounts.set(stage, occurrence)
    context.stages.push({
      stage,
      occurrence,
      durationMs: Math.round(now() - startedAt),
      outcome,
    })
  }
}

export function countLoadSessionUserInvocation(): void {
  const context = performanceContext.getStore()
  if (context) context.loadSessionUserCount += 1
}

export async function runWithPerformanceTiming<T>(
  seed: PerformanceSeed,
  operation: () => Promise<T>,
  statusOf: (value: T) => number,
  complete: (snapshot: PerformanceTimingSnapshot) => void,
): Promise<T> {
  const context: PerformanceContext = {
    ...seed,
    stages: [],
    stageCounts: new Map(),
    loadSessionUserCount: 0,
  }

  return performanceContext.run(context, async () => {
    let status = 500
    try {
      const value = await operation()
      status = statusOf(value)
      return value
    } finally {
      complete({
        requestId: context.requestId,
        route: context.route,
        method: context.method,
        status,
        durationMs: Math.round(now() - context.startedAt),
        loadSessionUserCount: context.loadSessionUserCount,
        duplicateLoadSessionUser: context.loadSessionUserCount > 1,
        stages: [...context.stages],
      })
    }
  })
}
