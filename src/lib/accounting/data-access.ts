/**
 * Smart data-access helpers that switch between Supabase and Prisma based on
 * whether Supabase env vars are configured.
 *
 * Phase 1 setup data (accounts, categories, business accounts) lives in
 * whichever database is active. When Supabase is live, we read from Supabase
 * tables via the admin client; otherwise we fall back to Prisma/SQLite.
 *
 * This keeps the API routes' business logic the same — they just call these
 * helpers instead of `db.account.findMany(...)` directly.
 */
import 'server-only'
import { db } from '@/lib/db'
import { getAdminSupabase } from '@/lib/supabase/admin'

/**
 * True when Supabase env vars are set AND Phase 1 migration is applied
 * (so the accounts table exists). Cached after first check.
 */
let _phase1Checked = false
let _phase1Applied = false

async function isSupabaseLive(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !pub || !svc) return false
  if (url.includes('<') || pub.includes('<') || svc.includes('<')) return false

  if (_phase1Checked) return _phase1Applied
  _phase1Checked = true
  try {
    const admin = getAdminSupabase()
    // Use a real select (not head) so PostgREST returns an error when the
    // table doesn't exist. head:true with count can return null count without
    // an error when the table is missing from the schema cache.
    const { data, error } = await admin
      .from('permissions')
      .select('id')
      .limit(1)
    // Table exists if no error AND we got an array (even if empty).
    _phase1Applied = !error && Array.isArray(data)
  } catch {
    _phase1Applied = false
  }
  return _phase1Applied
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
  if (await isSupabaseLive()) {
    return getChartOfAccountsFromSupabase(businessId)
  }
  return getChartOfAccountsFromPrisma(businessId)
}

async function getChartOfAccountsFromPrisma(businessId: string): Promise<CategoryWithAccounts[]> {
  const cats = await db.accountCategory.findMany({
    where: { businessId },
    include: { accounts: { orderBy: { code: 'asc' } } },
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
    .from('account_categories')
    .select('id, code, name, type')
    .eq('business_id', businessId)
    .order('code')
  if (error) throw new Error(`Supabase CoA query failed: ${error.message}`)
  if (!cats) return []

  const { data: accts, error: e2 } = await admin
    .from('accounts')
    .select('id, code, name, category_id, is_active, is_business_account, is_party_account, party_type, balance_cache')
    .eq('business_id', businessId)
    .order('code')
  if (e2) throw new Error(`Supabase accounts query failed: ${e2.message}`)
  if (!accts) return []

  return cats.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    type: c.type,
    accounts: accts
      .filter((a) => a.category_id === c.id)
      .map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        categoryId: a.category_id,
        isActive: a.is_active,
        isBusinessAccount: a.is_business_account,
        isPartyAccount: a.is_party_account,
        partyType: a.party_type,
        balanceCache: BigInt(a.balance_cache ?? 0),
        category: { id: c.id, code: c.code, name: c.name, type: c.type },
      })),
  }))
}

/** Find a single account by ID. */
export async function getAccountById(businessId: string, accountId: string): Promise<AccountRow | null> {
  if (await isSupabaseLive()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('accounts')
      .select('id, code, name, category_id, is_active, is_business_account, is_party_account, party_type, balance_cache')
      .eq('id', accountId)
      .eq('business_id', businessId)
      .maybeSingle()
    if (error || !data) return null
    // Fetch category separately
    const { data: cat } = await admin
      .from('account_categories')
      .select('id, code, name, type')
      .eq('id', data.category_id)
      .maybeSingle()
    if (!cat) return null
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
      category: { id: cat.id, code: cat.code, name: cat.name, type: cat.type },
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
      .from('accounts')
      .select('id, code, name, category_id, is_active, is_business_account, is_party_account, party_type, balance_cache')
      .eq('business_id', businessId)
      .eq('code', code)
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
      .from('accounts')
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
