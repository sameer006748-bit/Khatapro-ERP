/**
 * GET /api/reports/csv?type=X&fromDate=Y&toDate=Z[&accountId=A]
 *
 * Returns a UTF-8 BOM-prefixed CSV file with proper escaping.
 * Money is converted from paisas (BigInt) → rupees (2 decimals) ONLY in the CSV.
 *
 * Supported types:
 *   profit-loss, balance-sheet, trial-balance, account-ledger,
 *   day-book, sales-detail, inventory-valuation, product-profitability
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/authOptions'
import { loadSessionUser, hasPermission } from '@/lib/auth/permissions'
import {
  reportProfitLoss,
  reportBalanceSheet,
  reportTrialBalance,
  reportSalesDetail,
  reportInventoryValuation,
  reportProductProfitability,
  reportExceptions,
} from '@/lib/reports/data-access'
import { dayBook } from '@/lib/vouchers/data-access'
import { accountLedgerSmart } from '@/lib/accounting/voucher-supabase'
import { getAccountById } from '@/lib/accounting/data-access'

// ─── CSV helpers ─────────────────────────────────────────────
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function rowFrom(cells: unknown[]): string {
  return cells.map(csvEscape).join(',')
}

/** Paisas (string or number) → rupees with 2 decimals, as a string. */
function paisasToRupees(p: string | number | null | undefined): string {
  if (p === null || p === undefined || p === '') return '0.00'
  try {
    const b = BigInt(p)
    const neg = b < 0n
    const abs = neg ? -b : b
    const whole = abs / 100n
    const frac = abs % 100n
    const s = `${whole.toString()}.${frac.toString().padStart(2, '0')}`
    return neg ? `-${s}` : s
  } catch {
    return '0.00'
  }
}

function filenameFor(type: string, fromDate: string, toDate: string): string {
  const tagMap: Record<string, string> = {
    'profit-loss': 'PL',
    'balance-sheet': 'BS',
    'trial-balance': 'TB',
    'account-ledger': 'Ledger',
    'day-book': 'DayBook',
    'sales-detail': 'SalesDetail',
    'inventory-valuation': 'Inventory',
    'product-profitability': 'ProductProfitability',
    'exceptions': 'Exceptions',
  }
  const tag = tagMap[type] ?? type
  return `KhataPro_${tag}_${fromDate}_to_${toDate}.csv`
}

// ─── Per-type CSV builders ───────────────────────────────────
function buildProfitLossCsv(rows: any[]): string {
  const header = rowFrom(['Section', 'Account Code', 'Account Name', 'Category Type', 'Amount (Rs)'])
  const lines = rows.map(r => rowFrom([
    r.section ?? '',
    r.account_code ?? '',
    r.account_name ?? '',
    r.category_type ?? '',
    paisasToRupees(r.amount),
  ]))
  return [header, ...lines].join('\n')
}

function buildBalanceSheetCsv(rows: any[]): string {
  const header = rowFrom(['Section', 'Account Code', 'Account Name', 'Category Type', 'Balance (Rs)', 'Calculated'])
  const lines = rows.map(r => rowFrom([
    r.section ?? '',
    r.account_code ?? '',
    r.account_name ?? '',
    r.category_type ?? '',
    paisasToRupees(r.balance),
    r.is_calculated ? 'YES' : 'NO',
  ]))
  // Add totals row
  const assets = rows.filter(r => r.section === 'ASSET').reduce((s, r) => s + BigInt(r.balance ?? 0), 0n)
  const liabilities = rows.filter(r => r.section === 'LIABILITY').reduce((s, r) => s + BigInt(r.balance ?? 0), 0n)
  const equity = rows.filter(r => r.section === 'EQUITY').reduce((s, r) => s + BigInt(r.balance ?? 0), 0n)
  const totals = rowFrom([
    '', '', 'TOTALS', '',
    paisasToRupees(assets.toString()),
    `Assets=${paisasToRupees(assets.toString())} Liabilities=${paisasToRupees(liabilities.toString())} Equity=${paisasToRupees(equity.toString())} Liab+Equity=${paisasToRupees((liabilities + equity).toString())} Diff=${paisasToRupees((assets - liabilities - equity).toString())}`,
  ])
  return [header, ...lines, totals].join('\n')
}

function buildTrialBalanceCsv(rows: any[]): string {
  const header = rowFrom([
    'Account Code', 'Account Name', 'Category Code', 'Category Name',
    'Category Type', 'Total Debit (Rs)', 'Total Credit (Rs)', 'Balance (Rs)',
  ])
  const lines = rows.map((r: any) => rowFrom([
    r.account_code ?? r.code ?? '',
    r.account_name ?? r.name ?? '',
    r.category_code ?? '',
    r.category_name ?? '',
    r.category_type ?? '',
    paisasToRupees(r.total_debit),
    paisasToRupees(r.total_credit),
    paisasToRupees(r.balance),
  ]))
  let totalDebit = 0n
  let totalCredit = 0n
  for (const r of rows as any[]) {
    try { totalDebit += BigInt(r.total_debit ?? 0) } catch {}
    try { totalCredit += BigInt(r.total_credit ?? 0) } catch {}
  }
  const totals = rowFrom(['', '', '', '', 'TOTAL', paisasToRupees(totalDebit.toString()), paisasToRupees(totalCredit.toString()), ''])
  return [header, ...lines, totals].join('\n')
}

