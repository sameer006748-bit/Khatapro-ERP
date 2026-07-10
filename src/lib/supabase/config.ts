/**
 * Supabase configuration detection.
 *
 * Reads env vars that MUST be set in `.env.local` (never committed):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  (browser-safe)
 *   SUPABASE_SERVICE_ROLE_KEY             (server-only, NEVER exposed to browser)
 *
 * `isSupabaseConfigured()` returns true only when ALL three are present.
 * The data layer uses this to decide whether to route to Supabase or
 * fall back to the local Prisma/SQLite preview.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export function isSupabaseConfigured(): boolean {
  return (
    SUPABASE_URL.length > 0 &&
    SUPABASE_PUBLISHABLE_KEY.length > 0 &&
    SUPABASE_SERVICE_ROLE_KEY.length > 0 &&
    SUPABASE_URL.startsWith('https://') &&
    !SUPABASE_SERVICE_ROLE_KEY.includes('your-') &&
    !SUPABASE_PUBLISHABLE_KEY.includes('your-')
  )
}
