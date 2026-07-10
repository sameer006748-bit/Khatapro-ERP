/**
 * Server-only Supabase admin client.
 *
 * Uses the SERVICE-ROLE key which BYPASSES RLS. This is the equivalent of
 * the Supabase "SECURITY DEFINER" execution context — only ever used for:
 *   - First-owner bootstrap (before any session exists)
 *   - Server-side RPC calls that need to write through post_voucher()
 *   - Maintenance / migration scripts
 *
 * It is NEVER imported by client components. The `import 'server-only'`
 * directive below makes any client-side import a build error.
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function env(name: string): string {
  const v = process.env[name]
  if (!v || v.startsWith('<')) {
    throw new Error(
      `Missing server env var ${name}. This key must live in .env.local (never committed).`,
    )
  }
  return v
}

let _admin: SupabaseClient | null = null

export function getAdminSupabase(): SupabaseClient {
  if (_admin) return _admin
  _admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  return _admin
}

/** True if the service-role key is configured (server-side only). */
export function isAdminConfigured(): boolean {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY
  return !!k && !k.startsWith('<')
}
