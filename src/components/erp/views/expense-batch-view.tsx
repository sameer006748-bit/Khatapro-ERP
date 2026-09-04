'use client'

import { useState, useMemo, type ReactNode } from 'react'
import { bizDateString } from '@/lib/dates'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Trash2, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react'
import { formatMoney, parseMoney } from '@/lib/format'
import type { MeUser } from '@/components/erp/erp-app'
import { apiFetchJson } from '@/lib/api-client'
import { PageHeader } from '@/components/erp/page-header'
import {
  CLASSIFICATION_LOAD_ERROR,
  CLASSIFICATION_QUERY_KEY,
  CLASSIFICATION_STALE_TIME_MS,
  DIRECT_ACCOUNT_GROUP,
  DIRECT_ACCOUNT_GROUP_LABEL,
  NO_MANUAL_ACCOUNTS_MESSAGE,
  NO_SUBCATEGORIES_MESSAGE,
  activeCategories,
  activeSubcategories,
  fetchClassificationTree,
  groupBySubcategory,
  hasDirectAccounts,
  manualAccountsInCategory,
  manualAccountsInRoot,
  rootByType,
  type ManualAccountOption,
} from '@/lib/accounting/classification-client'

type Account = { id: string; code: string; name: string; categoryType: string }

/**
 * `categoryId` is the expense category the account was cascaded from. It is
 * posted with the line so the server can re-check the placement itself — the
 * dropdown filtering below is convenience, never a control.
 */
type ExpenseLine = {
  key: string
  categoryId: string
  expenseAccountId: string
  description: string
  amount: string
}

const emptyLine = (key: string): ExpenseLine =>
  ({ key, categoryId: '', expenseAccountId: '', description: '', amount: '' })

