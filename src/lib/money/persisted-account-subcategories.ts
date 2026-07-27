import 'server-only'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolveSupabaseUuid } from '@/lib/accounting/voucher-supabase'

export type PersistedSubcategory = {
  id: string
  parentCode: string
  name: string
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
  })
  if (error) throw new Error(`manage_account_subcategory: ${error.message}`)
  return data as { ok: boolean; action: string; subcategoryId: string | null }
}
