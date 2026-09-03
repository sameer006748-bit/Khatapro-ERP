'use client'

import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { formatMoney } from '@/lib/format'
import { apiFetchJson } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle2, AlertCircle, ArrowRight, Scale, Filter, List, ListTree, RotateCcw } from 'lucide-react'
import { PageHeader } from '@/components/erp/page-header'

type Row = {
  accountId: string
  accountCode: string
  accountName: string
  categoryCode: string
  categoryName: string
  categoryType: string
  /** Classification labels — null for an account that sits on a fixed accounting type. */
  rootId?: string | null
  classCategoryId?: string | null
  classCategoryName?: string | null
  classSubcategoryId?: string | null
  classSubcategoryName?: string | null
  totalDebit: string
  totalCredit: string
  balance: string
}

type Classification = {
  hasCustomClassification: boolean
  roots: Array<{ id: string; name: string; type: string; displayType: string }>
  categories: Array<{ id: string; name: string; rootId: string; isActive: boolean }>
  subcategories: Array<{ id: string; name: string; rootId: string; categoryId: string; isActive: boolean }>
}

const CATEGORY_COLORS: Record<string, string> = {
  ASSET: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  LIABILITY: 'bg-amber-50 text-amber-700 border-amber-200',
  EQUITY: 'bg-violet-50 text-violet-700 border-violet-200',
  INCOME: 'bg-sky-50 text-sky-700 border-sky-200',
  EXPENSE: 'bg-rose-50 text-rose-700 border-rose-200',
}

/** Radix has no empty option, so each selector keeps an explicit "all" value. */
const ALL = '__all__'
/** Statement order, so the groups read like a printed trial balance. */
const ROOT_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']

/** `Income` is stored, `Revenue` is shown. */
function displayType(type: string): string {
  return type === 'Income' ? 'Revenue' : type
}

type Bucket = { key: string; label: string; rows: Row[]; debit: bigint; credit: bigint }
type CategoryGroup = { key: string; label: string; debit: bigint; credit: bigint; subs: Bucket[] }
type RootGroup = {
  key: string
  label: string
  order: number
  debit: bigint
  credit: bigint
  categories: CategoryGroup[]
}

const rank = (position: number) => (position < 0 ? ROOT_ORDER.length : position)
const lastIf = (isLast: boolean) => (isLast ? 1 : 0)

/**
 * Root → Category → Subcategory → Account. Every row lands in exactly one
 * subcategory bucket, so each subtotal is a sum over a disjoint set of the same
 * account rows the flat table shows — nothing is counted twice, and accounts
 * that predate the classification still appear under their accounting type.
 */
function buildGroups(rows: Row[], roots: Classification['roots']): RootGroup[] {
  const rootLabels = new Map(roots.map((root) => [root.id, root.displayType]))
  const groups: RootGroup[] = []
  for (const row of rows) {
    const debit = BigInt(row.totalDebit)
    const credit = BigInt(row.totalCredit)
    const rootKey = row.rootId ?? `type:${row.categoryType}`
    let root = groups.find((group) => group.key === rootKey)
    if (!root) {
      root = {
        key: rootKey,
        label: (row.rootId ? rootLabels.get(row.rootId) : null) ?? displayType(row.categoryType),
        order: ROOT_ORDER.indexOf(row.categoryCode.toUpperCase()),
        debit: 0n,
        credit: 0n,
        categories: [],
      }
      groups.push(root)
    }
    root.debit += debit
    root.credit += credit
    const categoryKey = row.classCategoryId ?? 'ungrouped'
    let category = root.categories.find((entry) => entry.key === categoryKey)
    if (!category) {
      category = {
        key: categoryKey,
        label: row.classCategoryName ?? 'Not grouped in a category',
        debit: 0n,
        credit: 0n,
        subs: [],
      }
      root.categories.push(category)
    }
    category.debit += debit
    category.credit += credit
    const subKey = row.classSubcategoryId ?? 'direct'
    let sub = category.subs.find((entry) => entry.key === subKey)
    if (!sub) {
      sub = {
        key: subKey,
        label: row.classSubcategoryName ?? 'Direct accounts',
        rows: [],
        debit: 0n,
        credit: 0n,
      }
      category.subs.push(sub)
    }
    sub.debit += debit
    sub.credit += credit
    sub.rows.push(row)
  }
  groups.sort((a, b) => rank(a.order) - rank(b.order) || a.label.localeCompare(b.label))
  for (const root of groups) {
    root.categories.sort((a, b) =>
      lastIf(a.key === 'ungrouped') - lastIf(b.key === 'ungrouped') || a.label.localeCompare(b.label))
    for (const category of root.categories) {
      category.subs.sort((a, b) =>
        lastIf(a.key === 'direct') - lastIf(b.key === 'direct') || a.label.localeCompare(b.label))
    }
  }
  return groups
}

