import 'server-only'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolveSupabaseUuid } from '@/lib/accounting/voucher-supabase'

export type PersistedSubcategory = {
  id: string
  parentCode: string
  name: string
  /** Readable code word (e.g. `EXP-COMM`); null until migration 00034 backfill. */
  code: string | null
  reportClass: 'Income' | 'Expense' | 'Asset' | 'Liability' | 'Equity'
  isActive: boolean
  archivedAt: string | null
}

export type AccountSubcategoryAssignment = {
  accountId: string
  parentCode: string
  subcategoryId: string | null
}

export async function listPersistedAccountSubcategories(businessId: string, actorId: string) {
  const admin = getAdminSupabase()
  const profileId = await resolveSupabaseUuid(actorId)
  if (!profileId) throw new Error('Server-attributed category actor is unavailable')
  const { data, error } = await admin.rpc('list_account_subcategories', {
    p_business_id: businessId,
    p_actor_id: profileId,
  })
  if (error) throw new Error(`list_account_subcategories: ${error.message}`)
  return data as {
    categories: PersistedSubcategory[]
    assignments: AccountSubcategoryAssignment[]
  }
}

export async function managePersistedAccountSubcategory(input: {
  businessId: string
  actorId: string
  action: 'create' | 'rename' | 'archive' | 'assign' | 'move' | 'uncategorize'
  parentCode?: string | null
  subcategoryId?: string | null
  name?: string | null
  accountId?: string | null
  /** Readable code word; passed as p_code only when provided so the RPC call
   * stays compatible with databases where migration 00034 is not applied yet. */
  code?: string | null
}) {
  const admin = getAdminSupabase()
  const profileId = await resolveSupabaseUuid(input.actorId)
  if (!profileId) throw new Error('Server-attributed category actor is unavailable')
  const { data, error } = await admin.rpc('manage_account_subcategory', {
    p_business_id: input.businessId,
    p_actor_id: profileId,
    p_action: input.action,
    p_parent_code: input.parentCode ?? null,
    p_subcategory_id: input.subcategoryId ?? null,
    p_name: input.name ?? null,
    p_account_id: input.accountId ?? null,
    ...(input.code ? { p_code: input.code } : {}),
  })
  if (error) {
    if (isMissingCodeWordSignature(error)) {
      throw new CodeWordSchemaRequiredError()
    }
    throw new Error(`manage_account_subcategory: ${error.message}`)
  }
  return data as { ok: boolean; action: string; subcategoryId: string | null }
}

/** True when the deployed manage_account_subcategory signature predates the
 * optional p_code parameter (migration 00034 absent). */
function isMissingCodeWordSignature(error: { message: string; code?: string }): boolean {
  return error.code === 'PGRST202'
    || /p_code/i.test(error.message)
    || /Could not find the function/i.test(error.message)
    || /function .* does not exist/i.test(error.message)
}

/** Raised when the readable code-word schema (migration 00034) is absent —
 * callers must degrade gracefully instead of surfacing a 500. */
export class CodeWordSchemaRequiredError extends Error {
  constructor() {
    super('Readable code words are not available until migration 00034 is applied')
    this.name = 'CodeWordSchemaRequiredError'
  }
}
