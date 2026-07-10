/**
 * Browser-side Supabase client.
 *
 * Uses ONLY the publishable (anon) key. RLS policies are enforced for
 * every query made through this client — this is the whole point of the
 * Supabase permission model. The service-role key is NEVER imported here.
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function env(name: string): string {
  const v = process.env[name]
  if (!v || v.startsWith('<')) {
    throw new Error(
      `Missing env var ${name}. Copy .env.local.example to .env.local and fill in real values.`,
    )
  }
  return v
}

let _client: SupabaseClient | null = null

export function getBrowserSupabase(): SupabaseClient {
  if (_client) return _client
  _client = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  return _client
}

/** True if Supabase env vars are configured. Used by the app to decide
 *  whether to use Supabase or fall back to the Prisma/SQLite local preview. */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  return !!url && !!key && !url.startsWith('<') && !key.startsWith('<')
}
