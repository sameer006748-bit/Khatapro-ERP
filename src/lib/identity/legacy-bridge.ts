import 'server-only'

import { getAdminSupabase } from '@/lib/supabase/admin'
import {
  classifyPostgrestCompatibilityError,
  isSchemaUnavailableError,
  type PostgrestLikeError,
} from '@/lib/dashboard/compatibility'

const LEGACY_PROBE_TTL_MS = 30_000
let cachedLegacySchema: { expiresAt: number; value: boolean } | null = null

/**
 * The verified production database has the original schema and no UUID-ledger
 * tables. A missing UUID-ledger table is therefore a supported schema flavor,
 * not a service outage and never a reason to fall through to local SQLite.
 */
export async function usesLegacyTransactionSchema(now = Date.now()): Promise<boolean> {
  if (cachedLegacySchema && cachedLegacySchema.expiresAt > now) return cachedLegacySchema.value

  const { error } = await getAdminSupabase().from('ledger_vouchers').select('id').limit(1)
  if (!error) {
    cachedLegacySchema = { value: false, expiresAt: now + LEGACY_PROBE_TTL_MS }
    return false
  }
  if (isSchemaUnavailableError(error)) {
    cachedLegacySchema = { value: true, expiresAt: now + LEGACY_PROBE_TTL_MS }
    return true
  }
  throw new Error(`Legacy schema probe: ${error.message ?? 'database request failed'}`)
}

export class LegacyIdentityMigrationRequiredError extends Error {
  readonly code = 'LEGACY_IDENTITY_MIGRATION_REQUIRED'

  constructor(entity: string) {
    super(`${entity} requires database migration 00036_legacy_transaction_identity_bridge.sql before it can be posted safely.`)
    this.name = 'LegacyIdentityMigrationRequiredError'
  }
}

type RpcResponse = { data: unknown; error: PostgrestLikeError | null }

function rpcError(name: string, error: PostgrestLikeError): Error {
  return new Error(`${name}: ${error.message ?? 'database request failed'}`)
}

/**
 * Calls an identity-aware overload installed by 00036. If 00036 is not yet
 * applied, retry the unchanged legacy signature so existing pages remain
 * usable. Only a missing-signature/schema-cache error is eligible for retry.
 */
export async function callLegacyIdentityRpc(
  name: string,
  args: Record<string, unknown>,
  idempotencyKey: string | null | undefined,
): Promise<{ data: unknown; bridgeApplied: boolean }> {
  const admin = getAdminSupabase()
  if (idempotencyKey) {
    const bridged = await admin.rpc(name, { ...args, p_idempotency_key: idempotencyKey }) as RpcResponse
    if (!bridged.error) return { data: bridged.data, bridgeApplied: true }
    if (classifyPostgrestCompatibilityError(bridged.error) !== 'missing-rpc') {
      throw rpcError(name, bridged.error)
    }
  }

  const legacy = await admin.rpc(name, args) as RpcResponse
  if (legacy.error) throw rpcError(name, legacy.error)
  return { data: legacy.data, bridgeApplied: false }
}

/** Sales returns cannot safely fall back: without 00036 no return_no exists. */
export async function callRequiredLegacyIdentityRpc(
  name: string,
  args: Record<string, unknown>,
  idempotencyKey: string,
  entity: string,
): Promise<unknown> {
  const { data, error } = await getAdminSupabase().rpc(name, {
    ...args,
    p_idempotency_key: idempotencyKey,
  }) as RpcResponse
  if (!error) return data
  if (classifyPostgrestCompatibilityError(error) === 'missing-rpc') {
    throw new LegacyIdentityMigrationRequiredError(entity)
  }
  throw rpcError(name, error)
}

export function resetLegacySchemaCacheForTests(): void {
  cachedLegacySchema = null
}
