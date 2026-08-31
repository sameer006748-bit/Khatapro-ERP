/**
 * Smart data-access helpers that switch between Supabase and Prisma based on
 * whether Supabase env vars are configured.
 *
 * Canonical setup data (ledger_accounts and ledger_account_categories) lives in
 * whichever database is active. When Supabase is live, we read from Supabase
 * tables via the admin client; otherwise we fall back to Prisma/SQLite.
 *
 * This keeps the API routes' business logic the same — they just call these
 * helpers instead of `db.account.findMany(...)` directly.
 */
import 'server-only'
import { db } from '@/lib/db'
import { usesLegacyTransactionSchema } from '@/lib/identity/legacy-bridge'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { probeTable } from '@/lib/supabase/phase-probe'

/**
 * True when Supabase env vars are set AND the production UUID ledger exists.
 */
const _phase1Cache = { lastChecked: 0, lastResult: false }

async function isSupabaseLive(): Promise<boolean> {
  // Delegate to the shared fail-closed probe. When Supabase is configured but
  // the probe fails (transient outage / cold start), probeTable THROWS rather
  // than returning false — this prevents falling through to Prisma/SQLite,
  // which is unavailable on serverless and crashes accounting reads. It also
  // re-probes on a 30s TTL instead of permanently caching a transient failure.
  return probeTable(_phase1Cache, 'ledger_accounts')
}

export type AccountRow = {
  id: string
  code: string
  name: string
  categoryId: string
  isActive: boolean
  isBusinessAccount: boolean
  isPartyAccount: boolean
  partyType: string | null
  balanceCache: bigint
  category: { id: string; code: string; name: string; type: string }
}

export type CategoryWithAccounts = {
  id: string
  code: string
  name: string
  type: string
  accounts: AccountRow[]
}

/** Get the default business ID for the current setup (single-business MVP). */
export function getDefaultBusinessId(): string {
  return 'biz-default'
}

/** List all account categories with their accounts for a business. */
export async function getChartOfAccounts(businessId: string): Promise<CategoryWithAccounts[]> {
  if (isSupabaseConfigured() && await usesLegacyTransactionSchema()) {
    return getChartOfAccountsFromLegacySupabase(businessId)
  }
  if (await isSupabaseLive()) {
    return getChartOfAccountsFromSupabase(businessId)
  }
  return getChartOfAccountsFromPrisma(businessId)
}

async function getChartOfAccountsFromLegacySupabase(businessId: string): Promise<CategoryWithAccounts[]> {
  const admin = getAdminSupabase()
  const [{ data: cats, error: categoryError }, { data: accts, error: accountError }] = await Promise.all([
    admin
      .from('account_categories')
      .select('id, code, name, type')
      .eq('business_id', businessId)
      .order('code'),
    admin
      .from('accounts')
      .select('id, code, name, category_id, is_active, is_business_account, is_party_account, party_type, balance_cache')
      .eq('business_id', businessId)
      .order('code'),
  ])
  if (categoryError) throw new Error(`Chart of accounts categories failed: ${categoryError.message}`)
  if (accountError) throw new Error(`Chart of accounts failed: ${accountError.message}`)

  return (cats ?? []).map((category) => ({
    id: category.id,
    code: category.code,
    name: category.name,
    type: category.type,
    accounts: (accts ?? [])
      .filter((account) => account.category_id === category.id)
      .map((account) => ({
        id: account.id,
        code: account.code,
        name: account.name,
        categoryId: account.category_id,
        isActive: account.is_active,
        isBusinessAccount: account.is_business_account,
        isPartyAccount: account.is_party_account,
        partyType: account.party_type,
        balanceCache: BigInt(account.balance_cache ?? 0),
        category: { id: category.id, code: category.code, name: category.name, type: category.type },
      })),
  }))
}

async function getChartOfAccountsFromPrisma(businessId: string): Promise<CategoryWithAccounts[]> {
  const cats = await db.accountCategory.findMany({
    where: { businessId },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      accounts: {
        select: {
          id: true,
          code: true,
          name: true,
          categoryId: true,
          isActive: true,
          isBusinessAccount: true,
          isPartyAccount: true,
          partyType: true,
          balanceCache: true,
        },
        orderBy: { code: 'asc' },
      },
    },
    orderBy: { code: 'asc' },
  })
  return cats.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    type: c.type,
    accounts: c.accounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      categoryId: a.categoryId,
      isActive: a.isActive,
      isBusinessAccount: a.isBusinessAccount,
      isPartyAccount: a.isPartyAccount,
      partyType: a.partyType,
      balanceCache: a.balanceCache,
      category: { id: c.id, code: c.code, name: c.name, type: c.type },
    })),
  }))
}

