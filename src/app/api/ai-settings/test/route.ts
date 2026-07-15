import { NextRequest, NextResponse } from 'next/server'
import { writeAudit } from '@/lib/auth/permissions'
import { testAiConnection } from '@/lib/ai/ai-settings-store'
import {
  AiSettingsAuthError,
  requireAiSettingsOwner,
  requireSameOrigin,
} from '@/lib/ai/ai-settings-auth'

const PROVIDER = 'gemini'

function safeErrorResponse(error: unknown) {
  if (error instanceof AiSettingsAuthError) {
    return NextResponse.json(
      { error: error.code },
      {
        status: error.status,
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  }

  return NextResponse.json(
    { error: 'INTERNAL_ERROR' },
    {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req)

    const session = await requireAiSettingsOwner(req)
    const result = await testAiConnection(
      session.businessId,
      PROVIDER,
      session.userId,
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
    return safeErrorResponse(error)
  }
}
