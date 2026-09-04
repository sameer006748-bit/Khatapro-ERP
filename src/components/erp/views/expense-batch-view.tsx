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
  BUSINESS_ACCOUNT_TYPES,
  moneyTypeFromLedgerAccount,
  normalizeBusinessAccountType,
} from '@/lib/accounting/business-account-types'
import { deriveMoneyIdentity, moneyAccountContext } from '@/lib/accounting/money-account-identity'
import {
  CLASSIFICATION_LOAD_ERROR,
  CLASSIFICATION_QUERY_KEY,
  CLASSIFICATION_STALE_TIME_MS,
  NO_EXPENSE_CATEGORIES_MESSAGE,
  OTHER_EXPENSE_ACCOUNTS_LABEL,
  expenseAccountChoices,
  expenseChoiceGroups,
  fetchClassificationTree,
  findExpenseChoice,
  rootByType,
  type ExpenseChoiceGroup,
} from '@/lib/accounting/classification-client'

type Account = { id: string; code: string; name: string; categoryType: string; isBusinessAccount: boolean }

/** One account the batch can be paid from, as the picker reads it. */
type PaymentAccount = { id: string; name: string; context: string }

/**
 * One line is one expense: the category it belongs to, what it was for, and how
 * much. `choice` holds the picked category — or, for an account that never had a
 * category, that account. Which ledger account either resolves to is decided by
 * the server, never here.
 */
type ExpenseLine = {
  key: string
  choice: string
  description: string
  amount: string
}

const emptyLine = (key: string): ExpenseLine => ({ key, choice: '', description: '', amount: '' })