async function getChartOfAccountsFromSupabase(businessId: string): Promise<CategoryWithAccounts[]> {
  const admin = getAdminSupabase()
  const { data: cats, error } = await admin
    .from('ledger_account_categories')
    .select('id, stable_code, display_name, report_class')
    .eq('business_id', businessId)
    .order('stable_code')
  if (error) throw new Error(`Supabase CoA query failed: ${error.message}`)
  if (!cats) return []

  const { data: accts, error: e2 } = await admin
    .from('ledger_accounts')
    .select('id, account_code, account_name, category_id, is_active, operational_money_key, party_type')
    .eq('business_id', businessId)
    .order('account_code')
  if (e2) throw new Error(`Supabase accounts query failed: ${e2.message}`)
  if (!accts) return []
  const { data: balances, error: balanceError } = await admin.rpc('ledger_account_balances', {
    p_business_id: businessId,
    p_as_of_date: null,
  })
  if (balanceError) throw new Error(`Supabase ledger balances failed: ${balanceError.message}`)
  const balanceByAccount = new Map<string, bigint>(
    (balances ?? []).map((row: any) => [row.account_id, BigInt(row.balance_paisas ?? 0)]),
  )

  return cats.map((c) => ({
    id: c.id,
    code: c.stable_code,
    name: c.display_name,
    type: c.report_class,
    accounts: accts
      .filter((a) => a.category_id === c.id)
      .map((a) => ({
        id: a.id,
        code: a.account_code,
        name: a.account_name,
        categoryId: a.category_id,
        isActive: a.is_active,
        isBusinessAccount: a.operational_money_key !== null,
        isPartyAccount: a.party_type !== null,
        partyType: a.party_type,
        balanceCache: balanceByAccount.get(a.id) ?? 0n,
        category: { id: c.id, code: c.stable_code, name: c.display_name, type: c.report_class },
      })),
  }))
}

/** Find a single account by ID. */
export async function getAccountById(businessId: string, accountId: string): Promise<AccountRow | null> {
  if (isSupabaseConfigured() && await usesLegacyTransactionSchema()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('accounts')
      .select('id, code, name, category_id, is_active, is_business_account, is_party_account, party_type, balance_cache')
      .eq('id', accountId)
      .eq('business_id', businessId)
      .maybeSingle()
    if (error || !data) return null
    const { data: category, error: categoryError } = await admin
      .from('account_categories')
      .select('id, code, name, type')
      .eq('id', data.category_id)
      .eq('business_id', businessId)
      .maybeSingle()
    if (categoryError || !category) return null
    return {
      id: data.id,
      code: data.code,
      name: data.name,
      categoryId: data.category_id,
      isActive: data.is_active,
      isBusinessAccount: data.is_business_account,
      isPartyAccount: data.is_party_account,
      partyType: data.party_type,
      balanceCache: BigInt(data.balance_cache ?? 0),
      category: { id: category.id, code: category.code, name: category.name, type: category.type },
    }
  }
  if (await isSupabaseLive()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('ledger_accounts')
      .select('id, account_code, account_name, category_id, is_active, operational_money_key, party_type')
      .eq('id', accountId)
      .eq('business_id', businessId)
      .maybeSingle()
    if (error || !data) return null
    // Fetch category separately
    const { data: cat } = await admin
      .from('ledger_account_categories')
      .select('id, stable_code, display_name, report_class')
      .eq('id', data.category_id)
      .eq('business_id', businessId)
      .maybeSingle()
    if (!cat) return null
    const { data: balancePaisas, error: balanceError } = await admin.rpc('ledger_account_balance_paisas', {
      p_business_id: businessId,
      p_account_id: accountId,
      p_as_of_date: null,
    })
    if (balanceError) throw new Error(`Supabase account balance query failed: ${balanceError.message}`)
    return {
      id: data.id,
      code: data.account_code,
      name: data.account_name,
      categoryId: data.category_id,
      isActive: data.is_active,
      isBusinessAccount: data.operational_money_key !== null,
      isPartyAccount: data.party_type !== null,
      partyType: data.party_type,
      balanceCache: BigInt(balancePaisas ?? 0),
      category: { id: cat.id, code: cat.stable_code, name: cat.display_name, type: cat.report_class },
    }
  }
  const a = await db.account.findFirst({
    where: { id: accountId, businessId },
    include: { category: true },
  })
  if (!a) return null
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    categoryId: a.categoryId,
    isActive: a.isActive,
    isBusinessAccount: a.isBusinessAccount,
    isPartyAccount: a.isPartyAccount,
    partyType: a.partyType,
    balanceCache: a.balanceCache,
    category: { id: a.category.id, code: a.category.code, name: a.category.name, type: a.category.type },
  }
}

/** Find an account by business + code. */
export async function getAccountByCode(businessId: string, code: string): Promise<AccountRow | null> {
  if (await isSupabaseLive()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('ledger_accounts')
      .select('id, account_code')
      .eq('business_id', businessId)
      .eq('account_code', code)
      .maybeSingle()
    if (error || !data) return null
    return getAccountById(businessId, data.id)
  }
  const a = await db.account.findFirst({
    where: { businessId, code },
    include: { category: true },
  })
  if (!a) return null
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    categoryId: a.categoryId,
    isActive: a.isActive,
    isBusinessAccount: a.isBusinessAccount,
    isPartyAccount: a.isPartyAccount,
    partyType: a.partyType,
    balanceCache: a.balanceCache,
    category: { id: a.category.id, code: a.category.code, name: a.category.name, type: a.category.type },
  }
}

/** Validate that all given account IDs belong to the business and are active. */
export async function validateAccounts(businessId: string, accountIds: string[]): Promise<boolean> {
  const unique = Array.from(new Set(accountIds))
  if (await isSupabaseLive()) {
    const admin = getAdminSupabase()
    const { count, error } = await admin
      .from('ledger_accounts')
      .select('id', { count: 'exact', head: true })
      .in('id', unique)
      .eq('business_id', businessId)
      .eq('is_active', true)
    if (error) return false
    return count === unique.length
  }
  const accounts = await db.account.findMany({
    where: { id: { in: unique }, businessId, isActive: true },
    select: { id: true },
  })
  return accounts.length === unique.length
}

/** True when Supabase is the active data store (env vars set + Phase 1 applied). */
export async function isUsingSupabase(): Promise<boolean> {
  return isSupabaseLive()
}
