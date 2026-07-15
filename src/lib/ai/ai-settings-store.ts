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

export type AiSettingsRecord = {
  configured: boolean
  provider: string
  maskedKey: string | null
  status: AiConnectionStatus
  lastTestedAt: string | null
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

export function maskApiKey(keyLast4: string): string {
  return `****************${keyLast4}`
}

/**
 * Resolve a Prisma user id to a Supabase auth.users UUID.
 * Returns null when:
 * - Supabase is not configured.
 * - The user has no supabaseUserUuid populated.
 * This prevents invalid UUID writes to ai_provider_settings.
 */
async function resolveSupabaseUserUuid(
  userOrId: string,
): Promise<string | null> {
  let row: { supabaseUserUuid: string | null } | null = null
  if (userOrId.length > 30) {
    // Looks like a UUID already (Prisma cuid is 25 chars; Supabase UUID is 36)
    row = await db.user.findUnique({
      where: { id: userOrId },
      select: { supabaseUserUuid: true },
    })
  }
  if (!row) {
    row = await db.user.findFirst({
      where: { supabaseUserUuid: userOrId },
      select: { supabaseUserUuid: true },
    })
  }
  return row?.supabaseUserUuid ?? null
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function mapSupabaseRow(row: {
  business_id: string
  provider: string
  encrypted_api_key: string
  key_last4: string
  connection_status: string
  last_tested_at: string | null
}): AiSettingsRecord {
  const decrypted = decrypt(row.encrypted_api_key, row.business_id, row.provider)
  const effectiveStatus = decrypted === null
    ? 'configuration_error'
    : (row.connection_status as AiConnectionStatus)

  return {
    configured: row.encrypted_api_key.length > 0,
    provider: row.provider,
    maskedKey: maskApiKey(row.key_last4),
    status: effectiveStatus,
    lastTestedAt: row.last_tested_at ?? null,
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
      maskedKey: null,
      status: 'configuration_error',
      lastTestedAt: null,
    }
  }

  const { data, error } = await admin
    .from('ai_provider_settings')
    .select('business_id,provider,encrypted_api_key,key_last4,connection_status,last_tested_at')
    .eq('business_id', businessId)
    .eq('provider', provider)
    .maybeSingle()

  if (error) {
    console.error('Supabase GET ai_provider_settings error:', error)
    return {
      configured: false,
      provider,
      maskedKey: null,
      status: 'configuration_error',
      lastTestedAt: null,
    }
  }

  if (!data) {
    return {
      configured: false,
      provider,
      maskedKey: null,
      status: 'not_configured',
      lastTestedAt: null,
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
    console.error('Supabase UPSERT ai_provider_settings error:', error)
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
    console.error('Supabase UPDATE ai_provider_settings error:', error)
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
    console.error('Supabase DELETE ai_provider_settings error:', error)
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
      maskedKey: null,
      status: 'not_configured',
      lastTestedAt: null,
    }
  }

  const decrypted = decrypt(row.encryptedApiKey, businessId, provider)
  const effectiveStatus = decrypted === null
    ? 'configuration_error'
    : row.connectionStatus as AiConnectionStatus

  return {
    configured: row.encryptedApiKey.length > 0,
    provider: row.provider,
    maskedKey: maskApiKey(row.keyLast4),
    status: effectiveStatus,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
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
    const supabaseUuid = await resolveSupabaseUserUuid(userId)
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
      maskedKey: maskApiKey(keyLast4),
      status: 'not_tested',
      lastTestedAt: null,
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
    maskedKey: maskApiKey(keyLast4),
    status: 'not_tested',
    lastTestedAt: null,
  }
}

/**
 * Test the stored AI provider key by making a lightweight API call.
 * Updates the connection status based on the result.
 */
export async function testAiConnection(
  businessId: string,
  provider: string,
  userId: string,
): Promise<{ status: AiConnectionStatus; lastTestedAt: string }> {
  const nowIso = new Date().toISOString()

  if (isSupabaseConfigured()) {
    const admin = getAdminClient()
    if (!admin) {
      return { status: 'configuration_error', lastTestedAt: nowIso }
    }

    const { data, error } = await admin
      .from('ai_provider_settings')
      .select('encrypted_api_key')
      .eq('business_id', businessId)
      .eq('provider', provider)
      .maybeSingle()

    if (error || !data) {
      return { status: 'not_configured', lastTestedAt: nowIso }
    }

    const decrypted = decrypt(data.encrypted_api_key, businessId, provider)
    if (decrypted === null) {
      const supabaseUuid = await resolveSupabaseUserUuid(userId)
      await updateSupabaseConnectionStatus(
        businessId,
        provider,
        'configuration_error',
        nowIso,
        'decryption_failed',
        supabaseUuid,
      )
      return { status: 'configuration_error', lastTestedAt: nowIso }
    }

    return runGeminiTestAndPersist(businessId, provider, decrypted, userId, nowIso)
  }

  const row = await db.aiProviderSetting.findUnique({
    where: { businessId_provider: { businessId, provider } },
  })
  if (!row) {
    return { status: 'not_configured', lastTestedAt: nowIso }
  }

  const decrypted = decrypt(row.encryptedApiKey, businessId, provider)
  if (decrypted === null) {
    await db.aiProviderSetting.update({
      where: { id: row.id },
      data: {
        connectionStatus: 'configuration_error',
        lastTestedAt: new Date(),
        lastErrorCode: 'decryption_failed',
      },
    })
    return { status: 'configuration_error', lastTestedAt: nowIso }
  }

  return runGeminiTestAndPersistLocal(row.id, businessId, provider, decrypted, nowIso)
}

async function runGeminiTestAndPersist(
  businessId: string,
  provider: string,
  decryptedKey: string,
  userId: string,
  nowIso: string,
): Promise<{ status: AiConnectionStatus; lastTestedAt: string }> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    let response: Response
    try {
      response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models',
        {
          method: 'GET',
          headers: {
            'x-goog-api-key': decryptedKey,
            accept: 'application/json',
          },
          signal: controller.signal,
          cache: 'no-store',
        },
      )
    } finally {
      clearTimeout(timeout)
    }

    let status: AiConnectionStatus
    let errorCode: string | null = null

    if (response.ok) {
      status = 'connected'
    } else if (response.status === 401 || response.status === 403) {
      status = 'invalid'
      errorCode = 'authentication_failed'
    } else {
      status = 'failed'
      errorCode = `provider_error:${response.status}`
    }

    const supabaseUuid = await resolveSupabaseUserUuid(userId)
    await updateSupabaseConnectionStatus(
      businessId,
      provider,
      status,
      nowIso,
      errorCode,
      supabaseUuid,
    )
    return { status, lastTestedAt: nowIso }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.name : 'unknown'
    const status: AiConnectionStatus =
      errorMessage === 'AbortError' ? 'failed' : 'failed'
    const errorCode = errorMessage === 'AbortError' ? 'timeout' : 'network_error'

    const supabaseUuid = await resolveSupabaseUserUuid(userId)
    await updateSupabaseConnectionStatus(
      businessId,
      provider,
      status,
      nowIso,
      errorCode,
      supabaseUuid,
    )
    return { status, lastTestedAt: nowIso }
  }
}

