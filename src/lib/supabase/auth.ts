/**
 * Server-only Supabase client for password-based authentication.
 *
 * This is a NON-admin client that uses the publishable/anonymous key
 * for signInWithPassword. It must never use the service-role key.
 *
 * Session persistence and token refresh are disabled — this is a
 * short-lived client used only to verify credentials and fetch the
 * user's profile. The resulting session data is stored in NextAuth JWT,
 * never in a Supabase session.
 */

import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, isSupabaseConfigured } from './config'

export function createAuthClient() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured.')
  }
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}

export function getAuthClient() {
  if (!isSupabaseConfigured()) return null
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}