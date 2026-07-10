/**
 * GET /api/supabase-status
 *
 * Reports whether Supabase env vars are configured and (if so) whether the
 * live Supabase project responds. Used by the UI to show a "connected to
 * Supabase" badge and by the Phase 2 gate to confirm safe connection.
 *
 * NEVER returns keys — only booleans and the project URL.
 */
import { NextResponse } from 'next/server'
import { isSupabaseConfigured } from '@/lib/supabase/browser'
import { isAdminConfigured, getAdminSupabase } from '@/lib/supabase/admin'

export async function GET() {
  const browserConfigured = isSupabaseConfigured()
  const adminConfigured = isAdminConfigured()

  if (!browserConfigured) {
    return NextResponse.json({
      configured: false,
      browserConfigured: false,
      adminConfigured: false,
      url: null,
      reachable: false,
      message: 'Supabase env vars not set. App is running on Prisma/SQLite local preview. Copy .env.local.example to .env.local and fill in real values.',
    })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!

  // Light reachability check — hits the public health endpoint.
  let reachable = false
  let authReachable = false
  try {
    const r = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
    })
    authReachable = r.ok
    reachable = authReachable
  } catch {
    reachable = false
  }

  // If admin is also configured, try to count rows in a known table to
  // confirm the service role works. NEVER print the key.
  let adminCanQuery = false
  if (adminConfigured) {
    try {
      const admin = getAdminSupabase()
      const { count, error } = await admin
        .from('permissions')
        .select('*', { count: 'exact', head: true })
      adminCanQuery = !error && count !== null
    } catch {
      adminCanQuery = false
    }
  }

  return NextResponse.json({
    configured: true,
    browserConfigured: true,
    adminConfigured,
    url,
    reachable,
    authReachable,
    adminCanQuery,
    message: adminCanQuery
      ? 'Supabase connected (browser + admin). RLS enforced for browser queries.'
      : reachable
      ? 'Supabase reachable but admin key not configured or migrations not applied yet.'
      : 'Supabase URL set but project not reachable.',
  })
}
