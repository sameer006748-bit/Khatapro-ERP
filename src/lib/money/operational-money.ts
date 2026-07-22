import 'server-only'

import { getAdminSupabase } from '@/lib/supabase/admin'

export type OperationalMoneyAccount = {
  id: string
  key: 'cash' | 'bank' | 'wallet'
  name: string
  balancePaisas: string
  isActive: boolean
}

export type OperationalMoneyActivity = {
  id: string
  kind: 'contra' | 'capital' | 'drawings'
  date: string
  amountPaisas: string
  reference: string
  note: string | null
  sourceName: string | null
  destinationName: string | null
  equityDeltaPaisas: string
}

type MutationInput = {
  businessId: string
  actorProfileId: string
  amountPaisas: bigint
  date: string
  note?: string | null
  idempotencyKey: string
}

export async function listOperationalMoney(input: { businessId: string; actorProfileId: string }) {
  const admin = getAdminSupabase()
  const [accountsResult, activityResult] = await Promise.all([
    admin.rpc('list_business_money_accounts', {
      p_business_id: input.businessId,
      p_actor_profile_id: input.actorProfileId,
    }),
    admin.rpc('list_business_money_activity', {
      p_business_id: input.businessId,
      p_actor_profile_id: input.actorProfileId,
    }),
  ])
  if (accountsResult.error) throw new Error(`list_business_money_accounts: ${accountsResult.error.message}`)
  if (activityResult.error) throw new Error(`list_business_money_activity: ${activityResult.error.message}`)

  const accounts: OperationalMoneyAccount[] = (accountsResult.data ?? []).map((row: any) => ({
    id: row.id,
    key: row.account_key,
    name: row.name,
    balancePaisas: String(row.balance_paisas ?? '0'),
    isActive: Boolean(row.is_active),
  }))
  const activity: OperationalMoneyActivity[] = (activityResult.data ?? []).map((row: any) => ({
    id: row.id,
    kind: row.transaction_kind,
    date: row.transaction_date,
    amountPaisas: String(row.amount_paisas ?? '0'),
    reference: row.reference,
    note: row.note ?? null,
    sourceName: row.source_name ?? null,
    destinationName: row.destination_name ?? null,
    equityDeltaPaisas: String(row.equity_delta_paisas ?? '0'),
  }))
  return { accounts, activity }
}

export async function postOperationalContra(input: MutationInput & { sourceAccountId: string; destinationAccountId: string }) {
  const { data, error } = await getAdminSupabase().rpc('post_contra_transfer', {
    p_business_id: input.businessId,
    p_source_account_id: input.sourceAccountId,
    p_destination_account_id: input.destinationAccountId,
    p_amount: input.amountPaisas.toString(),
    p_date: input.date,
    p_note: input.note ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_actor_profile_id: input.actorProfileId,
  })
  if (error) throw new Error(`post_contra_transfer: ${error.message}`)
  return data as { transaction_id: string; reference: string; amount_paisas: string; idempotent: boolean }
}

export async function postOwnerCapital(input: MutationInput & { destinationAccountId: string }) {
  const { data, error } = await getAdminSupabase().rpc('post_owner_capital', {
    p_business_id: input.businessId,
    p_destination_account_id: input.destinationAccountId,
    p_amount: input.amountPaisas.toString(),
    p_date: input.date,
    p_note: input.note ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_actor_profile_id: input.actorProfileId,
  })
  if (error) throw new Error(`post_owner_capital: ${error.message}`)
  return data as { transaction_id: string; reference: string; amount_paisas: string; idempotent: boolean }
}

export async function postOwnerDrawings(input: MutationInput & { sourceAccountId: string }) {
  const { data, error } = await getAdminSupabase().rpc('post_owner_drawings', {
    p_business_id: input.businessId,
    p_source_account_id: input.sourceAccountId,
    p_amount: input.amountPaisas.toString(),
    p_date: input.date,
    p_note: input.note ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_actor_profile_id: input.actorProfileId,
  })
  if (error) throw new Error(`post_owner_drawings: ${error.message}`)
  return data as { transaction_id: string; reference: string; amount_paisas: string; idempotent: boolean }
}