async function runGeminiTestAndPersistLocal(
  rowId: string,
  businessId: string,
  provider: string,
  decryptedKey: string,
  nowIso: string,
): Promise<{ status: AiConnectionStatus; lastTestedAt: string }> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    let response: Response
    try {
      response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models',
        {
          method: 'GET',
          headers: {
            'x-goog-api-key': decryptedKey,
            accept: 'application/json',
          },
          signal: controller.signal,
          cache: 'no-store',
        },
      )
    } finally {
      clearTimeout(timeout)
    }

    let status: AiConnectionStatus
    let errorCode: string | null = null

    if (response.ok) {
      status = 'connected'
    } else if (response.status === 401 || response.status === 403) {
      status = 'invalid'
      errorCode = 'authentication_failed'
    } else {
      status = 'failed'
      errorCode = `provider_error:${response.status}`
    }

    await db.aiProviderSetting.update({
      where: { id: rowId },
      data: {
        connectionStatus: status,
        lastTestedAt: new Date(),
        lastErrorCode: errorCode,
      },
    })
    return { status, lastTestedAt: nowIso }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.name : 'unknown'
    const status: AiConnectionStatus =
      errorMessage === 'AbortError' ? 'failed' : 'failed'
    const errorCode = errorMessage === 'AbortError' ? 'timeout' : 'network_error'

    await db.aiProviderSetting.update({
      where: { id: rowId },
      data: {
        connectionStatus: status,
        lastTestedAt: new Date(),
        lastErrorCode: errorCode,
      },
    })
    return { status, lastTestedAt: nowIso }
  }
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