/**
 * Server-side Supabase ADMIN client.
 *
 * Uses the SERVICE-ROLE key. This bypasses RLS and must NEVER be imported
 * into a client component ('use client'). The 'server-only' import below
 * causes a build error if this module is ever bundled for the browser.
 */
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, isSupabaseConfigured } from './config'

export function createAdminClient() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local',
    )
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/** Returns null when Supabase isn't configured (instead of throwing). */
export function getAdminClient() {
  if (!isSupabaseConfigured()) return null
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
