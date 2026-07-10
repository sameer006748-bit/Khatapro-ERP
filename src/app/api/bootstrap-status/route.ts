/**
 * Public route: reports whether first-owner bootstrap is still open.
 * The login page uses this to decide whether to render a "Register as
 * first owner" link.
 */
import { NextResponse } from 'next/server'
import { noOwnerExists } from '@/lib/auth/permissions'

export async function GET() {
  const open = await noOwnerExists()
  return NextResponse.json({ bootstrapOpen: open })
}
