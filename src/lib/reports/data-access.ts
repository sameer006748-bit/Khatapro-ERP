/**
 * Phase 8 Reports data-access — all report RPC calls.
 */
import 'server-only'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { bizDateString } from '@/lib/dates'
export async function reportProfitLoss(businessId: string, fromDate: string, toDate: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('report_profit_loss', { p_business_id: businessId, p_from_date: fromDate, p_to_date: toDate })
  if (error) throw new Error(`report_profit_loss: ${error.message}`)
  const rows = data as any[]

  // App-side filter: only Income and Expense accounts belong in P&L.
  // If migration 00008i has been applied, the RPC already filters this in SQL.
  // If not, we filter here to remove Asset/Liability/Equity rows that appear
  // with amount=0 due to the old HAVING clause inconsistency.
  return rows.filter(r => r.category_type === 'Income' || r.category_type === 'Expense')
}

export async function reportBalanceSheet(businessId: string, asOfDate: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('report_balance_sheet', { p_business_id: businessId, p_as_of_date: asOfDate })
  if (error) throw new Error(`report_balance_sheet: ${error.message}`)
  const rows = data as any[]

  // App-side Current Earnings fallback.
  // If migration 00008i has been applied, the RPC already returns a row with
  // is_calculated=true (account_code '3031'). If not, we compute it here from
  // Income and Expense voucher_lines so the Balance Sheet balances.
  const hasCalculatedRow = rows.some(r => r.is_calculated === true)
  if (!hasCalculatedRow) {
    // Compute cumulative Income - Expense up to asOfDate
    const { data: incData, error: incErr } = await admin.rpc('report_profit_loss', {
      p_business_id: businessId,
      p_from_date: '1900-01-01',
      p_to_date: asOfDate,
    })
    if (incErr) throw new Error(`current_earnings fallback: ${incErr.message}`)
    let income = 0n
    let expense = 0n
    for (const r of incData as any[]) {
      const amt = BigInt(r.amount ?? 0)
      if (r.section === 'REVENUE') income += amt
      else if (r.section === 'EXPENSE') expense += amt
    }
    const currentEarnings = income - expense
    rows.push({
      section: 'EQUITY',
      account_code: '3031',
      account_name: 'Current Earnings',
      category_type: 'Equity',
      balance: currentEarnings.toString(),
      is_calculated: true,
    })
  }

  // App-side date-filter fallback (migration 00008j pending).
  // The RPC's permanent BS accounts query has a LEFT JOIN date filter bug:
  // voucher_lines from after p_as_of_date are still summed. We detect this
  // by comparing the RPC's asset total to a correct client-side computation.
  // If they differ, we replace the permanent balances with correct values.
  const rpcAssets = rows.filter(r => r.section === 'ASSET')
  const rpcAssetTotal = rpcAssets.reduce((s, r) => s + BigInt(r.balance ?? 0), 0n)

  // Correct computation: sum voucher_lines joined to vouchers with date filter
  const { data: correctBalances, error: balErr } = await admin
    .from('voucher_lines')
    .select('account_id,debit,credit,accounts!inner(id,code,name,category_id,is_active,business_id),vouchers!inner(voucher_date,is_cancelled,business_id)')
    .eq('accounts.business_id', businessId)
    .eq('accounts.is_active', true)
    .eq('vouchers.business_id', businessId)
    .eq('vouchers.is_cancelled', false)
    .lte('vouchers.voucher_date', asOfDate)
  if (balErr) throw new Error(`balance_sheet date-filter fallback: ${balErr.message}`)

  // Aggregate correct balances per account
  const correctByAccount = new Map<string, { code: string; name: string; category_type: string; balance: bigint }>()
  for (const vl of correctBalances as any[]) {
    const acct = vl.accounts
    if (!acct) continue
    // Look up category type — accounts relation doesn't include category type directly,
    // so we'll fetch it separately below. For now, store what we have.
    const existing = correctByAccount.get(acct.id) || { code: acct.code, name: acct.name, category_type: '', balance: 0n }
    existing.balance += BigInt(vl.debit ?? 0) - BigInt(vl.credit ?? 0)
    correctByAccount.set(acct.id, existing)
  }

  // Fetch category types for these accounts
  if (correctByAccount.size > 0) {
    const accountIds = Array.from(correctByAccount.keys())
    const { data: accts } = await admin
      .from('accounts')
      .select('id,account_categories!inner(type)')
      .in('id', accountIds)
    for (const a of accts as any[]) {
      const entry = correctByAccount.get(a.id)
      if (entry) entry.category_type = a.account_categories?.type || ''
    }
  }

  // Compute correct asset total
  let correctAssetTotal = 0n
  for (const [, entry] of correctByAccount) {
    if (entry.category_type === 'Asset') {
      // Asset balance = debit - credit (normal positive)
      correctAssetTotal += entry.balance
    }
  }

  // If RPC asset total differs from correct total, the date filter bug exists.
  // Replace permanent BS rows with correct values.
  if (rpcAssetTotal !== correctAssetTotal) {
    // Remove old permanent BS rows (keep Current Earnings)
    const ceRow = rows.find(r => r.is_calculated === true)
    rows.length = 0
    if (ceRow) rows.push(ceRow)

    // Add correct permanent BS rows
    for (const [accountId, entry] of correctByAccount) {
      if (entry.balance === 0n) continue
      let section = ''
      let displayBalance = entry.balance
      if (entry.category_type === 'Asset') {
        section = 'ASSET'
        displayBalance = entry.balance // debit - credit (positive = normal)
      } else if (entry.category_type === 'Liability') {
        section = 'LIABILITY'
        displayBalance = -entry.balance // credit - debit (positive = normal)
      } else if (entry.category_type === 'Equity') {
        section = 'EQUITY'
        displayBalance = -entry.balance // credit - debit (positive = normal)
      } else {
        continue // Skip Income/Expense
      }
      rows.push({
        section,
        account_id: accountId,
        account_code: entry.code,
        account_name: entry.name,
        category_type: entry.category_type,
        balance: displayBalance.toString(),
        is_calculated: false,
      })
    }
  }

  // Filter to BS accounts only (in case RPC returned non-BS rows)
  return rows.filter(r => ['ASSET', 'LIABILITY', 'EQUITY'].includes(r.section))
}

