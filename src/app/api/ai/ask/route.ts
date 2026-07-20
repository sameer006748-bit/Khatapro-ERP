import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser } from '@/lib/auth/permissions'
import { requireSameOrigin } from '@/lib/ai/ai-settings-auth'
import { getAiApiKey } from '@/lib/ai/ai-settings-store'
import { AI_LIMITS, AI_PROVIDER } from '@/lib/ai/config'
import { buildAiContext } from '@/lib/ai/ai-context'
import { generateGeminiAnswer, GeminiClientError } from '@/lib/ai/gemini-client'
import { consumeAiRequest } from '@/lib/ai/rate-limit'
import {
  AI_LANGUAGES,
  AI_MODES,
  AI_SCREENS,
  canUseAiForScreen,
  sanitizeFieldMetadata,
  validatePrompt,
} from '@/lib/ai/safety-core'
import { resolveRequestId, safeApiError, withObservability } from '@/lib/observability'

const requestSchema = z.object({
  prompt: z.string().trim().min(2).max(AI_LIMITS.promptCharacters),
  language: z.enum(AI_LANGUAGES).default('roman-urdu'),
  mode: z.enum(AI_MODES).default('ask'),
  screen: z.enum(AI_SCREENS).default('home'),
  field: z.unknown().optional(),
}).strict()

function response(error: string, message: string, status: number, requestId: string) {
  return NextResponse.json(
    { error, message, requestId },
    { status, headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } },
  )
}

async function post(req: NextRequest) {
  const requestId = resolveRequestId(req)
  try {
    requireSameOrigin(req)
  } catch {
    return response('CROSS_ORIGIN_DENIED', 'This AI request was blocked.', 403, requestId)
  }

  const authSession = await getServerSession(authOptions)
  if (!authSession?.user) return response('UNAUTHORIZED', 'Please sign in again.', 401, requestId)
  const session = await loadSessionUser((authSession.user as any).id)
  if (!session) return response('UNAUTHORIZED', 'Please sign in again.', 401, requestId)

  const body = await req.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return response('VALIDATION_ERROR', 'Please enter a shorter valid question.', 400, requestId)

  const field = parsed.data.mode === 'field-help' ? sanitizeFieldMetadata(parsed.data.field) : null
  if (parsed.data.mode === 'field-help' && (!field || field.currentScreen !== parsed.data.screen)) {
    return response('FIELD_CONTEXT_INVALID', 'Field help context is invalid.', 400, requestId)
  }

  if (!canUseAiForScreen(session, parsed.data.screen)) {
    return response('FORBIDDEN', 'AI help is not available for this screen and role.', 403, requestId)
  }

  const validation = validatePrompt(parsed.data.prompt, AI_LIMITS.promptCharacters)
  if (validation === 'too_long') return response('PROMPT_TOO_LONG', 'Please shorten your question.', 400, requestId)
  if (validation === 'write_request') return response('READ_ONLY_REQUEST', 'KhataPro AI is read-only and cannot post or change ERP records.', 400, requestId)
  if (validation === 'secret_or_injection') return response('UNSAFE_REQUEST', 'KhataPro AI cannot reveal secrets or bypass safety rules.', 400, requestId)
  if (!consumeAiRequest(session.userId)) return response('RATE_LIMITED', 'Too many AI requests. Please wait one minute.', 429, requestId)

  const apiKey = await getAiApiKey(session.businessId, AI_PROVIDER)
  if (!apiKey) return response('AI_NOT_CONFIGURED', 'Gemini is not configured. Ask an Owner/Admin to connect it.', 409, requestId)

  try {
    const context = await buildAiContext({
      session,
      screen: parsed.data.screen,
      mode: parsed.data.mode,
      prompt: parsed.data.prompt,
      field,
    })
    const answer = await generateGeminiAnswer({
      apiKey,
      language: parsed.data.language,
      prompt: parsed.data.prompt,
      context,
    })

    return NextResponse.json(
      { answer, language: parsed.data.language, readOnly: true },
      { headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } },
    )
  } catch (error) {
    if (error instanceof GeminiClientError) {
      if (error.code === 'invalid_key') return response('AI_INVALID_KEY', 'The Gemini key is invalid. An Owner/Admin should test or replace it.', 502, requestId)
      if (error.code === 'timeout') return response('AI_TIMEOUT', 'Gemini took too long. Please retry once.', 504, requestId)
      return response('AI_CONNECTION_ERROR', 'Gemini is temporarily unavailable. Please retry once.', 502, requestId)
    }
    return safeApiError({
      route: '/api/ai/ask',
      requestId,
      errorCode: 'AI_REQUEST_FAILED',
      userMessage: 'AI help could not be generated.',
      error,
      method: 'POST',
    })
  }
}

export const POST = withObservability('/api/ai/ask', post)
