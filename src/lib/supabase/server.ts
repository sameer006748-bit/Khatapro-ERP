/**
 * Server-side Supabase client bound to the current user's session.
 *
 * This client runs WITH RLS — it uses the publishable key + the user's
 * access token, so every query is scoped to the user's permissions.
 * Used by API routes that need RLS-aware reads/writes.
 *
 * NEVER use this client for operations that must bypass RLS (bootstrap,
 * post_voucher RPC). Use getAdminSupabase() for those — and only when
 * the API route has already authenticated the user and checked perms.
 */
import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function getServerSupabase(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key || url.startsWith('<') || key.startsWith('<')) {
    throw new Error('Supabase env vars not configured.')
  }
  const store = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return store.getAll()
      },
      setAll(toSet) {
        toSet.forEach(({ name, value, options }) => store.set(name, value, options))
      },
    },
  })
}