export function ExpenseBatchView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [expenseDate, setExpenseDate] = useState(bizDateString(new Date()))
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [lines, setLines] = useState<ExpenseLine[]>([emptyLine('1')])
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<{ ok: boolean; expenseNo?: string; error?: string } | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  // Both loads are setup data that only changes through an explicit action in
  // this app, and both are shared with other screens under these keys — so they
  // are fetched once, in parallel, and reused instead of refetched on every
  // revisit. The setup screen invalidates both keys after a classification
  // change, which overrides the cache lifetime.
  const coaQ = useQuery<any>({ queryKey: ['coa'], queryFn: ({ signal }) => apiFetchJson<any>('/api/setup/coa', { signal }), staleTime: 300_000 })
  // Resolves to null on a deployment without the classification layer; the plain
  // account list below then behaves exactly as it did before categories existed.
  const classQ = useQuery({
    queryKey: CLASSIFICATION_QUERY_KEY,
    queryFn: ({ signal }) => fetchClassificationTree(signal),
    staleTime: CLASSIFICATION_STALE_TIME_MS,
  })

  const accounts: Account[] = useMemo(() => (coaQ.data?.categories ?? []).flatMap((c: any) => c.accounts.filter((a: any) => a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name, categoryType: c.type, isBusinessAccount: a.isBusinessAccount === true }))), [coaQ.data])

  // Paid From offers money accounts only — the Cash and Bank accounts the
  // business actually holds money in. Other Asset accounts (inventory, customer
  // receivables) are rejected by the server, so they are not offered here.
  const moneyAccountsQ = useQuery<{ rows?: Array<{ type?: string; identity?: string | null; ledger?: { code?: string | null } | null }> }>({
    queryKey: ['business-accounts'],
    queryFn: ({ signal }) => apiFetchJson('/api/setup/business-accounts', { signal }),
    staleTime: 300_000,
    retry: false,
  })
  const moneyMeta = useMemo(() => {
    const byLedgerCode = new Map<string, { type: string; identity: string | null }>()
    for (const row of moneyAccountsQ.data?.rows ?? []) {
      const code = row?.ledger?.code
      if (!code) continue
      byLedgerCode.set(code, {
        type: typeof row.type === 'string' ? row.type : '',
        identity: typeof row.identity === 'string' && row.identity.trim() ? row.identity : null,
      })
    }
    return byLedgerCode
  }, [moneyAccountsQ.data?.rows])

  /**
   * The accounts to pay from, under the two money headings. The name leads and
   * the readable identity follows it — an internal id is never shown, and the
   * numeric ledger code is not what an owner recognises the account by.
   */
  const paymentGroups: Array<{ type: string; rows: PaymentAccount[] }> = useMemo(() => {
    const rows = accounts
      .filter(a => a.categoryType === 'Asset' && a.isBusinessAccount)
      .map(a => {
        const meta = moneyMeta.get(a.code)
        const type = meta?.type ? normalizeBusinessAccountType(meta.type) : moneyTypeFromLedgerAccount(a)
        const identity = meta?.identity ?? deriveMoneyIdentity({ name: a.name, type, ledgerCode: a.code })
        return { id: a.id, name: a.name, type, context: moneyAccountContext(type, identity) }
      })
    return BUSINESS_ACCOUNT_TYPES
      .map(type => ({ type, rows: rows.filter(row => row.type === type) }))
      .filter(group => group.rows.length > 0)
  }, [accounts, moneyMeta])
  const paymentAccountCount = paymentGroups.reduce((count, group) => count + group.rows.length, 0)
  // Fallback list: system-managed accounts are posted by their own workflows, and
  // cash/bank or party accounts are never manual expense destinations.
  const flatExpenseAccounts = useMemo(() => (coaQ.data?.categories ?? [])
    .filter((c: any) => c.type === 'Expense')
    .flatMap((c: any) => (c.accounts ?? []).filter((a: any) => a.isActive && !a.isSystem && !a.isBusinessAccount && !a.isPartyAccount))
    .map((a: any) => ({ id: a.id, code: a.code, name: a.name })), [coaQ.data])

  const tree = classQ.data ?? null
  const expenseRootId = useMemo(() => rootByType(tree, 'Expense')?.id ?? null, [tree])
  // What a line may be posted against, derived once per loaded tree. Categories
  // first; the plain accounts of a deployment without a classification layer are
  // offered under the same picker so nothing that used to post stops posting.
  const choiceGroups: ExpenseChoiceGroup[] = useMemo(() => {
    const grouped = expenseChoiceGroups(tree, expenseRootId)
    if (grouped.length > 0) return grouped
    const fallback = expenseAccountChoices(flatExpenseAccounts)
    return fallback.length > 0 ? [{ key: 'accounts', label: OTHER_EXPENSE_ACCOUNTS_LABEL, choices: fallback }] : []
  }, [tree, expenseRootId, flatExpenseAccounts])

  const total = lines.reduce((s, l) => s + (parseMoney(l.amount) ?? 0n), 0n)

  function addLine() { setLines(ls => [...ls, emptyLine(String(Date.now()))]) }
  function removeLine(key: string) { setLines(ls => ls.length <= 1 ? ls : ls.filter(l => l.key !== key)) }
  function updateLine(key: string, field: keyof ExpenseLine, value: string) { setLines(ls => ls.map(l => l.key === key ? { ...l, [field]: value } : l)) }
  const mut = useMutation({
    mutationFn: async () => {
      const validLines = lines
        .map(l => ({ line: l, choice: findExpenseChoice(choiceGroups, l.choice) }))
        .filter(({ line, choice }) => choice && ((parseMoney(line.amount) ?? 0n) > 0n))
      const r = await fetch('/api/expense-batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expenseDate,
          paymentAccountId,
          lines: validLines.map(({ line, choice }) => ({
            categoryId: choice?.categoryId,
            expenseAccountId: choice?.expenseAccountId,
            description: line.description || undefined,
            amount: line.amount,
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

  const canPost = paymentAccountId && lines.length >= 1 && lines.every(l => l.choice && (parseMoney(l.amount) ?? 0n) > 0n) && total > 0n

  /**
   * What each line still needs, so the message can sit next to the field it is
   * about instead of one notice for the whole batch. Shown once the owner has
   * tried to post — an untouched form is not an error.
   */
  const lineIssues = useMemo(() => {
    const issues = new Map<string, { choice?: string; amount?: string }>()
    for (const line of lines) {
      const issue: { choice?: string; amount?: string } = {}
      if (!line.choice) issue.choice = 'Pick an expense category.'
      const amount = parseMoney(line.amount)
      if (!line.amount.trim()) issue.amount = 'Enter the amount.'
      else if (amount === null) issue.amount = 'Enter a plain number, like 1250.00'
      else if (amount <= 0n) issue.amount = 'Amount must be more than zero.'
      if (issue.choice || issue.amount) issues.set(line.key, issue)
    }
    return issues
  }, [lines])
  const paymentIssue = paymentAccountId ? null : 'Choose the account this batch was paid from.'

  function attemptPost() {
    if (canPost) {
      mut.mutate()
      return
    }
    setAttempted(true)
    toast.error(paymentIssue ?? 'Every line needs a category and an amount.')
  }

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

  if (paymentAccountCount === 0 || choiceGroups.length === 0) {
    return (
      <StatePanel>
        <AlertCircle className="size-8 mx-auto mb-3 text-amber-500" />
        {paymentAccountCount === 0
          ? 'No active Cash or Bank account to pay from.'
          : tree ? NO_EXPENSE_CATEGORIES_MESSAGE : 'No eligible expense accounts configured.'}
      </StatePanel>
    )
  }

  if (result?.ok) return (
    <div className="card-3d p-6 max-w-md mx-auto text-center">
      <CheckCircle2 className="size-12 text-primary mx-auto mb-3" />
      <p className="text-xs text-muted-foreground mb-1">Expense Batch Posted</p>
      <p className="text-2xl font-bold text-primary" data-num>{result.expenseNo}</p>
      <Button variant="ghost" size="sm" className="mt-4" onClick={() => { setResult(null); setAttempted(false); setLines([emptyLine('1')]); setReference(''); setNotes(''); setIdempotencyKey(crypto.randomUUID()) }}>New Batch</Button>
    </div>
  )
  return (
    <div className="space-y-4">
      <PageHeader compact title="Expense Batch" description="Record several expense lines paid from one business account." />

      {/* Header: when, paid from, and the two optional references. */}
      <div className="card-3d p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Date</Label>
            <Input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className="h-9 bg-background" data-num />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Paid From</Label>
            <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
              <SelectTrigger className={`h-9 bg-background ${attempted && paymentIssue ? 'border-destructive' : ''}`} aria-invalid={Boolean(attempted && paymentIssue)}>
                <SelectValue placeholder="Select account…" />
              </SelectTrigger>
              <SelectContent>
                {paymentGroups.map(group => (
                  <SelectGroup key={group.type}>
                    {paymentGroups.length > 1 && <SelectLabel className="text-[11px] uppercase tracking-wider">{group.type}</SelectLabel>}
                    {group.rows.map(row => (
                      <SelectItem key={row.id} value={row.id}>
                        <span className="flex flex-col items-start leading-tight">
                          <span>{row.name}</span>
                          <span className="text-[10px] text-muted-foreground">{row.context}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {attempted && paymentIssue && <FieldError>{paymentIssue}</FieldError>}
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Reference</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" className="h-9 bg-background" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className="h-9 bg-background" />
          </div>
        </div>
      </div>

      {/* Lines */}
      <div className="card-3d overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-foreground">
            Expense lines <span className="ml-1 text-xs font-normal text-muted-foreground" data-num>({lines.length})</span>
          </h2>
          <Button variant="outline" size="sm" onClick={addLine} className="press-sm h-8"><Plus className="size-3.5" /> Add line</Button>
        </div>
        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-[40%] p-3 text-left font-medium">Expense Category</th>
              <th className="p-3 text-left font-medium">Description</th>
              <th className="w-40 p-3 text-right font-medium">Amount (Rs)</th>
              <th className="w-12 p-3 text-center font-medium"><span className="sr-only">Remove</span></th>
            </tr></thead>
            <tbody>
              {lines.map((line, i) => {
                const issue = attempted ? lineIssues.get(line.key) : undefined
                return (
                  <tr key={line.key} className="border-b border-border/60 align-top last:border-0">
                    <td className="p-3">
                      <ChoiceSelect value={line.choice} groups={choiceGroups} invalid={Boolean(issue?.choice)} className="h-9 w-full bg-background" onChange={v => updateLine(line.key, 'choice', v)} />
                      {issue?.choice && <FieldError>{issue.choice}</FieldError>}
                    </td>
                    <td className="p-3">
                      <Input value={line.description} onChange={e => updateLine(line.key, 'description', e.target.value)} placeholder="What was it for? (optional)" className="h-9 bg-background" />
                    </td>
                    <td className="p-3">
                      <Input type="text" inputMode="decimal" value={line.amount} onChange={e => updateLine(line.key, 'amount', e.target.value)} placeholder="0.00" aria-label={`Amount for line ${i + 1}`} aria-invalid={Boolean(issue?.amount)} className={`h-9 bg-background text-right ${issue?.amount ? 'border-destructive' : ''}`} data-num />
                      {issue?.amount && <FieldError>{issue.amount}</FieldError>}
                    </td>
                    <td className="p-3 text-center">
                      <button type="button" onClick={() => removeLine(line.key)} disabled={lines.length <= 1} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/5 hover:text-destructive disabled:opacity-30 disabled:hover:bg-transparent" title={lines.length <= 1 ? 'A batch keeps at least one line' : 'Remove this line'} aria-label={`Remove line ${i + 1}`}><Trash2 className="size-4" /></button>
                    </td>
                  </tr>
                )
              })}
              <tr>
                <td colSpan={4} className="p-3">
                  <button type="button" onClick={addLine} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground">
                    <Plus className="size-3.5" /> Add another line
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* Mobile: one stacked card per line, full width so nothing clips. */}
        <div className="divide-y divide-border/60 md:hidden">
          {lines.map((line, i) => {
            const issue = attempted ? lineIssues.get(line.key) : undefined
            return (
              <div key={line.key} className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Line {i + 1}</span>
                  <button type="button" onClick={() => removeLine(line.key)} disabled={lines.length <= 1} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-destructive/5 hover:text-destructive disabled:opacity-30 disabled:hover:bg-transparent" aria-label={`Remove line ${i + 1}`}>
                    <Trash2 className="size-3.5" /> Remove
                  </button>
                </div>
                <ChoiceSelect value={line.choice} groups={choiceGroups} invalid={Boolean(issue?.choice)} className="h-10 w-full bg-background" onChange={v => updateLine(line.key, 'choice', v)} />
                {issue?.choice && <FieldError>{issue.choice}</FieldError>}
                <Input value={line.description} onChange={e => updateLine(line.key, 'description', e.target.value)} placeholder="What was it for? (optional)" className="h-10 bg-background" />
                <Input type="text" inputMode="decimal" value={line.amount} onChange={e => updateLine(line.key, 'amount', e.target.value)} placeholder="Amount (Rs)" aria-label={`Amount for line ${i + 1}`} aria-invalid={Boolean(issue?.amount)} className={`h-10 bg-background text-right ${issue?.amount ? 'border-destructive' : ''}`} data-num />
                {issue?.amount && <FieldError>{issue.amount}</FieldError>}
              </div>
            )
          })}
          <div className="p-4">
            <button type="button" onClick={addLine} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground">
              <Plus className="size-3.5" /> Add another line
            </button>
          </div>
        </div>
      </div>
      {result && !result.ok && (
        <div className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-[1px] size-3.5 shrink-0" /> {result.error}
        </div>
      )}

      {/* Bottom: the total, and the one action this screen exists for. */}
      <div className="card-3d flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
          <div className={`text-2xl font-semibold ${total > 0n ? 'text-foreground' : 'text-muted-foreground'}`} data-num>{formatMoney(total)}</div>
          <div className="text-[11px] text-muted-foreground" data-num>{lines.length} line{lines.length === 1 ? '' : 's'}</div>
        </div>
        <Button onClick={attemptPost} disabled={mut.isPending} className="press-md h-12 w-full px-6 text-base font-semibold shadow-sm sm:w-auto">
          {mut.isPending ? 'Posting…' : <><ArrowRight className="size-4" /> Post Expense Batch</>}
        </Button>
      </div>
    </div>
  )
}

/** A short, specific message directly under the field it is about. */
function FieldError({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
      <AlertCircle className="mt-[1px] size-3 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
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

/**
 * The one thing a line asks for. Normally a list of the business's own expense
 * categories; the second group appears only where accounts without a category
 * still exist, and its group labels are hidden while there is nothing to tell
 * apart.
 */
function ChoiceSelect({ value, groups, className, invalid, onChange }: {
  value: string
  groups: ExpenseChoiceGroup[]
  className: string
  invalid?: boolean
  onChange: (value: string) => void
}) {
  const showLabels = groups.length > 1
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`${className}${invalid ? ' border-destructive' : ''}`} aria-invalid={invalid}><SelectValue placeholder="Select category…" /></SelectTrigger>
      <SelectContent>
        {groups.map(group => (
          <SelectGroup key={group.key}>
            {showLabels && <SelectLabel className="text-[11px] uppercase tracking-wider">{group.label}</SelectLabel>}
            {group.choices.map(choice => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.code ? <><span data-num>{choice.code}</span> · {choice.label}</> : choice.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
