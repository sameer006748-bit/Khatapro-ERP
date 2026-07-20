import { NextRequest, NextResponse } from 'next/server'
import { writeAudit } from '@/lib/auth/permissions'
import { testAiConnection } from '@/lib/ai/ai-settings-store'
import {
  AiSettingsAuthError,
  requireAiSettingsOwner,
  requireSameOrigin,
} from '@/lib/ai/ai-settings-auth'
import { AI_PROVIDER } from '@/lib/ai/config'
import { resolveRequestId, safeApiError, withObservability } from '@/lib/observability'

const PROVIDER = AI_PROVIDER

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

  return safeApiError({ route: '/api/ai-settings/test', requestId, errorCode: 'AI_CONNECTION_TEST_FAILED', userMessage: 'The Gemini connection could not be tested.', error, method: 'POST' })
}

async function testConnection(req: NextRequest) {
  try {
    requireSameOrigin(req)

    const session = await requireAiSettingsOwner(req)
    const result = await testAiConnection(
      session.businessId,
      PROVIDER,
      session.userId,
      session.supabaseUserUuid,
      resolveRequestId(req),
    )

    await writeAudit({
      businessId: session.businessId,
      userId: session.userId,
      action: 'AI_SETTINGS_CONNECTION_TESTED',
      entity: 'ai_provider_settings',
      details: {
        provider: PROVIDER,
        status: result.status,
      },
    })

    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return safeErrorResponse(error, req)
  }
}

export const POST = withObservability('/api/ai-settings/test', testConnection)
