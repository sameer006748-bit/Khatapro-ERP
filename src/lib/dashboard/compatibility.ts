export type PostgrestLikeError = {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

export type DashboardDataPath = 'uuid-ledger' | 'operational-fallback'

export type LedgerCapability = {
  path: DashboardDataPath
  reason: 'available' | 'missing-table' | 'missing-rpc' | 'missing-column'
}

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])
const MISSING_RPC_CODES = new Set(['42883', 'PGRST202'])
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204'])
const AUTH_SCOPE_CODES = new Set(['42501', 'PGRST301', 'PGRST302'])
const CACHE_TTL_MS = 5 * 60_000

let cachedCapability: { expiresAt: number; value: LedgerCapability } | null = null
let capabilityPromise: Promise<LedgerCapability> | null = null

function errorText(error: PostgrestLikeError): string {
  return [error.message, error.details, error.hint].filter(Boolean).join(' ').toLowerCase()
}

export function classifyPostgrestCompatibilityError(
  error: PostgrestLikeError | null | undefined,
): 'missing-table' | 'missing-rpc' | 'auth-scope' | 'other' {
  if (!error) return 'other'
  const code = String(error.code ?? '').toUpperCase()
  const text = errorText(error)
  if (
    MISSING_TABLE_CODES.has(code)
    || /relation .* does not exist/.test(text)
    || /could not find the table .*schema cache/.test(text)
  ) return 'missing-table'
  if (
    MISSING_RPC_CODES.has(code)
    || /function .* does not exist/.test(text)
    || /could not find the function .*schema cache/.test(text)
  ) return 'missing-rpc'
  if (
    MISSING_COLUMN_CODES.has(code)
    || /column .* does not exist/.test(text)
    || /could not find the .* column .*schema cache/.test(text)
  ) return 'missing-column'
  if (
    AUTH_SCOPE_CODES.has(code)
    || /permission denied|not authorized|authorization denied|business scope|row-level security/.test(text)
  ) return 'auth-scope'
  return 'other'
}

export function isSchemaUnavailableError(error: PostgrestLikeError | null | undefined): boolean {
  const kind = classifyPostgrestCompatibilityError(error)
  return kind === 'missing-table' || kind === 'missing-rpc' || kind === 'missing-column'
}

export function isAuthOrScopeError(error: PostgrestLikeError | null | undefined): boolean {
  return classifyPostgrestCompatibilityError(error) === 'auth-scope'
}

type CapabilityClient = {
  from(table: string): {
    select(columns: string): {
      limit(count: number): Promise<{ error: PostgrestLikeError | null }>
    }
  }
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ error: PostgrestLikeError | null }>
}

async function probeLedgerCapability(
  client: CapabilityClient,
  businessId: string,
  asOfDate: string,
): Promise<LedgerCapability> {
  const tableProbe = await client.from('ledger_accounts').select('id').limit(1)
  if (tableProbe.error) {
    const kind = classifyPostgrestCompatibilityError(tableProbe.error)
    if (kind === 'missing-table') return { path: 'operational-fallback', reason: kind }
    throw tableProbe.error
  }

  // This report RPC is shipped after the UUID ledger tables and the account
  // balance RPC used by the dashboard, so one call bounds RPC capability.
  const rpcProbe = await client.rpc('ledger_profit_loss', {
    p_business_id: businessId,
    p_from_date: asOfDate,
    p_to_date: asOfDate,
  })
  if (rpcProbe.error) {
    const kind = classifyPostgrestCompatibilityError(rpcProbe.error)
    if (kind === 'missing-table' || kind === 'missing-rpc' || kind === 'missing-column') {
      return { path: 'operational-fallback', reason: kind }
    }
    throw rpcProbe.error
  }
  return { path: 'uuid-ledger', reason: 'available' }
}

export async function detectLedgerCapability(
  client: CapabilityClient,
  businessId: string,
  asOfDate: string,
  now = Date.now(),
): Promise<LedgerCapability> {
  if (cachedCapability && cachedCapability.expiresAt > now) return cachedCapability.value
  if (capabilityPromise) return capabilityPromise

  capabilityPromise = probeLedgerCapability(client, businessId, asOfDate)
    .then((value) => {
      cachedCapability = { value, expiresAt: now + CACHE_TTL_MS }
      return value
    })
    .finally(() => {
      capabilityPromise = null
    })
  return capabilityPromise
}

export function resetDashboardCapabilityCacheForTests(): void {
  cachedCapability = null
  capabilityPromise = null
}

export function shouldRetryDashboardRequest(failureCount: number, status?: number): boolean {
  return failureCount < 1 && status !== 401 && status !== 403
}

export async function isolateDashboardMetric<T>(
  query: () => Promise<T>,
): Promise<{ value: T | null; available: boolean; error: PostgrestLikeError | null }> {
  try {
    return { value: await query(), available: true, error: null }
  } catch (error) {
    const shaped = error && typeof error === 'object'
      ? error as PostgrestLikeError
      : { message: String(error) }
    if (isAuthOrScopeError(shaped)) throw error
    return { value: null, available: false, error: shaped }
  }
}
