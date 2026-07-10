/**
 * Server-side Supabase USER client — carries the caller's JWT from cookies
 * so RLS policies enforce access control based on the authenticated user.
 *
 * Used for operations where we WANT RLS to apply (e.g. user reading their
 * own profile). For admin operations (bootstrap, migration, cross-user
 * queries), use createAdminClient() from server-admin.ts instead.
 */
import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, isSupabaseConfigured } from './config'

export async function createUserClient() {
  if (!isSupabaseConfigured()) return null
  const cookieStore = await cookies()
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Called from a Server Component — set is not possible. The
          // middleware will refresh the session.
        }
      },
    },
  })
}