export async function reportSalesSummary(businessId: string, fromDate: string, toDate: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('report_sales_summary', { p_business_id: businessId, p_from_date: fromDate, p_to_date: toDate })
  if (error) throw new Error(`report_sales_summary: ${error.message}`)
  return data as any[]
}

export async function reportInventoryValuation(businessId: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('report_inventory_valuation', { p_business_id: businessId })
  if (error) throw new Error(`report_inventory_valuation: ${error.message}`)
  return data as any[]
}

export async function reportCashFlow(businessId: string, fromDate: string, toDate: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('report_cash_flow', { p_business_id: businessId, p_from_date: fromDate, p_to_date: toDate })
  if (error) throw new Error(`report_cash_flow: ${error.message}`)
  return data as any[]
}

export async function reportExpenseSummary(businessId: string, fromDate: string, toDate: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('report_expense_summary', { p_business_id: businessId, p_from_date: fromDate, p_to_date: toDate })
  if (error) throw new Error(`report_expense_summary: ${error.message}`)
  return data as any[]
}

export async function reportCustomerOutstanding(businessId: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('report_customer_outstanding', { p_business_id: businessId })
  if (error) throw new Error(`report_customer_outstanding: ${error.message}`)
  return data as any[]
}

export async function reportVendorOutstanding(businessId: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('report_vendor_outstanding', { p_business_id: businessId })
  if (error) throw new Error(`report_vendor_outstanding: ${error.message}`)
  return data as any[]
}

// Sales detail from invoices table
export async function reportSalesDetail(businessId: string, fromDate: string, toDate: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.from('invoices')
    .select('id, invoice_no, invoice_type, invoice_date, customer_name, customer_phone, subtotal, total, paid_amount, is_returned, is_cancelled, salesmen(name), delivery_orders(total_cod_amount, customer_delivery_charge, rider_earning_amount, company_delivery_income)')
    .eq('business_id', businessId).eq('is_cancelled', false)
    .gte('invoice_date', fromDate).lte('invoice_date', toDate)
    .order('invoice_date', { ascending: false }).limit(500)
  if (error) throw new Error(`reportSalesDetail: ${error.message}`)
  return data as any[]
}

// Purchase detail
export async function reportPurchaseDetail(businessId: string, fromDate: string, toDate: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.from('purchases')
    .select('id, purchase_no, vendor_id, supplier_bill_no, purchase_date, subtotal, total, paid_amount, status, vendors(name)')
    .eq('business_id', businessId)
    .gte('purchase_date', fromDate).lte('purchase_date', toDate)
    .order('purchase_date', { ascending: false }).limit(500)
  if (error) throw new Error(`reportPurchaseDetail: ${error.message}`)
  return data as any[]
}

// Stock movements
export async function reportStockMovements(businessId: string, fromDate: string, toDate: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.from('stock_movements')
    .select('id, movement_type, quantity, balance_after, unit_cost_paisas, reason, movement_date, products(name)')
    .eq('business_id', businessId)
    .gte('movement_date', fromDate).lte('movement_date', toDate)
    .order('movement_date', { ascending: false }).limit(500)
  if (error) throw new Error(`reportStockMovements: ${error.message}`)
  return data as any[]
}