export function TrialBalanceView() {
  const router = useRouter()
  const [typeFilter, setTypeFilter] = useState(ALL)
  const [categoryFilter, setCategoryFilter] = useState(ALL)
  const [subcategoryFilter, setSubcategoryFilter] = useState(ALL)
  const [grouped, setGrouped] = useState(false)

  const q = useQuery<{
    rows: Row[]
    grandDebit: string
    grandCredit: string
    isBalanced: boolean
    classification?: Classification
    availability?: { accounting: boolean; message?: string }
  }>({
    queryKey: ['trial-balance'],
    queryFn: ({ signal }) => apiFetchJson('/api/trial-balance', { signal }),
    retry: false,
  })

  const unavailable = q.data?.availability?.accounting === false
  const nonZeroRows = (q.data?.rows ?? []).filter(
    (r) => BigInt(r.totalDebit) > 0n || BigInt(r.totalCredit) > 0n,
  )

  const classification = q.data?.classification
  /** Filtering and grouping only appear once the business actually classifies accounts. */
  const canFilter = classification?.hasCustomClassification === true
  const roots = classification?.roots ?? []
  const categoryOptions = (classification?.categories ?? [])
    .filter((category) => typeFilter === ALL || category.rootId === typeFilter)
  const subcategoryOptions = (classification?.subcategories ?? []).filter((sub) => categoryFilter !== ALL
    ? sub.categoryId === categoryFilter
    : typeFilter === ALL || sub.rootId === typeFilter)

  const filtersActive = canFilter
    && (typeFilter !== ALL || categoryFilter !== ALL || subcategoryFilter !== ALL)

  /** Filtering only ever hides whole account rows; the figures stay untouched. */
  const selectedRoot = roots.find((root) => root.id === typeFilter) ?? null
  const visibleRows = !filtersActive ? nonZeroRows : nonZeroRows.filter((r) => {
    const rootOk = typeFilter === ALL
      || (r.rootId ? r.rootId === typeFilter : selectedRoot?.type === r.categoryType)
    if (!rootOk) return false
    if (categoryFilter !== ALL && r.classCategoryId !== categoryFilter) return false
    if (subcategoryFilter !== ALL && r.classSubcategoryId !== subcategoryFilter) return false
    return true
  })
  const filteredDebit = visibleRows.reduce((sum, r) => sum + BigInt(r.totalDebit), 0n)
  const filteredCredit = visibleRows.reduce((sum, r) => sum + BigInt(r.totalCredit), 0n)
  const groups = grouped ? buildGroups(visibleRows, roots) : []
  const openLedger = (accountId: string) => router.push(`/?ledger=${accountId}`)

  function selectType(value: string) {
    setTypeFilter(value)
    setCategoryFilter(ALL)
    setSubcategoryFilter(ALL)
  }
  function selectCategory(value: string) {
    setCategoryFilter(value)
    setSubcategoryFilter(ALL)
  }
  function resetFilters() {
    setTypeFilter(ALL)
    setCategoryFilter(ALL)
    setSubcategoryFilter(ALL)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trial Balance"
        description="Review debit and credit totals by account. Select an account to open its ledger."
      />

      {/* Balance status banner */}
      {q.data && !unavailable && (
        <div
          className={`card-3d p-5 ${
            q.data.isBalanced ? 'border-primary/40' : 'border-destructive/40'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`grid place-items-center size-10 rounded-xl ${
                q.data.isBalanced ? 'icon-3d' : 'bg-destructive/10'
              }`}
            >
              {q.data.isBalanced ? (
                <CheckCircle2 className="size-5 text-primary-foreground" />
              ) : (
                <AlertCircle className="size-5 text-destructive" />
              )}
            </div>
            <div className="flex-1">
              <div
                className={`text-sm font-semibold ${
                  q.data.isBalanced ? 'text-primary' : 'text-destructive'
                }`}
              >
                {q.data.isBalanced ? 'Balanced' : 'Out of balance'}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Total Debit ={' '}
                <span className="font-medium text-foreground" data-num>
                  {formatMoney(BigInt(q.data.grandDebit))}
                </span>{' '}
                · Total Credit ={' '}
                <span className="font-medium text-foreground" data-num>
                  {formatMoney(BigInt(q.data.grandCredit))}
                </span>
              </div>
            </div>
            <Scale className="size-5 text-muted-foreground hidden sm:block" />
          </div>
        </div>
      )}

      {q.isLoading ? (
        <div className="card-3d p-8 text-sm text-muted-foreground">Loading…</div>
      ) : q.isError ? (
        <div className="card-3d p-8 text-center">
          <p className="text-sm text-destructive mb-3">Unable to load Trial Balance.</p>
          <button className="text-sm font-medium text-primary hover:underline" onClick={() => q.refetch()}>Retry</button>
        </div>
      ) : unavailable ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This accounting feature is currently unavailable.
        </div>
      ) : nonZeroRows.length === 0 ? (
        <div className="card-3d p-8 text-center">
          <div className="grid place-items-center size-12 rounded-xl icon-3d-muted mx-auto mb-3">
            <Scale className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-foreground font-medium">No postings yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Post a Journal Voucher or an Opening Balance to populate the Trial Balance.
          </p>
        </div>
      ) : (
        <>
          {canFilter && (
            <div className="card-3d p-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground px-1">
                <Filter className="size-3.5" /> Filter
              </span>
              <FilterSelect
                label="Accounting type" allLabel="All types" value={typeFilter} onChange={selectType}
                options={roots.map((root) => ({ value: root.id, label: root.displayType }))}
              />
              <FilterSelect
                label="Category" allLabel="All categories" value={categoryFilter} onChange={selectCategory}
                options={categoryOptions.map((category) => ({ value: category.id, label: optionLabel(category) }))}
              />
              <FilterSelect
                label="Subcategory" allLabel="All subcategories" value={subcategoryFilter} onChange={setSubcategoryFilter}
                options={subcategoryOptions.map((sub) => ({ value: sub.id, label: optionLabel(sub) }))}
              />
              {filtersActive && (
                <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={resetFilters}>
                  <RotateCcw className="size-3.5" /> Reset
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-9 px-2.5 text-xs sm:ml-auto" onClick={() => setGrouped((on) => !on)}>
                {grouped
                  ? <><List className="size-3.5" /> Flat list</>
                  : <><ListTree className="size-3.5" /> Group by category</>}
              </Button>
            </div>
          )}

          {visibleRows.length === 0 ? (
            <div className="card-3d p-8 text-center">
              <p className="text-sm text-foreground font-medium">No accounts match these filters</p>
              <button className="text-sm font-medium text-primary hover:underline mt-2" onClick={resetFilters}>
                Reset filters
              </button>
            </div>
          ) : (
          <>
          {/* Desktop table */}
          <div className="hidden md:block card-3d overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Accounts</h2>
              <span className="text-xs text-muted-foreground" data-num>
                {filtersActive ? `${visibleRows.length} of ${nonZeroRows.length} active` : `${nonZeroRows.length} active`}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <th className="text-left p-3.5 font-medium">Code</th>
                    <th className="text-left p-3.5 font-medium">Account</th>
                    <th className="text-left p-3.5 font-medium">Category</th>
                    <th className="text-right p-3.5 font-medium">Debit</th>
                    <th className="text-right p-3.5 font-medium">Credit</th>
                    <th className="text-right p-3.5 font-medium">Balance</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {grouped
                    ? groups.map((root) => (
                      <Fragment key={root.key}>
                        <tr className="border-b border-border bg-muted/50">
                          <td colSpan={3} className="px-3.5 py-2 text-[11px] uppercase tracking-wider font-semibold text-foreground">
                            {root.label}
                          </td>
                          <td className="px-3.5 py-2 text-right text-xs font-semibold text-foreground" data-num>
                            {formatMoney(root.debit, false)}
                          </td>
                          <td className="px-3.5 py-2 text-right text-xs font-semibold text-foreground" data-num>
                            {formatMoney(root.credit, false)}
                          </td>
                          <td colSpan={2}></td>
                        </tr>
                        {root.categories.map((category) => (
                          <Fragment key={category.key}>
                            <tr className="border-b border-border/60 bg-muted/25">
                              <td colSpan={3} className="px-3.5 py-1.5 pl-6 text-xs font-medium text-foreground">{category.label}</td>
                              <td className="px-3.5 py-1.5 text-right text-xs text-muted-foreground" data-num>
                                {formatMoney(category.debit, false)}
                              </td>
                              <td className="px-3.5 py-1.5 text-right text-xs text-muted-foreground" data-num>
                                {formatMoney(category.credit, false)}
                              </td>
                              <td colSpan={2}></td>
                            </tr>
                            {category.subs.map((sub) => (
                              <Fragment key={sub.key}>
                                {(category.subs.length > 1 || sub.key !== 'direct') && (
                                  <tr className="border-b border-border/40">
                                    <td colSpan={7} className="px-3.5 py-1 pl-10 text-[11px] uppercase tracking-wider text-muted-foreground">
                                      {sub.label}
                                    </td>
                                  </tr>
                                )}
                                {sub.rows.map((r) => (
                                  <AccountRow key={r.accountId} row={r} indent onOpen={() => openLedger(r.accountId)} />
                                ))}
                              </Fragment>
                            ))}
                          </Fragment>
                        ))}
                      </Fragment>
                    ))
                    : visibleRows.map((r) => (
                      <AccountRow key={r.accountId} row={r} onOpen={() => openLedger(r.accountId)} />
                    ))}
                </tbody>
                <tfoot>
                  {filtersActive && (
                    <tr className="border-t border-border bg-accent/20">
                      <td colSpan={3} className="p-3.5 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                        Filtered subtotal
                      </td>
                      <td className="p-3.5 text-right font-medium text-foreground" data-num>
                        {formatMoney(filteredDebit)}
                      </td>
                      <td className="p-3.5 text-right font-medium text-foreground" data-num>
                        {formatMoney(filteredCredit)}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  )}
                  <tr className="border-t-2 border-border bg-muted/30">
                    <td colSpan={3} className="p-3.5 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                      Grand totals
                    </td>
                    <td className="p-3.5 text-right font-semibold text-foreground" data-num>
                      {formatMoney(BigInt(q.data?.grandDebit ?? '0'))}
                    </td>
                    <td className="p-3.5 text-right font-semibold text-foreground" data-num>
                      {formatMoney(BigInt(q.data?.grandCredit ?? '0'))}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {grouped
              ? groups.map((root) => (
                <div key={root.key} className="space-y-3">
                  <div className="flex items-baseline justify-between gap-2 px-1">
                    <span className="text-[11px] uppercase tracking-wider font-semibold text-foreground">{root.label}</span>
                    <span className="text-[11px] text-muted-foreground" data-num>
                      Dr {formatMoney(root.debit, false)} · Cr {formatMoney(root.credit, false)}
                    </span>
                  </div>
                  {root.categories.map((category) => (
                    <div key={category.key} className="space-y-3">
                      <div className="text-xs font-medium text-muted-foreground px-1">{category.label}</div>
                      {category.subs.flatMap((sub) => sub.rows).map((r) => (
                        <AccountCard key={r.accountId} row={r} onOpen={() => openLedger(r.accountId)} />
                      ))}
                    </div>
                  ))}
                </div>
              ))
              : visibleRows.map((r) => (
                <AccountCard key={r.accountId} row={r} onOpen={() => openLedger(r.accountId)} />
              ))}
            {filtersActive && (
              <div className="card-3d p-4 bg-accent/20 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Filtered Debit</div>
                  <div className="font-medium text-foreground" data-num>{formatMoney(filteredDebit)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Filtered Credit</div>
                  <div className="font-medium text-foreground" data-num>{formatMoney(filteredCredit)}</div>
                </div>
              </div>
            )}
            <div className="card-3d p-4 bg-muted/30 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Debit</div>
                <div className="font-semibold text-foreground" data-num>
                  {formatMoney(BigInt(q.data?.grandDebit ?? '0'))}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Credit</div>
                <div className="font-semibold text-foreground" data-num>
                  {formatMoney(BigInt(q.data?.grandCredit ?? '0'))}
                </div>
              </div>
            </div>
          </div>
          </>
          )}
        </>
      )}
    </div>
  )
}

/** Inactive categories stay selectable so historical rows keep resolving. */
function optionLabel(node: { name: string; isActive: boolean }): string {
  return node.isActive ? node.name : `${node.name} (inactive)`
}

/** Compact report filter — a labelled trigger with an explicit "all" option. */
function FilterSelect({ label, allLabel, value, options, onChange }: {
  label: string
  allLabel: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-full sm:w-44 bg-background text-xs" aria-label={label}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** "Category › Subcategory" for a row, empty when the account sits on a root. */
function pathOf(row: Row): string {
  return [row.classCategoryName, row.classSubcategoryName].filter(Boolean).join(' › ')
}

/** One account line — the same figures in the flat and in the grouped table. */
function AccountRow({ row, indent, onOpen }: { row: Row; indent?: boolean; onOpen: () => void }) {
  const path = pathOf(row)
  return (
    <tr
      onClick={onOpen}
      className="border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors cursor-pointer"
    >
      <td className={`p-3.5 font-medium text-foreground ${indent ? 'pl-10' : ''}`} data-num>
        {row.accountCode}
      </td>
      <td className="p-3.5 text-foreground">{row.accountName}</td>
      <td className="p-3.5 text-xs">
        <span
          className={`inline-block px-2 py-0.5 rounded-md border ${
            CATEGORY_COLORS[row.categoryCode] ?? 'bg-muted text-muted-foreground border-border'
          }`}
        >
          {row.categoryName}
        </span>
        {path && <div className="mt-1 text-[11px] text-muted-foreground">{path}</div>}
      </td>
      <td className="p-3.5 text-right text-foreground" data-num>
        {BigInt(row.totalDebit) > 0n ? formatMoney(BigInt(row.totalDebit), false) : '—'}
      </td>
      <td className="p-3.5 text-right text-foreground" data-num>
        {BigInt(row.totalCredit) > 0n ? formatMoney(BigInt(row.totalCredit), false) : '—'}
      </td>
      <td className="p-3.5 text-right font-medium text-foreground" data-num>
        {formatMoney(BigInt(row.balance), false)}
      </td>
      <td className="p-3.5 text-center text-muted-foreground">
        <ArrowRight className="size-3.5" />
      </td>
    </tr>
  )
}

/** Mobile equivalent of one account line. */
function AccountCard({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const path = pathOf(row)
  return (
    <button onClick={onOpen} className="card-3d card-3d-hover p-4 w-full text-left">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border font-medium shrink-0 ${
              CATEGORY_COLORS[row.categoryCode] ?? 'bg-muted text-muted-foreground border-border'
            }`}
            data-num
          >
            {row.accountCode}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{row.accountName}</div>
            <div className="text-xs text-muted-foreground truncate">{path || row.categoryName}</div>
          </div>
        </div>
        <ArrowRight className="size-4 text-muted-foreground shrink-0 mt-0.5" />
      </div>
      <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Debit</div>
          <div className="text-sm text-foreground" data-num>
            {BigInt(row.totalDebit) > 0n ? formatMoney(BigInt(row.totalDebit)) : '—'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Credit</div>
          <div className="text-sm text-foreground" data-num>
            {BigInt(row.totalCredit) > 0n ? formatMoney(BigInt(row.totalCredit)) : '—'}
          </div>
        </div>
      </div>
    </button>
  )
}
