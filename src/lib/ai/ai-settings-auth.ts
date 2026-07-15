/**
 * AI settings auth helpers.
 *
 * Standardizes error codes, same-origin checks, and Owner/Admin enforcement
 * for all AI settings API routes.
 */
import { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { loadSessionUser } from '@/lib/auth/permissions'

export class AiSettingsAuthError extends Error {
  status: number
  code: string
  constructor(code: string, status: number, message?: string) {
    super(message ?? code)
    this.status = status
    this.code = code
  }
}

function getOrigin(req: NextRequest): string | null {
  return req.headers.get('origin')
}

function getHost(req: NextRequest): string | null {
  return req.headers.get('host')
}

export function requireSameOrigin(req: NextRequest): void {
  const allowed = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const origin = getOrigin(req)
  const host = getHost(req)
  const allowedOrigin = new URL(allowed).origin

  if (origin && origin !== allowedOrigin) {
    throw new AiSettingsAuthError('CROSS_ORIGIN_DENIED', 403)
  }
}

export async function requireAiSettingsOwner(req: NextRequest) {
  const token = await getToken({ req: req as any })
  if (!token?.userId) {
    throw new AiSettingsAuthError('UNAUTHORIZED', 401, 'Missing session')
  }

  const session = await loadSessionUser(token.userId as string)
  if (!session) {
    throw new AiSettingsAuthError('UNAUTHORIZED', 401, 'Invalid session')
  }

  if (session.roleName !== 'Owner/Admin') {
    throw new AiSettingsAuthError('FORBIDDEN', 403, 'Owner/Admin only')
  }

  return session
}