// Delivery summary
export async function reportDeliverySummary(businessId: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.from('delivery_orders')
    .select('id, status, total_cod_amount, cod_collected_amount, rider_earning_amount, company_delivery_income, riders(name)')
    .eq('business_id', businessId).order('created_at', { ascending: false }).limit(500)
  if (error) throw new Error(`reportDeliverySummary: ${error.message}`)
  return data as any[]
}

// COD settlements
export async function reportCodSettlements(businessId: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.from('rider_cod_submissions')
    .select('id, submission_no, rider_id, submitted_date, requested_amount, confirmed_cash_amount, rider_fee_deduction, settlement_mode, status, riders(name)')
    .eq('business_id', businessId).order('created_at', { ascending: false }).limit(200)
  if (error) throw new Error(`reportCodSettlements: ${error.message}`)
  return data as any[]
}

// ─────────────────────────────────────────────────────────────
// Phase 8 completion: Product Profitability report
// ─────────────────────────────────────────────────────────────
export type ProductProfitabilityRow = {
  product_id: string | null
  product_name: string
  sku: string
  quantity_sold: number
  returned_quantity: number
  net_quantity_sold: number
  net_product_sales: string   // paisas (string for BigInt-safe JSON)
  cogs: string                // paisas
  gross_profit: string        // paisas
  gross_margin_pct: number
  current_wac: string         // paisas
  current_stock: number
  inventory_value: string     // paisas
  cost_status: 'Final' | 'Historical cost unavailable' | 'Estimated' | 'Missing' | 'Negative-stock adjusted'
}

export async function reportProductProfitability(
  businessId: string,
  fromDate: string,
  toDate: string,
): Promise<ProductProfitabilityRow[]> {
  const admin = getAdminSupabase()

  // Fetch invoice_items joined with invoices for the period.
  // We do this client-side because Supabase's nested-select returns rows
  // shaped as objects; we then aggregate in JS.
  const { data: items, error } = await admin
    .from('invoice_items')
    .select(`
      id,
      product_id,
      product_name,
      qty,
      unit_price,
      line_total,
      unit_cost_paisas,
      is_temporary,
      invoices!inner (
        id,
        invoice_date,
        is_cancelled,
        is_returned
      )
    `)
    .eq('business_id', businessId)
    .eq('invoices.is_cancelled', false)
    .gte('invoices.invoice_date', fromDate)
    .lte('invoices.invoice_date', toDate)
  if (error) throw new Error(`reportProductProfitability: ${error.message}`)

  // Group by product_id (NULL → one bucket for temporary/missing)
  type Agg = {
    productId: string | null
    productName: string
    quantitySold: number
    returnedQuantity: number
    netSalesPaisas: bigint
    cogsPaisas: bigint
    costItems: number   // items with unit_cost_paisas > 0
    noCostItems: number // items with unit_cost_paisas = 0 (or NULL)
  }
  const buckets = new Map<string, Agg>()
  const keyFor = (pid: string | null, name: string) => pid ?? `__tmp__:${name}`

  for (const it of items ?? []) {
    const inv = (it as any).invoices
    if (!inv) continue
    const isReturned = !!inv.is_returned
    const qty = Number(it.qty ?? 0)
    const unitPrice = BigInt(it.unit_price ?? 0)
    const unitCost = BigInt(it.unit_cost_paisas ?? 0)
    const key = keyFor(it.product_id ?? null, it.product_name ?? '')
    let b = buckets.get(key)
    if (!b) {
      b = {
        productId: it.product_id ?? null,
        productName: it.product_name ?? '(unknown)',
        quantitySold: 0,
        returnedQuantity: 0,
        netSalesPaisas: 0n,
        cogsPaisas: 0n,
        costItems: 0,
        noCostItems: 0,
      }
      buckets.set(key, b)
    }
    if (!isReturned) {
      b.quantitySold += qty
      b.netSalesPaisas += unitPrice * BigInt(qty)
      b.cogsPaisas += unitCost * BigInt(qty)
    } else {
      b.returnedQuantity += qty
      b.netSalesPaisas -= unitPrice * BigInt(qty)
      b.cogsPaisas -= unitCost * BigInt(qty)
    }
    if (it.product_id) {
      if (unitCost > 0n) b.costItems += 1
      else b.noCostItems += 1
    }
  }

  // Fetch products rows (for current WAC + current stock).
  const productIds = Array.from(buckets.values()).map(b => b.productId).filter(Boolean) as string[]
  const productMap = new Map<string, { wac: bigint; stock: number }>()
  if (productIds.length > 0) {
    const { data: prods } = await admin
      .from('products')
      .select('id, weighted_average_cost, current_stock')
      .in('id', productIds)
    for (const p of prods ?? []) {
      productMap.set(p.id, {
        wac: BigInt(p.weighted_average_cost ?? 0),
        stock: Number(p.current_stock ?? 0),
      })
    }
  }

  // Negative-stock check: stock_movements.balance_after < 0 for these products in the period.
  const negativeStockProductIds = new Set<string>()
  if (productIds.length > 0) {
    const { data: negMov } = await admin
      .from('stock_movements')
      .select('product_id')
      .in('product_id', productIds)
      .eq('business_id', businessId)
      .gte('movement_date', fromDate)
      .lte('movement_date', toDate)
      .lt('balance_after', 0)
    for (const m of negMov ?? []) {
      if (m.product_id) negativeStockProductIds.add(m.product_id)
    }
  }

  const rows: ProductProfitabilityRow[] = []
  for (const b of buckets.values()) {
    const netQty = b.quantitySold - b.returnedQuantity
    const grossProfit = b.netSalesPaisas - b.cogsPaisas
    const marginPct = b.netSalesPaisas > 0n
      ? Number((grossProfit * 10000n) / b.netSalesPaisas) / 100
      : 0
    const prod = b.productId ? productMap.get(b.productId) : undefined
    const wac = prod?.wac ?? 0n
    const stock = prod?.stock ?? 0
    const invValue = stock > 0 ? wac * BigInt(stock) : 0n

    let costStatus: ProductProfitabilityRow['cost_status']
    if (!b.productId) {
      costStatus = 'Missing'
    } else if (negativeStockProductIds.has(b.productId)) {
      costStatus = 'Negative-stock adjusted'
    } else if (b.costItems > 0 && b.noCostItems === 0) {
      costStatus = 'Final'
    } else if (b.costItems === 0 && b.noCostItems > 0) {
      costStatus = 'Historical cost unavailable'
    } else if (b.costItems > 0 && b.noCostItems > 0) {
      costStatus = 'Estimated'
    } else {
      costStatus = 'Historical cost unavailable'
    }

    rows.push({
      product_id: b.productId,
      product_name: b.productName,
      sku: b.productId ? b.productId.slice(0, 8).toUpperCase() : 'TMP',
      quantity_sold: b.quantitySold,
      returned_quantity: b.returnedQuantity,
      net_quantity_sold: netQty,
      net_product_sales: b.netSalesPaisas.toString(),
      cogs: b.cogsPaisas.toString(),
      gross_profit: grossProfit.toString(),
      gross_margin_pct: marginPct,
      current_wac: wac.toString(),
      current_stock: stock,
      inventory_value: invValue.toString(),
      cost_status: costStatus,
    })
  }

  // Sort by gross profit descending
  rows.sort((a, b) => Number(BigInt(b.gross_profit) - BigInt(a.gross_profit)))
  return rows
}

