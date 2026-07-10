/**
 * GET /api/supabase-status
 *
 * Reports whether Supabase env vars are configured, whether the project is
 * reachable, AND whether the Phase 1 + Phase 2 migrations have been applied.
 *
 * NEVER returns keys — only booleans, the project URL, and table-existence flags.
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
      authReachable: false,
      adminCanQuery: false,
      phase1Applied: false,
      phase2Applied: false,
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

  // If admin is also configured, check table existence to determine which
  // migrations have been applied. NEVER print the key.
  let adminCanQuery = false
  let phase1Applied = false
  let phase2Applied = false

  if (adminConfigured) {
    try {
      const admin = getAdminSupabase()

      // Check Phase 1: permissions table exists and has rows.
      // Use a real select (not head) so PostgREST returns an error when the
      // table doesn't exist in the schema cache.
      const { data: permData, error: permErr } = await admin
        .from('permissions')
        .select('id')
        .limit(1)
      adminCanQuery = !permErr
      phase1Applied = adminCanQuery && Array.isArray(permData) && permData.length > 0

      // Check Phase 2: vouchers table exists.
      if (phase1Applied) {
        const { data: vData, error: vErr } = await admin
          .from('vouchers')
          .select('id')
          .limit(1)
        phase2Applied = !vErr && Array.isArray(vData)
      }
    } catch {
      adminCanQuery = false
    }
  }

  let message: string
  if (adminCanQuery && phase1Applied && phase2Applied) {
    message = 'Supabase fully live — Phase 1 + Phase 2 migrations applied. RLS enforced for browser queries; service-role used server-side only.'
  } else if (adminCanQuery && phase1Applied && !phase2Applied) {
    message = 'Supabase connected, Phase 1 applied, but Phase 2 migration NOT applied yet. Run supabase/migrations/00002_phase2_accounting.sql in SQL Editor.'
  } else if (adminCanQuery && !phase1Applied) {
    message = 'Supabase connected but migrations NOT applied. Run supabase/migrations/00001_phase1_foundation.sql then 00002_phase2_accounting.sql in SQL Editor.'
  } else if (reachable) {
    message = 'Supabase reachable but admin key not configured or tables not queryable.'
  } else {
    message = 'Supabase URL set but project not reachable.'
  }

  return NextResponse.json({
    configured: true,
    browserConfigured: true,
    adminConfigured,
    url,
    reachable,
    authReachable,
    adminCanQuery,
    phase1Applied,
    phase2Applied,
    message,
  })
}
