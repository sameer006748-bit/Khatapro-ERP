/**
 * Browser-side Supabase client.
 *
 * Uses ONLY the publishable (anon) key. Never imports the service-role key.
 * RLS policies on the server enforce all access control — the browser
 * client can only do what RLS allows.
 */
import { createBrowserClient } from '@supabase/ssr'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, isSupabaseConfigured } from './config'

export function createClient() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local',
    )
  }
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
}

/** Safe getter that returns null instead of throwing when Supabase isn't configured. */
export function getBrowserClient() {
  if (!isSupabaseConfigured()) return null
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
}