// ─────────────────────────────────────────────────────────────
// Phase 8 completion: Trial Balance (uses existing RPC)
// ─────────────────────────────────────────────────────────────
export async function reportTrialBalance(businessId: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('trial_balance', {
    p_business_id: businessId,
    p_from_date: null,
    p_to_date: null,
  })
  if (error) throw new Error(`trial_balance: ${error.message}`)
  return (data ?? []) as any[]
}

// ─────────────────────────────────────────────────────────────
// Phase 8 completion: Exceptions report
// ─────────────────────────────────────────────────────────────
export type ExceptionRow = {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  issue: string
  reference: string
  amount: string | null
  date: string | null
  drill_down: string | null
  recommended_action: string
}

function bigAbsSum(rows: any[], field: string): bigint {
  let sum = 0n
  for (const r of rows) {
    try {
      sum += BigInt(r[field] ?? 0)
    } catch {
      // ignore
    }
  }
  return sum < 0n ? -sum : sum
}
void bigAbsSum  // reserved for future severity-sorted aggregation

async function getAccountBalanceByCode(
  businessId: string,
  code: string,
  asOfDate?: string,
): Promise<bigint> {
  const admin = getAdminSupabase()
  // Get the account id first
  const { data: acct, error: acctErr } = await admin
    .from('accounts')
    .select('id, category_id')
    .eq('business_id', businessId)
    .eq('code', code)
    .maybeSingle()
  if (acctErr || !acct) return 0n

  // Sum voucher_lines for non-cancelled vouchers
  let query = admin
    .from('voucher_lines')
    .select('debit, credit, voucher_id, vouchers!inner(is_cancelled, voucher_date)')
    .eq('account_id', acct.id)
    .eq('vouchers.is_cancelled', false)
  if (asOfDate) {
    query = query.lte('vouchers.voucher_date', asOfDate)
  }
  const { data, error } = await query
  if (error || !data) return 0n

  let debit = 0n
  let credit = 0n
  for (const l of data as any[]) {
    debit += BigInt(l.debit ?? 0)
    credit += BigInt(l.credit ?? 0)
  }
  return debit - credit
}

