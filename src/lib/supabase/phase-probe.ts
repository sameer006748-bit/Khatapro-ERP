/**
 * Shared fail-closed phase-probe helper.
 *
 * When Supabase env vars are present the probe MUST NOT return `false`
 * and silently let the caller fall through to Prisma/SQLite.  A probe
 * failure (transient outage, schema missing, permission error) must
 * throw a generic server-side error instead.
 *
 * The caller is ONLY allowed to use Prisma when `isSupabaseConfigured()`
 * returns false — i.e. env vars are genuinely absent.
 */
import 'server-only'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { getAdminSupabase } from '@/lib/supabase/admin'

const PROBE_TTL_MS = 30_000

type ProbeCache = { lastChecked: number; lastResult: boolean }

export async function probeTable(
  cache: ProbeCache,
  table: string,
): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    // Safe: no Supabase config → Prisma fallback is expected.
    return false
  }

  const now = Date.now()
  if (cache.lastChecked > 0 && (now - cache.lastChecked) < PROBE_TTL_MS) {
    // Cached result: true = Supabase is live; false = the last probe
    // failed, which means Supabase is configured but UNREACHABLE —
    // must throw, never return false to avoid Prisma fallback.
    if (!cache.lastResult) {
      throw new Error('Database service unavailable. Please try again.')
    }
    return true
  }

  cache.lastChecked = now
  try {
    const admin = getAdminSupabase()
    const { data, error } = await admin.from(table).select('id').limit(1)
    cache.lastResult = !error && Array.isArray(data)
  } catch {
    cache.lastResult = false
  }

  if (!cache.lastResult) {
    throw new Error('Database service unavailable. Please try again.')
  }
  return true
}