function buildAccountLedgerCsv(rows: any[]): string {
  const header = rowFrom([
    'Line ID', 'Voucher ID', 'Voucher Type', 'Voucher Date', 'Memo',
    'Debit (Rs)', 'Credit (Rs)', 'Running Balance (Rs)',
  ])
  const lines = rows.map((r: any) => rowFrom([
    r.lineId ?? '',
    r.voucherId ?? '',
    r.voucherType ?? '',
    r.voucherDate ?? '',
    r.memo ?? '',
    paisasToRupees(r.debit),
    paisasToRupees(r.credit),
    paisasToRupees(r.runningBalance),
  ]))
  return [header, ...lines].join('\n')
}

function buildDayBookCsv(rows: any[]): string {
  const header = rowFrom([
    'Voucher No', 'Voucher Type', 'Voucher Date', 'Memo',
    'Total Debit (Rs)', 'Total Credit (Rs)', 'Cancelled',
    'Account Code', 'Account Name', 'Debit (Rs)', 'Credit (Rs)', 'Line Memo',
  ])
  const lines: string[] = []
  for (const v of rows as any[]) {
    if (!v.lines || v.lines.length === 0) {
      lines.push(rowFrom([
        v.voucherNo ?? '', v.voucherType ?? '', v.voucherDate ?? '', v.memo ?? '',
        paisasToRupees(v.totalDebit), paisasToRupees(v.totalCredit),
        v.isCancelled ? 'YES' : 'NO',
        '', '', '', '', '',
      ]))
    } else {
      for (const l of v.lines) {
        lines.push(rowFrom([
          v.voucherNo ?? '', v.voucherType ?? '', v.voucherDate ?? '', v.memo ?? '',
          '', '',
          v.isCancelled ? 'YES' : 'NO',
          l.accountCode ?? '', l.accountName ?? '',
          paisasToRupees(l.debit), paisasToRupees(l.credit), l.memo ?? '',
        ]))
      }
    }
  }
  return [header, ...lines].join('\n')
}

function buildSalesDetailCsv(rows: any[]): string {
  const header = rowFrom([
    'Invoice No', 'Invoice Type', 'Invoice Date', 'Customer Name', 'Customer Phone',
    'Subtotal (Rs)', 'Total (Rs)', 'Paid (Rs)', 'Outstanding (Rs)',
    'Is Returned', 'Is Cancelled',
  ])
  const lines = rows.map((r: any) => rowFrom([
    r.invoice_no ?? '',
    r.invoice_type ?? '',
    r.invoice_date ?? '',
    r.customer_name ?? '',
    r.customer_phone ?? '',
    paisasToRupees(r.subtotal),
    paisasToRupees(r.total),
    paisasToRupees(r.paid_amount),
    paisasToRupees((BigInt(r.total ?? 0) - BigInt(r.paid_amount ?? 0)).toString()),
    r.is_returned ? 'YES' : 'NO',
    r.is_cancelled ? 'YES' : 'NO',
  ]))
  return [header, ...lines].join('\n')
}

function buildInventoryValuationCsv(rows: any[]): string {
  const header = rowFrom([
    'Product ID', 'Product Name', 'Category', 'Current Stock',
    'WAC (Rs)', 'Stock Value (Rs)', 'Sale Price (Rs)', 'Low Stock Threshold',
  ])
  const lines = rows.map((r: any) => rowFrom([
    r.product_id ?? '',
    r.product_name ?? '',
    r.category_name ?? '',
    r.current_stock ?? 0,
    paisasToRupees(r.weighted_average_cost),
    paisasToRupees(r.stock_value),
    paisasToRupees(r.sale_price),
    r.low_stock_threshold ?? 5,
  ]))
  return [header, ...lines].join('\n')
}