export async function reportExceptions(businessId: string): Promise<ExceptionRow[]> {
  const admin = getAdminSupabase()
  const out: ExceptionRow[] = []
  const today = bizDateString(new Date())

  // 1. Trial Balance difference (CRITICAL)
  try {
    const { data: tb } = await admin.rpc('trial_balance', {
      p_business_id: businessId,
      p_from_date: null,
      p_to_date: null,
    })
    if (tb && Array.isArray(tb)) {
      let totalDebit = 0n
      let totalCredit = 0n
      for (const r of tb as any[]) {
        totalDebit += BigInt(r.total_debit ?? 0)
        totalCredit += BigInt(r.total_credit ?? 0)
      }
      const diff = totalDebit - totalCredit
      if (diff !== 0n) {
        out.push({
          severity: 'CRITICAL',
          issue: 'Trial Balance out of balance',
          reference: 'TB',
          amount: diff.toString(),
          date: today,
          drill_down: '/?ledger=TB',
          recommended_action: 'Investigate voucher lines; a posting may be missing one side.',
        })
      }
    }
  } catch {
    // ignore
  }

  // 2. Balance Sheet difference (CRITICAL)
  try {
    const { data: bs } = await admin.rpc('report_balance_sheet', {
      p_business_id: businessId,
      p_as_of_date: today,
    })
    if (bs && Array.isArray(bs)) {
      let assets = 0n
      let liaEq = 0n
      for (const r of bs as any[]) {
        const bal = BigInt(r.balance ?? 0)
        if (r.section === 'ASSET') assets += bal
        else liaEq += bal
      }
      const diff = assets - liaEq
      if (diff !== 0n) {
        out.push({
          severity: 'CRITICAL',
          issue: 'Balance Sheet out of balance (Assets ≠ Liabilities + Equity)',
          reference: 'BS',
          amount: diff.toString(),
          date: today,
          drill_down: null,
          recommended_action: 'Check recent vouchers for unbalanced entries.',
        })
      }
    }
  } catch {
    // ignore
  }

  // 3. Inventory GL difference (HIGH)
  try {
    const { data: prods } = await admin
      .from('products')
      .select('id, name, current_stock, weighted_average_cost')
      .eq('business_id', businessId)
      .eq('is_active', true)
    let stockValue = 0n
    if (prods) {
      for (const p of prods) {
        const stock = Number(p.current_stock ?? 0)
        if (stock > 0) {
          stockValue += BigInt(p.weighted_average_cost ?? 0) * BigInt(stock)
        }
      }
    }
    const gl1100 = await getAccountBalanceByCode(businessId, '1100')
    const diff = stockValue - gl1100
    if (diff !== 0n) {
      out.push({
        severity: 'HIGH',
        issue: 'Inventory GL balance differs from sum of stock × WAC',
        reference: '1100 Inventory',
        amount: diff.toString(),
        date: today,
        drill_down: '/?ledger=1100',
        recommended_action: 'Reconcile stock movements against Inventory GL entries.',
      })
    }
  } catch {
    // ignore
  }

  // 4. Customer difference (HIGH)
  try {
    const { data: inv } = await admin
      .from('invoices')
      .select('total, paid_amount')
      .eq('business_id', businessId)
      .eq('is_cancelled', false)
      .eq('is_returned', false)
    let outstanding = 0n
    if (inv) {
      for (const i of inv) {
        outstanding += BigInt(i.total ?? 0) - BigInt(i.paid_amount ?? 0)
      }
    }
    const gl1200 = await getAccountBalanceByCode(businessId, '1200')
    const diff = outstanding - gl1200
    if (diff !== 0n) {
      out.push({
        severity: 'HIGH',
        issue: 'Customer AR GL balance differs from sum of outstanding invoices',
        reference: '1200 Customers Receivable',
        amount: diff.toString(),
        date: today,
        drill_down: '/?ledger=1200',
        recommended_action: 'Check AR debit/credit postings and payment allocations.',
      })
    }
  } catch {
    // ignore
  }

  // 5. Vendor difference (HIGH)
  try {
    const { data: pur } = await admin
      .from('purchases')
      .select('total, paid_amount')
      .eq('business_id', businessId)
      .eq('is_returned', false)
    let outstanding = 0n
    if (pur) {
      for (const p of pur) {
        outstanding += BigInt(p.total ?? 0) - BigInt(p.paid_amount ?? 0)
      }
    }
    const gl2010 = await getAccountBalanceByCode(businessId, '2010')
    // Vendors Payable is credit-normal, so GL balance stored as credit-debit;
    // getAccountBalanceByCode returns debit-credit, so payable = -balance.
    const diff = outstanding + gl2010
    if (diff !== 0n) {
      out.push({
        severity: 'HIGH',
        issue: 'Vendor AP GL balance differs from sum of outstanding purchases',
        reference: '2010 Vendors Payable',
        amount: diff.toString(),
        date: today,
        drill_down: '/?ledger=2010',
        recommended_action: 'Check AP postings and vendor payment allocations.',
      })
    }
  } catch {
    // ignore
  }

  // 6. Rider COD difference (HIGH)
  try {
    const { data: orders } = await admin
      .from('delivery_orders')
      .select('total_cod_amount, cod_collected_amount, status')
      .eq('business_id', businessId)
      .neq('status', 'returned')
    let codPending = 0n
    if (orders) {
      for (const o of orders) {
        codPending += BigInt(o.total_cod_amount ?? 0) - BigInt(o.cod_collected_amount ?? 0)
      }
    }
    const gl1310 = await getAccountBalanceByCode(businessId, '1310')
    const diff = codPending - gl1310
    if (diff !== 0n) {
      out.push({
        severity: 'HIGH',
        issue: 'Rider COD Receivable GL differs from sum of unsubmitted COD',
        reference: '1310 Rider COD Receivable',
        amount: diff.toString(),
        date: today,
        drill_down: '/?ledger=1310',
        recommended_action: 'Check COD submission confirmations and delivery postings.',
      })
    }
  } catch {
    // ignore
  }

  // 7. Rider Payable difference (HIGH)
  try {
    const { data: orders } = await admin
      .from('delivery_orders')
      .select('rider_earning_amount, status')
      .eq('business_id', businessId)
      .eq('status', 'delivered')
    let earned = 0n
    if (orders) {
      for (const o of orders) earned += BigInt(o.rider_earning_amount ?? 0)
    }
    // Confirmed net-COD submissions deduct rider_fee_deduction from rider payable.
    const { data: subs } = await admin
      .from('rider_cod_submissions')
      .select('rider_fee_deduction, settlement_mode, status')
      .eq('business_id', businessId)
      .eq('status', 'confirmed')
      .eq('settlement_mode', 'net')
    let deducted = 0n
    if (subs) {
      for (const s of subs) deducted += BigInt(s.rider_fee_deduction ?? 0)
    }
    const payable = earned - deducted
    const gl2020 = await getAccountBalanceByCode(businessId, '2020')
    const diff = payable + gl2020
    if (diff !== 0n) {
      out.push({
        severity: 'HIGH',
        issue: 'Rider Payable GL differs from earned minus deducted commissions',
        reference: '2020 Rider Payable',
        amount: diff.toString(),
        date: today,
        drill_down: '/?ledger=2020',
        recommended_action: 'Check rider earning accruals and COD net-settlement deductions.',
      })
    }
  } catch {
    // ignore
  }

  // 8. Negative Cash/Bank (MEDIUM)
  try {
    const { data: accts } = await admin
      .from('accounts')
      .select('id, code, name, category_id, account_categories!inner(code, type)')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .eq('account_categories.code', 'ASSET')
    if (accts) {
      for (const a of accts as any[]) {
        const bal = await getAccountBalanceByCode(businessId, a.code)
        if (bal < 0n) {
          out.push({
            severity: 'MEDIUM',
            issue: `Negative balance in asset account`,
            reference: `${a.code} ${a.name}`,
            amount: bal.toString(),
            date: today,
            drill_down: `/?ledger=${a.id}`,
            recommended_action: 'Review debits/credits — an over-payment or wrong posting may have occurred.',
          })
        }
      }
    }
  } catch {
    // ignore
  }

  // 9. Negative stock (HIGH)
  try {
    const { data: negProds } = await admin
      .from('products')
      .select('id, name, current_stock')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .lt('current_stock', 0)
    if (negProds) {
      for (const p of negProds) {
        out.push({
          severity: 'HIGH',
          issue: `Negative stock: ${p.name}`,
          reference: p.id.slice(0, 8).toUpperCase(),
          amount: String(p.current_stock),
          date: today,
          drill_down: null,
          recommended_action: 'Stock adjustment or purchase is needed to bring stock back to ≥0.',
        })
      }
    }
  } catch {
    // ignore
  }

  // 10. Zero-cost sale post-migration (MEDIUM)
  try {
    const { data: zeroCost } = await admin
      .from('invoice_items')
      .select('id, product_id, product_name, unit_cost_paisas, is_temporary, invoices!inner(invoice_date, is_cancelled)')
      .eq('business_id', businessId)
      .eq('is_temporary', false)
      .not('product_id', 'is', null)
      .gte('invoices.invoice_date', '2026-07-11')
      .eq('invoices.is_cancelled', false)
      .or('unit_cost_paisas.eq.0,unit_cost_paisas.is.null')
      .limit(50)
    if (zeroCost) {
      for (const it of zeroCost as any[]) {
        out.push({
          severity: 'MEDIUM',
          issue: `Zero-cost sale (no sale-time WAC captured)`,
          reference: `${it.product_name}`,
          amount: null,
          date: it.invoices?.invoice_date ?? today,
          drill_down: null,
          recommended_action: 'Reconcile cost; this should not happen post-migration.',
        })
      }
    }
  } catch {
    // ignore
  }

  // 11. Missing sale-time cost — NULL unit_cost_paisas (MEDIUM)
  try {
    const { data: nullCost } = await admin
      .from('invoice_items')
      .select('id, product_id, product_name, unit_cost_paisas, invoices!inner(invoice_date, is_cancelled)')
      .eq('business_id', businessId)
      .gte('invoices.invoice_date', '2026-07-11')
      .eq('invoices.is_cancelled', false)
      .is('unit_cost_paisas', null)
      .limit(50)
    if (nullCost) {
      for (const it of nullCost as any[]) {
        out.push({
          severity: 'MEDIUM',
          issue: `Missing sale-time cost (unit_cost_paisas IS NULL)`,
          reference: `${it.product_name}`,
          amount: null,
          date: it.invoices?.invoice_date ?? today,
          drill_down: null,
          recommended_action: 'Backfill unit_cost_paisas with WAC at time of sale.',
        })
      }
    }
  } catch {
    // ignore
  }

  // 12. Missing WAC (MEDIUM)
  try {
    const { data: missingWac } = await admin
      .from('products')
      .select('id, name, current_stock, weighted_average_cost')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .gt('current_stock', 0)
      .or('weighted_average_cost.is.null,weighted_average_cost.eq.0')
      .limit(50)
    if (missingWac) {
      for (const p of missingWac) {
        out.push({
          severity: 'MEDIUM',
          issue: `Missing WAC for in-stock product`,
          reference: `${p.name}`,
          amount: null,
          date: today,
          drill_down: null,
          recommended_action: 'Post a purchase or stock-in movement with cost to establish WAC.',
        })
      }
    }
  } catch {
    // ignore
  }

  // 13. Unusual asset credit (MEDIUM) — ASSET accounts with credit balance
  try {
    const { data: accts } = await admin
      .from('accounts')
      .select('id, code, name, category_id, account_categories!inner(code, type)')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .eq('account_categories.code', 'ASSET')
    if (accts) {
      for (const a of accts as any[]) {
        const bal = await getAccountBalanceByCode(businessId, a.code)
        if (bal < 0n) {
          out.push({
            severity: 'MEDIUM',
            issue: `Unusual credit balance on asset account`,
            reference: `${a.code} ${a.name}`,
            amount: (-bal).toString(),
            date: today,
            drill_down: `/?ledger=${a.id}`,
            recommended_action: 'Asset accounts should normally have debit balance. Investigate.',
          })
        }
      }
    }
  } catch {
    // ignore
  }

  // 14. Unusual liability debit (MEDIUM)
  try {
    const { data: accts } = await admin
      .from('accounts')
      .select('id, code, name, category_id, account_categories!inner(code, type)')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .eq('account_categories.code', 'LIABILITY')
    if (accts) {
      for (const a of accts as any[]) {
        const bal = await getAccountBalanceByCode(businessId, a.code)
        if (bal > 0n) {
          out.push({
            severity: 'MEDIUM',
            issue: `Unusual debit balance on liability account`,
            reference: `${a.code} ${a.name}`,
            amount: bal.toString(),
            date: today,
            drill_down: `/?ledger=${a.id}`,
            recommended_action: 'Liability accounts should normally have credit balance. Investigate.',
          })
        }
      }
    }
  } catch {
    // ignore
  }

  // 15. Old unconfirmed COD submission (MEDIUM)
  try {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    const cutoffStr = bizDateString(cutoff)
    const { data: oldSubs } = await admin
      .from('rider_cod_submissions')
      .select('id, submission_no, rider_id, submitted_date, requested_amount, status, riders(name)')
      .eq('business_id', businessId)
      .eq('status', 'submitted')
      .lt('submitted_date', cutoffStr)
      .limit(50)
    if (oldSubs) {
      for (const s of oldSubs as any[]) {
        out.push({
          severity: 'MEDIUM',
          issue: `COD submission unconfirmed for > 7 days`,
          reference: `${s.submission_no} (${s.riders?.name ?? '—'})`,
          amount: String(s.requested_amount ?? 0),
          date: s.submitted_date ?? today,
          drill_down: null,
          recommended_action: 'Confirm or reject the COD submission.',
        })
      }
    }
  } catch {
    // ignore
  }

  // 16. Fully allocated COD with active request (LOW)
  try {
    const { data: activeCod } = await admin
      .from('delivery_orders')
      .select('id, status, total_cod_amount, cod_collected_amount')
      .eq('business_id', businessId)
      .not('status', 'in', '(delivered,returned)')
    if (activeCod) {
      for (const o of activeCod as any[]) {
        const total = BigInt(o.total_cod_amount ?? 0)
        const collected = BigInt(o.cod_collected_amount ?? 0)
        if (total > 0n && total === collected) {
          out.push({
            severity: 'LOW',
            issue: `COD fully collected but order status not delivered/returned (${o.status})`,
            reference: o.id.slice(0, 8).toUpperCase(),
            amount: total.toString(),
            date: today,
            drill_down: null,
            recommended_action: 'Update delivery order status to delivered.',
          })
        }
      }
    }
  } catch {
    // ignore
  }

  // Sort by severity: CRITICAL > HIGH > MEDIUM > LOW
  const sevOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
  out.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity])

  return out
}

