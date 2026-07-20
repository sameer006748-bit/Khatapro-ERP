/**
 * Server-only data-access layer for AI provider settings.
 *
 * Branches between local Prisma SQLite storage (development) and the
 * Supabase architecture (production). Never exposes the encrypted API key
 * or raw records to client components.
 */
import 'server-only'
import { db } from '@/lib/db'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { getAdminClient } from '@/lib/supabase/server-admin'
import { encrypt, decrypt } from '@/lib/security/ai-secret-encryption'
import {
  probeGeminiKey,
  type GeminiFailureCategory,
} from '@/lib/ai/gemini-client'

export type AiSettingsRecord = {
  configured: boolean
  provider: string
  status: AiConnectionStatus
  lastTestedAt: string | null
  errorCategory: GeminiFailureCategory | null
}

export type AiConnectionStatus =
  | 'not_configured'
  | 'not_tested'
  | 'connected'
  | 'invalid'
  | 'failed'
  | 'configuration_error'

export type AiSettingsUpdate = {
  apiKey: string
}

export type AiConnectionTestResult = {
  status: AiConnectionStatus
  lastTestedAt: string
  errorCategory: GeminiFailureCategory | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Supabase-mode sessions already carry the authenticated auth.users UUID.
 * Validate that value locally instead of querying the development-only
 * Prisma/SQLite user table from a serverless production function.
 */
function normalizeSupabaseUserUuid(userId: string | null): string | null {
  const normalized = userId?.trim() ?? ''
  return UUID_PATTERN.test(normalized) ? normalized : null
}

const GEMINI_FAILURE_CATEGORY_SET = new Set<GeminiFailureCategory>([
  'invalid_api_key',
  'permission_denied',
  'model_not_found',
  'quota_exceeded',
  'rate_limited',
  'timeout',
  'malformed_request',
  'provider_unavailable',
])

function normalizeFailureCategory(value: string | null): GeminiFailureCategory | null {
  return value && GEMINI_FAILURE_CATEGORY_SET.has(value as GeminiFailureCategory)
    ? value as GeminiFailureCategory
    : null
}

function normalizeDecryptedApiKey(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function mapSupabaseRow(row: {
  business_id: string
  provider: string
  encrypted_api_key: string
  connection_status: string
  last_tested_at: string | null
  last_error_code: string | null
}): AiSettingsRecord {
  const decrypted = normalizeDecryptedApiKey(
    decrypt(row.encrypted_api_key, row.business_id, row.provider),
  )
  const effectiveStatus = decrypted === null
    ? 'configuration_error'
    : (row.connection_status as AiConnectionStatus)

  return {
    configured: row.encrypted_api_key.length > 0,
    provider: row.provider,
    status: effectiveStatus,
    lastTestedAt: row.last_tested_at ?? null,
    errorCategory: decrypted === null
      ? null
      : normalizeFailureCategory(row.last_error_code),
  }
}

async function fetchSupabaseSettings(
  businessId: string,
  provider: string,
): Promise<AiSettingsRecord> {
  const admin = getAdminClient()
  if (!admin) {
    return {
      configured: false,
      provider,
      status: 'configuration_error',
      lastTestedAt: null,
      errorCategory: null,
    }
  }

  const { data, error } = await admin
    .from('ai_provider_settings')
    .select('business_id,provider,encrypted_api_key,connection_status,last_tested_at,last_error_code')
    .eq('business_id', businessId)
    .eq('provider', provider)
    .maybeSingle()

  if (error) {
    console.error(JSON.stringify({ event: 'ai_settings_store_failed', operation: 'read', classification: 'database_read_failed', severity: 'error' }))
    return {
      configured: false,
      provider,
      status: 'configuration_error',
      lastTestedAt: null,
      errorCategory: null,
    }
  }

  if (!data) {
    return {
      configured: false,
      provider,
      status: 'not_configured',
      lastTestedAt: null,
      errorCategory: null,
    }
  }

  return mapSupabaseRow(data)
}

async function upsertSupabaseSettings(
  businessId: string,
  provider: string,
  encryptedApiKey: string,
  keyLast4: string,
  encryptionKeyId: string,
  connectionStatus: string,
  userId: string | null,
): Promise<void> {
  const admin = getAdminClient()
  if (!admin) {
    throw new Error('Supabase is not configured')
  }

  const payload: Record<string, unknown> = {
    business_id: businessId,
    provider,
    encrypted_api_key: encryptedApiKey,
    key_last4: keyLast4,
    encryption_key_id: encryptionKeyId,
    connection_status: connectionStatus,
    last_tested_at: null,
    last_error_code: null,
    updated_at: new Date().toISOString(),
  }
  if (userId) payload.updated_by = userId

  const { error } = await admin
    .from('ai_provider_settings')
    .upsert(payload, { onConflict: 'business_id,provider' })

  if (error) {
    console.error(JSON.stringify({ event: 'ai_settings_store_failed', operation: 'save', classification: 'database_upsert_failed', severity: 'error' }))
    throw new Error('Failed to save AI settings')
  }
}

async function updateSupabaseConnectionStatus(
  businessId: string,
  provider: string,
  status: string,
  lastTestedAt: string,
  lastErrorCode: string | null,
  userId: string | null,
): Promise<void> {
  const admin = getAdminClient()
  if (!admin) {
    throw new Error('Supabase is not configured')
  }

  const payload: Record<string, unknown> = {
    connection_status: status,
    last_tested_at: lastTestedAt,
    last_error_code: lastErrorCode,
    updated_at: new Date().toISOString(),
  }
  if (userId) payload.updated_by = userId

  const { error } = await admin
    .from('ai_provider_settings')
    .update(payload)
    .eq('business_id', businessId)
    .eq('provider', provider)

  if (error) {
    console.error(JSON.stringify({ event: 'ai_settings_store_failed', operation: 'update', classification: 'database_status_update_failed', severity: 'error' }))
    // Do not throw — callers already return the status to the caller.
  }
}

async function deleteSupabaseSettings(
  businessId: string,
  provider: string,
): Promise<void> {
  const admin = getAdminClient()
  if (!admin) {
    throw new Error('Supabase is not configured')
  }

  const { error } = await admin
    .from('ai_provider_settings')
    .delete()
    .eq('business_id', businessId)
    .eq('provider', provider)

  if (error) {
    console.error(JSON.stringify({ event: 'ai_settings_store_failed', operation: 'delete', classification: 'database_delete_failed', severity: 'error' }))
    throw new Error('Failed to remove AI settings')
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read AI provider settings for a business.
 * NEVER returns the encrypted or plaintext API key.
 */
export async function getAiSettings(
  businessId: string,
  provider: string = 'gemini',
): Promise<AiSettingsRecord> {
  if (isSupabaseConfigured()) {
    return fetchSupabaseSettings(businessId, provider)
  }

  const row = await db.aiProviderSetting.findUnique({
    where: { businessId_provider: { businessId, provider } },
  })
  if (!row) {
    return {
      configured: false,
      provider,
      status: 'not_configured',
      lastTestedAt: null,
      errorCategory: null,
    }
  }

  const decrypted = normalizeDecryptedApiKey(
    decrypt(row.encryptedApiKey, businessId, provider),
  )
  const effectiveStatus = decrypted === null
    ? 'configuration_error'
    : row.connectionStatus as AiConnectionStatus

  return {
    configured: row.encryptedApiKey.length > 0,
    provider: row.provider,
    status: effectiveStatus,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    errorCategory: decrypted === null
      ? null
      : normalizeFailureCategory(row.lastErrorCode),
  }
}

/**
 * Save/upsert an AI provider API key.
 * Encrypts the key server-side, stores only the encrypted ciphertext
 * and last 4 characters. NEVER logs or returns the plaintext key.
 */
export async function saveAiSettings(
  businessId: string,
  provider: string,
  update: AiSettingsUpdate,
  userId: string,
  supabaseUserUuid: string | null = null,
): Promise<AiSettingsRecord> {
  const trimmedKey = update.apiKey.trim()
  if (trimmedKey.length < 8 || trimmedKey.length > 2000) {
    throw new Error('API key must be between 8 and 2000 characters')
  }

  const keyLast4 = trimmedKey.slice(-4)
  const encryptedApiKey = encrypt(trimmedKey, businessId, provider)
  const encryptionKeyId = process.env.AI_SETTINGS_ENCRYPTION_KEY_ID
  if (!encryptionKeyId) {
    throw new Error('AI_SETTINGS_ENCRYPTION_KEY_ID is not configured')
  }

  if (isSupabaseConfigured()) {
    const supabaseUuid = normalizeSupabaseUserUuid(supabaseUserUuid)
    await upsertSupabaseSettings(
      businessId,
      provider,
      encryptedApiKey,
      keyLast4,
      encryptionKeyId,
      'not_tested',
      supabaseUuid,
    )
    return {
      configured: true,
      provider,
      status: 'not_tested',
      lastTestedAt: null,
      errorCategory: null,
    }
  }

  await db.aiProviderSetting.upsert({
    where: { businessId_provider: { businessId, provider } },
    create: {
      businessId,
      provider,
      encryptedApiKey,
      keyLast4,
      encryptionKeyId,
      connectionStatus: 'not_tested',
      createdBy: userId,
      updatedBy: userId,
    },
    update: {
      encryptedApiKey,
      keyLast4,
      encryptionKeyId,
      connectionStatus: 'not_tested',
      lastTestedAt: null,
      lastErrorCode: null,
      updatedBy: userId,
    },
  })

  return {
    configured: true,
    provider,
    status: 'not_tested',
    lastTestedAt: null,
    errorCategory: null,
  }
}

/**
 * Server-only plaintext key access for an already authenticated and authorized
 * AI request. The key is never returned by an API route.
 */
export async function getAiApiKey(
  businessId: string,
  provider: string = 'gemini',
): Promise<string | null> {
  if (isSupabaseConfigured()) {
    const admin = getAdminClient()
    if (!admin) return null
    const { data, error } = await admin
      .from('ai_provider_settings')
      .select('encrypted_api_key')
      .eq('business_id', businessId)
      .eq('provider', provider)
      .maybeSingle()
    if (error || !data?.encrypted_api_key) return null
    return normalizeDecryptedApiKey(
      decrypt(data.encrypted_api_key, businessId, provider),
    )
  }

  const row = await db.aiProviderSetting.findUnique({
    where: { businessId_provider: { businessId, provider } },
    select: { encryptedApiKey: true },
  })
  return row
    ? normalizeDecryptedApiKey(decrypt(row.encryptedApiKey, businessId, provider))
    : null
}

/**
 * Test the stored AI provider key by making a lightweight API call.
 * Updates the connection status based on the result.
 */
export async function testAiConnection(
  businessId: string,
  provider: string,
  userId: string,
  supabaseUserUuid: string | null = null,
  requestId: string = 'unavailable',
): Promise<AiConnectionTestResult> {
  const nowIso = new Date().toISOString()

  if (isSupabaseConfigured()) {
    const admin = getAdminClient()
    if (!admin) {
      return { status: 'configuration_error', lastTestedAt: nowIso, errorCategory: null }
    }

    const { data, error } = await admin
      .from('ai_provider_settings')
      .select('encrypted_api_key')
      .eq('business_id', businessId)
      .eq('provider', provider)
      .maybeSingle()

    if (error || !data) {
      return { status: 'not_configured', lastTestedAt: nowIso, errorCategory: null }
    }

    const decrypted = normalizeDecryptedApiKey(
      decrypt(data.encrypted_api_key, businessId, provider),
    )
    if (decrypted === null) {
      const supabaseUuid = normalizeSupabaseUserUuid(supabaseUserUuid)
      await updateSupabaseConnectionStatus(
        businessId,
        provider,
        'configuration_error',
        nowIso,
        'decryption_failed',
        supabaseUuid,
      )
      return { status: 'configuration_error', lastTestedAt: nowIso, errorCategory: null }
    }

    return runGeminiTestAndPersist(
      businessId,
      provider,
      decrypted,
      normalizeSupabaseUserUuid(supabaseUserUuid),
      nowIso,
      requestId,
    )
  }

  const row = await db.aiProviderSetting.findUnique({
    where: { businessId_provider: { businessId, provider } },
  })
  if (!row) {
    return { status: 'not_configured', lastTestedAt: nowIso, errorCategory: null }
  }

  const decrypted = normalizeDecryptedApiKey(
    decrypt(row.encryptedApiKey, businessId, provider),
  )
  if (decrypted === null) {
    await db.aiProviderSetting.update({
      where: { id: row.id },
      data: {
        connectionStatus: 'configuration_error',
        lastTestedAt: new Date(),
        lastErrorCode: 'decryption_failed',
      },
    })
    return { status: 'configuration_error', lastTestedAt: nowIso, errorCategory: null }
  }

  return runGeminiTestAndPersistLocal(row.id, decrypted, nowIso, requestId)
}

async function runGeminiTestAndPersist(
  businessId: string,
  provider: string,
  decryptedKey: string,
  supabaseUserUuid: string | null,
  nowIso: string,
  requestId: string,
): Promise<AiConnectionTestResult> {
  const result = await probeGeminiKey(decryptedKey, requestId)
  await updateSupabaseConnectionStatus(
    businessId,
    provider,
    result.status,
    nowIso,
    result.errorCategory,
    supabaseUserUuid,
  )
  return { ...result, lastTestedAt: nowIso }
}

async function runGeminiTestAndPersistLocal(
  rowId: string,
  decryptedKey: string,
  nowIso: string,
  requestId: string,
): Promise<AiConnectionTestResult> {
  const result = await probeGeminiKey(decryptedKey, requestId)
  await db.aiProviderSetting.update({
    where: { id: rowId },
    data: {
      connectionStatus: result.status,
      lastTestedAt: new Date(),
      lastErrorCode: result.errorCategory,
    },
  })
  return { ...result, lastTestedAt: nowIso }
}

/**
 * Delete/remove AI provider settings for a business.
 */
export async function deleteAiSettings(
  businessId: string,
  provider: string,
): Promise<void> {
  if (isSupabaseConfigured()) {
    await deleteSupabaseSettings(businessId, provider)
    return
  }

  await db.aiProviderSetting.deleteMany({
    where: { businessId, provider },
  })
}