function buildProductProfitabilityCsv(rows: any[]): string {
  const header = rowFrom([
    'Product', 'SKU', 'Qty Sold', 'Returned', 'Net Qty',
    'Net Sales (Rs)', 'COGS (Rs)', 'Gross Profit (Rs)', 'Margin %',
    'Current WAC (Rs)', 'Current Stock', 'Inventory Value (Rs)', 'Cost Status',
  ])
  const lines = rows.map((r: any) => rowFrom([
    r.product_name ?? '',
    r.sku ?? '',
    r.quantity_sold ?? 0,
    r.returned_quantity ?? 0,
    r.net_quantity_sold ?? 0,
    paisasToRupees(r.net_product_sales),
    paisasToRupees(r.cogs),
    paisasToRupees(r.gross_profit),
    (r.gross_margin_pct ?? 0).toFixed(2) + '%',
    paisasToRupees(r.current_wac),
    r.current_stock ?? 0,
    paisasToRupees(r.inventory_value),
    r.cost_status ?? '',
  ]))
  return [header, ...lines].join('\n')
}

function buildExceptionsCsv(rows: any[]): string {
  const header = rowFrom([
    'Severity', 'Issue', 'Reference', 'Amount (Rs)', 'Date',
    'Drill-Down', 'Recommended Action',
  ])
  const lines = rows.map((r: any) => rowFrom([
    r.severity ?? '',
    r.issue ?? '',
    r.reference ?? '',
    paisasToRupees(r.amount),
    r.date ?? '',
    r.drill_down ?? '',
    r.recommended_action ?? '',
  ]))
  return [header, ...lines].join('\n')
}

// ─── Main route ──────────────────────────────────────────────
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const loaded = await loadSessionUser((session.user as any).id)
  if (!loaded) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const url = new URL(req.url)
  const type = url.searchParams.get('type') || ''
  const fromDate = url.searchParams.get('fromDate') || new Date().toISOString().slice(0, 8) + '01'
  const toDate = url.searchParams.get('toDate') || new Date().toISOString().slice(0, 10)
  const accountId = url.searchParams.get('accountId') || ''

  const permMap: Record<string, string> = {
    'profit-loss': 'can_view_pl',
    'balance-sheet': 'can_view_balance_sheet',
    'trial-balance': 'can_view_trial_balance',
    'account-ledger': 'can_view_ledgers',
    'day-book': 'can_view_day_book',
    'sales-detail': 'can_view_sales_reports',
    'inventory-valuation': 'can_view_inventory_reports',
    'product-profitability': 'can_view_inventory_reports',
    'exceptions': 'can_view_audit_reports',
  }
  const requiredPerm = permMap[type]
  if (!requiredPerm) {
    return NextResponse.json({ error: 'UNKNOWN_CSV_TYPE' }, { status: 400 })
  }
  if (!hasPermission(loaded, requiredPerm)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  try {
    const bid = loaded.businessId
    let csvBody = ''
    switch (type) {
      case 'profit-loss': {
        const rows = await reportProfitLoss(bid, fromDate, toDate)
        csvBody = buildProfitLossCsv(rows)
        break
      }
      case 'balance-sheet': {
        const rows = await reportBalanceSheet(bid, toDate)
        csvBody = buildBalanceSheetCsv(rows)
        break
      }
      case 'trial-balance': {
        const rows = await reportTrialBalance(bid)
        csvBody = buildTrialBalanceCsv(rows)
        break
      }
      case 'account-ledger': {
        if (!accountId) {
          return NextResponse.json({ error: 'accountId is required for account-ledger CSV' }, { status: 400 })
        }
        // Verify account belongs to this business
        const acct = await getAccountById(bid, accountId)
        if (!acct) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
        const lines = await accountLedgerSmart(bid, accountId)
        const rows = lines.map(l => ({
          lineId: l.lineId,
          voucherId: l.voucherId,
          voucherType: l.voucherType,
          voucherDate: l.voucherDate,
          memo: l.memo,
          debit: l.debit.toString(),
          credit: l.credit.toString(),
          runningBalance: l.runningBalance.toString(),
        }))
        csvBody = buildAccountLedgerCsv(rows)
        break
      }
      case 'day-book': {
        const rows = await dayBook(bid, { fromDate, toDate })
        csvBody = buildDayBookCsv(rows)
        break
      }
      case 'sales-detail': {
        const rows = await reportSalesDetail(bid, fromDate, toDate)
        csvBody = buildSalesDetailCsv(rows)
        break
      }
      case 'inventory-valuation': {
        const rows = await reportInventoryValuation(bid)
        csvBody = buildInventoryValuationCsv(rows)
        break
      }
      case 'product-profitability': {
        const rows = await reportProductProfitability(bid, fromDate, toDate)
        csvBody = buildProductProfitabilityCsv(rows)
        break
      }
      case 'exceptions': {
        const rows = await reportExceptions(bid)
        csvBody = buildExceptionsCsv(rows)
        break
      }
      default:
        return NextResponse.json({ error: 'UNKNOWN_CSV_TYPE' }, { status: 400 })
    }

    // Prepend UTF-8 BOM so Excel reads UTF-8 correctly.
    const bom = '\uFEFF'
    const fullBody = bom + csvBody + '\n'

    const filename = filenameFor(type, fromDate, toDate)
    return new NextResponse(fullBody, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
