import 'server-only'
import { bizDateString } from '@/lib/dates'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { detectLedgerCapability, type LedgerCapability } from '@/lib/dashboard/compatibility'

export const ACCOUNTING_MIGRATION_MESSAGE = 'Not available until accounting migration'

export type AccountingAvailability = LedgerCapability | {
  path: 'legacy-local'
  reason: 'supabase-not-configured'
}

/**
 * Production must never fall through to the local Prisma/SQLite accounting
 * store merely because the UUID ledger is absent. Local development without
 * Supabase keeps its intentional legacy path.
 */
export async function getAccountingAvailability(
  businessId: string,
): Promise<AccountingAvailability> {
  if (!isSupabaseConfigured()) {
    return process.env.VERCEL
      ? { path: 'operational-fallback', reason: 'missing-table' }
      : { path: 'legacy-local', reason: 'supabase-not-configured' }
  }
  return detectLedgerCapability(
    getAdminSupabase() as any,
    businessId,
    bizDateString(new Date()),
  )
}

export function unavailableAccountingPayload<T extends Record<string, unknown>>(
  payload: T,
  reason: string,
) {
  return {
    ...payload,
    availability: {
      accounting: false,
      reason,
      message: ACCOUNTING_MIGRATION_MESSAGE,
    },
  }
}