// ─────────────────────────────────────────────────────────────
// Phase 8 completion: Salesman own-reports data-access
// ─────────────────────────────────────────────────────────────
export async function reportMySalesSummary(businessId: string, salesmanId: string, fromDate: string, toDate: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin
    .from('invoices')
    .select('id, invoice_no, invoice_type, invoice_date, total, paid_amount, is_returned, is_cancelled')
    .eq('business_id', businessId)
    .eq('salesman_id', salesmanId)
    .eq('is_cancelled', false)
    .gte('invoice_date', fromDate)
    .lte('invoice_date', toDate)
    .order('invoice_date', { ascending: false })
    .limit(1000)
  if (error) throw new Error(`reportMySalesSummary: ${error.message}`)

  let count = 0
  let total = 0n
  let paid = 0n
  let returned = 0n
  for (const inv of data ?? []) {
    count += 1
    total += BigInt(inv.total ?? 0)
    paid += BigInt(inv.paid_amount ?? 0)
    if (inv.is_returned) returned += BigInt(inv.total ?? 0)
  }
  return {
    invoiceCount: count,
    totalAmount: total.toString(),
    paidAmount: paid.toString(),
    outstandingAmount: (total - paid).toString(),
    returnedAmount: returned.toString(),
  }
}

export async function reportMySalesDetail(businessId: string, salesmanId: string, fromDate: string, toDate: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin
    .from('invoices')
    .select('id, invoice_no, invoice_type, invoice_date, customer_name, customer_phone, subtotal, total, paid_amount, is_returned, is_cancelled')
    .eq('business_id', businessId)
    .eq('salesman_id', salesmanId)
    .eq('is_cancelled', false)
    .gte('invoice_date', fromDate)
    .lte('invoice_date', toDate)
    .order('invoice_date', { ascending: false })
    .limit(500)
  if (error) throw new Error(`reportMySalesDetail: ${error.message}`)
  return data as any[]
}

