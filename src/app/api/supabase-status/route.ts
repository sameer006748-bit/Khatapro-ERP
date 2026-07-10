/**
 * Supabase connection status — reports whether Supabase env vars are set
 * and (if configured) whether the admin client can reach the project.
 *
 * Used by the Phase 2 "Supabase checkpoint" verification gate.
 *
 * SECURITY: this route NEVER returns keys, URLs with keys, or any
 * credential material. It only returns boolean flags + table counts.
 */
import { NextResponse } from 'next/server'
import { isSupabaseConfigured, SUPABASE_URL } from '@/lib/supabase/config'
import { getAdminClient } from '@/lib/supabase/server-admin'

export async function GET() {
  const configured = isSupabaseConfigured()
  if (!configured) {
    return NextResponse.json({
      configured: false,
      url: SUPABASE_URL || null,
      message:
        'Supabase env vars not set. Add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY to .env.local, then run `bun run scripts/apply-supabase-migrations.ts`.',
      usingFallback: 'Prisma/SQLite (local preview)',
    })
  }

  // Configured — try to reach the project and count key tables.
  const admin = getAdminClient()
  if (!admin) {
    return NextResponse.json({ configured: false, error: 'ADMIN_CLIENT_NULL' }, { status: 500 })
  }

  try {
    const [biz, cats, accts, roles, perms, vouchers] = await Promise.all([
      admin.from('business').select('id', { count: 'exact', head: true }),
      admin.from('account_categories').select('id', { count: 'exact', head: true }),
      admin.from('accounts').select('id', { count: 'exact', head: true }),
      admin.from('roles').select('id', { count: 'exact', head: true }),
      admin.from('permissions').select('id', { count: 'exact', head: true }),
      admin.from('vouchers').select('id', { count: 'exact', head: true }).then((r) => r).catch(() => ({ count: null, error: 'vouchers table not found' })),
    ])

    return NextResponse.json({
      configured: true,
      url: SUPABASE_URL,
      reachable: true,
      counts: {
        business: biz.count ?? 0,
        account_categories: cats.count ?? 0,
        accounts: accts.count ?? 0,
        roles: roles.count ?? 0,
        permissions: perms.count ?? 0,
        vouchers: (vouchers as any).count ?? 0,
      },
      usingFallback: 'Supabase Postgres',
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      {
        configured: true,
        url: SUPABASE_URL,
        reachable: false,
        error: msg.slice(0, 200),
        message: 'Supabase env vars are set but the project could not be reached. Check the URL and keys.',
      },
      { status: 502 },
    )
  }
}