export function ExpenseBatchView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [expenseDate, setExpenseDate] = useState(bizDateString(new Date()))
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [lines, setLines] = useState<ExpenseLine[]>([emptyLine('1')])
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<{ ok: boolean; expenseNo?: string; error?: string } | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  // Both loads are setup data that only changes through an explicit action in
  // this app, and both are shared with other screens under these keys — so they
  // are fetched once, in parallel, and reused instead of refetched on every
  // revisit. The setup screen invalidates both keys after a classification
  // change, which overrides the cache lifetime.
  const coaQ = useQuery<any>({ queryKey: ['coa'], queryFn: ({ signal }) => apiFetchJson<any>('/api/setup/coa', { signal }), staleTime: 300_000 })
  // Resolves to null on a deployment without the classification layer; the flat
  // account list below then behaves exactly as it did before this screen learned
  // about categories.
  const classQ = useQuery({
    queryKey: CLASSIFICATION_QUERY_KEY,
    queryFn: ({ signal }) => fetchClassificationTree(signal),
    staleTime: CLASSIFICATION_STALE_TIME_MS,
  })

  const accounts: Account[] = useMemo(() => (coaQ.data?.categories ?? []).flatMap((c: any) => c.accounts.filter((a: any) => a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name, categoryType: c.type }))), [coaQ.data])
  const businessAccounts = useMemo(() => accounts.filter(a => a.categoryType === 'Asset'), [accounts])
  // Fallback list: system-managed accounts are posted by their own workflows, and
  // cash/bank or party accounts are never manual expense destinations.
  const flatExpenseAccounts = useMemo(() => (coaQ.data?.categories ?? [])
    .filter((c: any) => c.type === 'Expense')
    .flatMap((c: any) => (c.accounts ?? []).filter((a: any) => a.isActive && !a.isSystem && !a.isBusinessAccount && !a.isPartyAccount))
    .map((a: any) => ({ id: a.id, code: a.code, name: a.name, subcategoryId: null, subcategoryName: null }) as ManualAccountOption)
    .sort((a: ManualAccountOption, b: ManualAccountOption) => a.code.localeCompare(b.code)), [coaQ.data])

  const tree = classQ.data ?? null
  const expenseRootId = useMemo(() => rootByType(tree, 'Expense')?.id ?? null, [tree])
  // Each of these walks the whole account list, so they are derived once per
  // loaded tree instead of on every keystroke in a line.
  const categories = useMemo(() => activeCategories(tree, expenseRootId), [tree, expenseRootId])
  const rootAccounts = useMemo(() => manualAccountsInRoot(tree, expenseRootId), [tree, expenseRootId])
  const directAvailable = useMemo(() => hasDirectAccounts(tree, expenseRootId), [tree, expenseRootId])
  /** Cascade only once the business actually has categories and accounts to cascade to. */
  const cascade = categories.length > 0 && rootAccounts.length > 0
  const expenseAccounts = cascade ? rootAccounts : flatExpenseAccounts

  // The cascade for each category a line has picked. Keyed on the picked
  // categories alone, so editing a description or an amount no longer re-walks
  // the account list once per line. The helpers stay the only place the eligible
  // accounts are decided — this just stops asking them the same question twice.
  const selectedCategoryKey = lines.map(l => l.categoryId).join('|')
  const cascadeByCategory = useMemo(() => {
    const byCategory = new Map<string, { options: ManualAccountOption[]; subcategoryCount: number }>()
    for (const categoryId of new Set(selectedCategoryKey.split('|').filter(Boolean))) {
      byCategory.set(categoryId, {
        options: manualAccountsInCategory(tree, expenseRootId, categoryId),
        subcategoryCount: activeSubcategories(tree, categoryId).length,
      })
    }
    return byCategory
  }, [selectedCategoryKey, tree, expenseRootId])

  const total = lines.reduce((s, l) => s + (parseMoney(l.amount) ?? 0n), 0n)

  function addLine() { setLines(ls => [...ls, emptyLine(String(Date.now()))]) }
  function removeLine(key: string) { setLines(ls => ls.length <= 1 ? ls : ls.filter(l => l.key !== key)) }
  function updateLine(key: string, field: keyof ExpenseLine, value: string) { setLines(ls => ls.map(l => l.key === key ? { ...l, [field]: value } : l)) }
  /** Changing the category clears the account chosen under the previous one. */
  function selectCategory(key: string, categoryId: string) {
    setLines(ls => ls.map(l => l.key === key ? { ...l, categoryId, expenseAccountId: '' } : l))
  }

  const mut = useMutation({
    mutationFn: async () => {
      const validLines = lines.filter(l => l.expenseAccountId && ((parseMoney(l.amount) ?? 0n) > 0n))
      const r = await fetch('/api/expense-batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expenseDate,
          paymentAccountId,
          lines: validLines.map(l => ({
            expenseAccountId: l.expenseAccountId,
            categoryId: l.categoryId && l.categoryId !== DIRECT_ACCOUNT_GROUP ? l.categoryId : undefined,
            description: l.description || undefined,
            amount: l.amount,
          })),
          reference: reference || undefined,
          notes: notes || undefined,
          idempotencyKey,
        }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j?.message ?? j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => { toast.success(`Expense Batch posted: ${j.expenseNo}`); setResult({ ok: true, expenseNo: j.expenseNo }); void qc.invalidateQueries({ queryKey: ['day-book'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }) },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })

  const canPost = paymentAccountId && lines.length >= 1 && lines.every(l => l.expenseAccountId && (parseMoney(l.amount) ?? 0n) > 0n) && total > 0n

  if (coaQ.isLoading || classQ.isLoading) {
    return <StatePanel><span role="status">Loading eligible accounts…</span></StatePanel>
  }

  if (coaQ.isError) {
    return (
      <StatePanel>
        <AlertCircle className="size-8 mx-auto mb-3 text-amber-500" />
        <p>Unable to load eligible accounts.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => coaQ.refetch()}>Retry</Button>
      </StatePanel>
    )
  }

  if (classQ.isError) {
    return (
      <StatePanel>
        <AlertCircle className="size-8 mx-auto mb-3 text-amber-500" />
        <p>{CLASSIFICATION_LOAD_ERROR}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => classQ.refetch()}>Retry</Button>
      </StatePanel>
    )
  }

  if (coaQ.data?.availability?.accounting === false) {
    return (
      <StatePanel>
        <AlertCircle className="size-8 mx-auto mb-3 text-amber-500" />
        {coaQ.data.availability.message}
      </StatePanel>
    )
  }

  if (businessAccounts.length === 0 || expenseAccounts.length === 0) {
    return (
      <StatePanel>
        <AlertCircle className="size-8 mx-auto mb-3 text-amber-500" />
        {businessAccounts.length === 0
          ? 'No eligible payment accounts configured.'
          : 'No eligible expense accounts configured.'}
      </StatePanel>
    )
  }

  if (result?.ok) return (
    <div className="card-3d p-6 max-w-md mx-auto text-center">
      <CheckCircle2 className="size-12 text-primary mx-auto mb-3" />
      <p className="text-xs text-muted-foreground mb-1">Expense Batch Posted</p>
      <p className="text-2xl font-bold text-primary" data-num>{result.expenseNo}</p>
      <Button variant="ghost" size="sm" className="mt-4" onClick={() => { setResult(null); setLines([emptyLine('1')]); setReference(''); setNotes(''); setIdempotencyKey(crypto.randomUUID()) }}>New Batch</Button>
    </div>
  )

  /** Accounts a line may post to, and the hint that explains what it is seeing. */
  function lineOptions(line: ExpenseLine): { options: ManualAccountOption[]; hint: string | null } {
    if (!cascade) return { options: flatExpenseAccounts, hint: null }
    if (!line.categoryId) return { options: [], hint: null }
    const resolved = cascadeByCategory.get(line.categoryId)
    const options = resolved?.options ?? []
    if (options.length === 0) return { options, hint: NO_MANUAL_ACCOUNTS_MESSAGE }
    const isDirect = line.categoryId === DIRECT_ACCOUNT_GROUP
    const hint = !isDirect && resolved?.subcategoryCount === 0
      ? NO_SUBCATEGORIES_MESSAGE
      : null
    return { options, hint }
  }

  const lineViews = lines.map(line => ({ line, ...lineOptions(line) }))

  return (
    <div className="space-y-4">
      <PageHeader compact title="Expense Batch" description="Record several expense lines paid from one business account." />

      {/* Header */}
      <div className="card-3d p-5 space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className="h-9 bg-background" data-num /></div>
          <div className="sm:col-span-2"><Label className="text-xs text-muted-foreground">Paid From (business account)</Label>
            <Select value={paymentAccountId} onValueChange={setPaymentAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label className="text-xs text-muted-foreground">Reference</Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
          <div><Label className="text-xs text-muted-foreground">Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
        </div>
      </div>

      {/* Lines */}
      <div className="card-3d overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Expense Lines <span className="text-xs text-muted-foreground ml-1">({lines.length})</span></h2>
          <Button variant="outline" size="sm" onClick={addLine} className="press-sm h-7"><Plus className="size-3" /> Add line</Button>
        </div>
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
              {cascade && <th className="text-left p-3 font-medium w-44">Category</th>}
              <th className="text-left p-3 font-medium">{cascade ? 'Subcategory / Expense Account' : 'Expense Account'}</th>
              <th className="text-left p-3 font-medium">Description</th>
              <th className="text-right p-3 font-medium w-32">Amount (Rs)</th>
              <th className="w-10"></th>
            </tr></thead>
            <tbody>
              {lineViews.map(({ line, options, hint }) => (
                <tr key={line.key} className="border-b border-border/60 last:border-0 align-top">
                  {cascade && (
                    <td className="p-3">
                      <CategorySelect value={line.categoryId} categories={categories} directAvailable={directAvailable} className="h-9 bg-background" onChange={v => selectCategory(line.key, v)} />
                    </td>
                  )}
                  <td className="p-3"><AccountSelect value={line.expenseAccountId} options={options} hint={hint} grouped={cascade} placeholder={cascade && !line.categoryId ? 'Select category first…' : 'Select…'} className="h-9 bg-background" onChange={v => updateLine(line.key, 'expenseAccountId', v)} /></td>
                  <td className="p-3"><Input value={line.description} onChange={e => updateLine(line.key, 'description', e.target.value)} placeholder="Optional" className="h-9 bg-background" /></td>
                  <td className="p-3"><Input type="text" value={line.amount} onChange={e => updateLine(line.key, 'amount', e.target.value)} placeholder="0.00" className="h-9 bg-background text-right" data-num /></td>
                  <td className="p-3 text-center"><button onClick={() => removeLine(line.key)} disabled={lines.length <= 1} className="text-muted-foreground hover:text-destructive disabled:opacity-30" aria-label="Remove line"><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-border bg-muted/30"><td className="p-3 text-xs uppercase tracking-wider text-muted-foreground font-medium" colSpan={cascade ? 3 : 2}>Total ({lines.length} lines)</td><td className="p-3 text-right font-semibold" data-num>{formatMoney(total, false)}</td><td></td></tr></tfoot>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border/60">
          {lineViews.map(({ line, options, hint }, i) => (
            <div key={line.key} className="p-4 space-y-2">
              <div className="flex items-center justify-between"><span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Line {i + 1}</span><button onClick={() => removeLine(line.key)} disabled={lines.length <= 1} className="text-muted-foreground hover:text-destructive disabled:opacity-30" aria-label="Remove line"><Trash2 className="size-4" /></button></div>
              {cascade && <CategorySelect value={line.categoryId} categories={categories} directAvailable={directAvailable} className="h-10 bg-background" onChange={v => selectCategory(line.key, v)} />}
              <AccountSelect value={line.expenseAccountId} options={options} hint={hint} grouped={cascade} placeholder={cascade && !line.categoryId ? 'Select category first…' : 'Expense account…'} className="h-10 bg-background" onChange={v => updateLine(line.key, 'expenseAccountId', v)} />
              <Input value={line.description} onChange={e => updateLine(line.key, 'description', e.target.value)} placeholder="Description (optional)" className="h-9 bg-background" />
              <Input type="text" value={line.amount} onChange={e => updateLine(line.key, 'amount', e.target.value)} placeholder="Amount (Rs)" className="h-9 bg-background text-right" data-num />
            </div>
          ))}
          <div className="p-4 bg-muted/30 flex justify-between items-center"><span className="text-xs uppercase text-muted-foreground">Total</span><span className="font-semibold" data-num>{formatMoney(total)}</span></div>
        </div>
      </div>

      {result && !result.ok && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
      <div className="flex justify-end">
        <Button disabled={!canPost || mut.isPending} onClick={() => mut.mutate()} className="press-md shadow-sm">{mut.isPending ? 'Posting…' : <><ArrowRight className="size-4" /> Post Expense Batch</>}</Button>
      </div>
    </div>
  )
}

/** Shared frame for the loading / error / empty states of this screen. */
function StatePanel({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold tracking-tight text-foreground">Expense Batch</h1></div>
      <div className="card-3d p-6 text-center text-sm text-muted-foreground">{children}</div>
    </div>
  )
}

/** Step 1 of the cascade: the active expense categories of this business. */
function CategorySelect({ value, categories, directAvailable, className, onChange }: {
  value: string
  categories: Array<{ id: string; name: string }>
  directAvailable: boolean
  className: string
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}><SelectValue placeholder="Select category…" /></SelectTrigger>
      <SelectContent>
        {categories.map(category => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
        {directAvailable && <SelectItem value={DIRECT_ACCOUNT_GROUP}>{DIRECT_ACCOUNT_GROUP_LABEL}</SelectItem>}
      </SelectContent>
    </Select>
  )
}

/**
 * Step 2 of the cascade: the eligible accounts of the chosen category, grouped
 * under their subcategory. Subcategories are never required — a category may
 * hold accounts directly.
 */
function AccountSelect({ value, options, hint, grouped, placeholder, className, onChange }: {
  value: string
  options: ManualAccountOption[]
  hint: string | null
  grouped: boolean
  placeholder: string
  className: string
  onChange: (value: string) => void
}) {
  const groups = groupBySubcategory(options, DIRECT_ACCOUNT_GROUP_LABEL)
  const showLabels = grouped && (groups.length > 1 || groups.some(group => group.key !== 'direct'))
  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={onChange} disabled={options.length === 0}>
        <SelectTrigger className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {groups.map(group => (
            <SelectGroup key={group.key}>
              {showLabels && <SelectLabel className="text-[11px] uppercase tracking-wider">{group.label}</SelectLabel>}
              {group.accounts.map(account => (
                <SelectItem key={account.id} value={account.id}><span data-num>{account.code}</span> · {account.name}</SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {hint && <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  )
}
