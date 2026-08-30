import 'server-only'

import { getAdminSupabase } from '@/lib/supabase/admin'
import { classifyPostgrestCompatibilityError, type PostgrestLikeError } from '@/lib/dashboard/compatibility'

export const BUSINESS_ACCOUNTS_UNAVAILABLE_MESSAGE = 'This feature is currently unavailable.'

export class LegacyBusinessAccountsUnavailableError extends Error {
  readonly code = 'FEATURE_UNAVAILABLE'

  constructor() {
    super(BUSINESS_ACCOUNTS_UNAVAILABLE_MESSAGE)
    this.name = 'LegacyBusinessAccountsUnavailableError'
  }
}

export type BusinessAccountRecord = {
  id: string
  accountId: string
  name: string
  type: string
  accountHolder: string | null
  bankName: string | null
  accountNumber: string | null
  isActive: boolean
  createdAt: string
  accountCode: string
  categoryName: string
  categoryType: string
  balancePaisas: string
}

type LegacyRow = {
  id: string
  account_id: string
  name: string
  type: string
  account_holder: string | null
  bank_name: string | null
  account_number: string | null
  is_active: boolean
  created_at: string
  account_code: string
  category_name: string
  category_type: string
  balance_paisas: string | number
}

function unavailable(error: PostgrestLikeError | null): never {
  if (classifyPostgrestCompatibilityError(error) === 'missing-rpc') {
    throw new LegacyBusinessAccountsUnavailableError()
  }
  throw new Error(`Business accounts request failed: ${error?.message ?? 'database request failed'}`)
}

function mapRow(row: LegacyRow): BusinessAccountRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    type: row.type,
    accountHolder: row.account_holder ?? null,
    bankName: row.bank_name ?? null,
    accountNumber: row.account_number ?? null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    accountCode: row.account_code,
    categoryName: row.category_name,
    categoryType: row.category_type,
    balancePaisas: String(row.balance_paisas ?? '0'),
  }
}

export async function listLegacyBusinessAccounts(businessId: string, actorProfileId: string) {
  const { data, error } = await getAdminSupabase().rpc('list_business_accounts', {
    p_business_id: businessId,
    p_actor_profile_id: actorProfileId,
  })
  if (error) unavailable(error)
  return ((data ?? []) as LegacyRow[]).map(mapRow)
}

export async function createLegacyBusinessAccount(input: {
  businessId: string
  actorProfileId: string
  idempotencyKey: string
  name: string
  type: string
  accountHolder?: string | null
  bankName?: string | null
  accountNumber?: string | null
}) {
  const { data, error } = await getAdminSupabase().rpc('create_business_account', {
    p_business_id: input.businessId,
    p_name: input.name,
    p_type: input.type,
    p_account_holder: input.accountHolder ?? null,
    p_bank_name: input.bankName ?? null,
    p_account_number: input.accountNumber ?? null,
    p_actor_profile_id: input.actorProfileId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (error) unavailable(error)
  return mapRow(data as LegacyRow)
}

export async function updateLegacyBusinessAccount(input: {
  businessId: string
  businessAccountId: string
  actorProfileId: string
  patch: {
    name?: string
    type?: string
    accountHolder?: string | null
    bankName?: string | null
    accountNumber?: string | null
    isActive?: boolean
  }
}) {
  const p = input.patch
  const { data, error } = await getAdminSupabase().rpc('update_business_account', {
    p_business_id: input.businessId,
    p_business_account_id: input.businessAccountId,
    p_name: p.name ?? null,
    p_type: p.type ?? null,
    p_account_holder: p.accountHolder ?? null,
    p_bank_name: p.bankName ?? null,
    p_account_number: p.accountNumber ?? null,
    p_is_active: p.isActive ?? false,
    p_update_name: p.name !== undefined,
    p_update_type: p.type !== undefined,
    p_update_account_holder: p.accountHolder !== undefined,
    p_update_bank_name: p.bankName !== undefined,
    p_update_account_number: p.accountNumber !== undefined,
    p_update_is_active: p.isActive !== undefined,
    p_actor_profile_id: input.actorProfileId,
  })
  if (error) unavailable(error)
  return mapRow(data as LegacyRow)
}

export async function deleteLegacyBusinessAccount(input: {
  businessId: string
  businessAccountId: string
  actorProfileId: string
}) {
  const { data, error } = await getAdminSupabase().rpc('delete_business_account', {
    p_business_id: input.businessId,
    p_business_account_id: input.businessAccountId,
    p_actor_profile_id: input.actorProfileId,
  })
  if (error) unavailable(error)
  return data as {
    deleted: boolean
    deleted_id?: string
    error?: 'ACCOUNT_IN_USE'
    references?: { paymentAllocations: number; voucherLines: number; purchasePayments: number }
  }
}