export async function reportMyCollections(businessId: string, salesmanId: string, fromDate: string, toDate: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin
    .from('payment_allocations')
    .select('id, invoice_id, account_id, amount, is_change, allocation_date, invoices!inner(invoice_no, salesman_id), accounts(code, name)')
    .eq('business_id', businessId)
    .eq('invoices.salesman_id', salesmanId)
    .eq('is_change', false)
    .gte('allocation_date', fromDate)
    .lte('allocation_date', toDate)
    .order('allocation_date', { ascending: false })
    .limit(500)
  if (error) throw new Error(`reportMyCollections: ${error.message}`)
  return data as any[]
}

export async function reportMyReturns(businessId: string, salesmanId: string, fromDate: string, toDate: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin
    .from('sales_returns')
    .select('id, return_date, total, reason, original_invoice_id, invoices!inner(invoice_no, salesman_id)')
    .eq('business_id', businessId)
    .eq('invoices.salesman_id', salesmanId)
    .gte('return_date', fromDate)
    .lte('return_date', toDate)
    .order('return_date', { ascending: false })
    .limit(500)
  if (error) throw new Error(`reportMyReturns: ${error.message}`)
  return data as any[]
}

export async function reportMyCommission(businessId: string, salesmanId: string, fromDate: string, toDate: string) {
  const admin = getAdminSupabase()
  const { data, error } = await admin
    .from('salesman_commissions')
    .select('id, invoice_id, allocation_id, collected_amount, commission_pct, commission_amount, created_at, invoices!inner(invoice_no, invoice_date, salesman_id)')
    .eq('business_id', businessId)
    .eq('invoices.salesman_id', salesmanId)
    .gte('invoices.invoice_date', fromDate)
    .lte('invoices.invoice_date', toDate)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(`reportMyCommission: ${error.message}`)
  // Apply a unified "status" field: 'accrued' (default per spec)
  return (data ?? []).map((r: any) => ({
    ...r,
    status: 'accrued',
  }))
}
