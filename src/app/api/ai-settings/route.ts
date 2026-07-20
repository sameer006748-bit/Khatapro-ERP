import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { writeAudit } from '@/lib/auth/permissions'
import {
  getAiSettings,
  saveAiSettings,
  deleteAiSettings,
} from '@/lib/ai/ai-settings-store'
import {
  AiSettingsAuthError,
  requireAiSettingsOwner,
  requireSameOrigin,
} from '@/lib/ai/ai-settings-auth'
import { AI_PROVIDER } from '@/lib/ai/config'
import { resolveRequestId, safeApiError, withObservability } from '@/lib/observability'

const PROVIDER = AI_PROVIDER

const saveSchema = z.object({
  apiKey: z.string().trim().min(8).max(2000),
})

function safeErrorResponse(error: unknown, req: NextRequest) {
  const requestId = resolveRequestId(req)
  if (error instanceof AiSettingsAuthError) {
    return NextResponse.json(
      { error: error.code, requestId },
      {
        status: error.status,
        headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId },
      },
    )
  }

  return safeApiError({ route: '/api/ai-settings', requestId, errorCode: 'AI_SETTINGS_FAILED', userMessage: 'AI settings could not be updated.', error, method: req.method })
}

async function getSettings(req: NextRequest) {
  try {
    const session = await requireAiSettingsOwner(req)
    const settings = await getAiSettings(session.businessId, PROVIDER)

    return NextResponse.json(settings, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return safeErrorResponse(error, req)
  }
}

async function saveSettings(req: NextRequest) {
  try {
    requireSameOrigin(req)

    const session = await requireAiSettingsOwner(req)
    const body = await req.json().catch(() => null)
    const parsed = saveSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR' },
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store' },
        },
      )
    }

    const settings = await saveAiSettings(
      session.businessId,
      PROVIDER,
      parsed.data,
      session.userId,
    )

    await writeAudit({
      businessId: session.businessId,
      userId: session.userId,
      action: 'AI_SETTINGS_KEY_SAVED',
      entity: 'ai_provider_settings',
      details: {
        provider: PROVIDER,
        encryptionKeyId: process.env.AI_SETTINGS_ENCRYPTION_KEY_ID,
      },
    })

    return NextResponse.json(settings, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return safeErrorResponse(error, req)
  }
}

async function removeSettings(req: NextRequest) {
  try {
    requireSameOrigin(req)

    const session = await requireAiSettingsOwner(req)

    await deleteAiSettings(session.businessId, PROVIDER)

    await writeAudit({
      businessId: session.businessId,
      userId: session.userId,
      action: 'AI_SETTINGS_KEY_REMOVED',
      entity: 'ai_provider_settings',
      details: { provider: PROVIDER },
    })

    return NextResponse.json(
      {
        configured: false,
        provider: PROVIDER,
        status: 'not_configured',
        lastTestedAt: null,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  } catch (error) {
    return safeErrorResponse(error, req)
  }
}

export const GET = withObservability('/api/ai-settings', getSettings)
export const POST = withObservability('/api/ai-settings', saveSettings)
export const DELETE = withObservability('/api/ai-settings', removeSettings)
