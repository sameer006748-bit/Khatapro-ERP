'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Wallet, ArrowDownToLine, ArrowUpFromLine, Receipt as ReceiptIcon, ArrowLeftRight, Coffee, Settings2, TrendingUp, TrendingDown, BookOpen, ChevronRight, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { formatMoney, parseMoney } from '@/lib/format'
import { bizDate } from '@/lib/dates'
import { motion, AnimatePresence } from 'framer-motion'
import type { MeUser } from '@/components/erp/erp-app'

type Account = { id: string; code: string; name: string; isBusinessAccount: boolean; isPartyAccount: boolean; partyType: string | null; categoryCode: string; categoryType: string }
type Category = { id: string; code: string; name: string; type: string; accounts: Account[] }

const BUSINESS_ACCOUNT_ICONS: Record<string, string> = {
  '1010': '💵', '1020': '🪙', '1030': '🏦', '1040': '📱', '1050': '📲',
}

export function AccountsView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const [entryModal, setEntryModal] = useState<null | 'receive' | 'pay' | 'expense' | 'transfer' | 'petty-topup' | 'petty-expense' | 'adjustment'>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const coaQ = useQuery({ queryKey: ['coa'], queryFn: () => fetch('/api/setup/coa').then(r => r.json()) })
  const accounts: Account[] = useMemo(() => (coaQ.data?.categories ?? []).flatMap((c: any) => c.accounts.filter((a: any) => a.isActive).map((a: any) => ({ id: a.id, code: a.code, name: a.name, isBusinessAccount: a.isBusinessAccount, isPartyAccount: a.isPartyAccount, partyType: a.partyType, categoryCode: c.code, categoryType: c.type }))), [coaQ.data])
  const businessAccounts = accounts.filter(a => a.categoryType === 'Asset' && a.isBusinessAccount)
  const expenseAccounts = accounts.filter(a => a.categoryType === 'Expense')

  // Trial balance for balances
  const tbQ = useQuery({ queryKey: ['trial-balance'], queryFn: () => fetch('/api/trial-balance').then(r => r.json()) })
  const tbRows: any[] = tbQ.data?.rows ?? []
  const getBalance = (code: string): bigint => {
    const row = tbRows.find((r: any) => r.accountCode === code)
    return row ? BigInt(row.balance) : 0n
  }

  // Day book for recent activity
  const dayBookQ = useQuery({ queryKey: ['day-book'], queryFn: () => fetch('/api/day-book').then(r => r.json()) })
  const recentVouchers: any[] = (dayBookQ.data?.rows ?? []).slice(0, 15)

  // Today's summary (Asia/Karachi date)
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
  const todayVouchers = recentVouchers.filter((v: any) => v.voucherDate === todayStr)
  const moneyInToday = todayVouchers.filter((v: any) => v.voucherType === 'RC').reduce((s: bigint, v: any) => s + BigInt(v.totalDebit), 0n)
  const moneyOutToday = todayVouchers.filter((v: any) => v.voucherType === 'PM').reduce((s: bigint, v: any) => s + BigInt(v.totalDebit), 0n)
  const expensesToday = todayVouchers.filter((v: any) => v.voucherType === 'EX').reduce((s: bigint, v: any) => s + BigInt(v.totalDebit), 0n)

  // Business-friendly classification of already-loaded vouchers.
  // Only voucher types with a reliable meaning are classified; everything
  // else stays in Advanced Account Activity.
  const postedVouchers = recentVouchers.filter((v: any) => !v.isCancelled)
  const inflowVouchers = postedVouchers.filter((v: any) => v.voucherType === 'RC')
  const outflowVouchers = postedVouchers.filter((v: any) => v.voucherType === 'PM' || v.voucherType === 'EX')
  const inflowTotal = inflowVouchers.reduce((s: bigint, v: any) => s + BigInt(v.totalDebit), 0n)
  const outflowTotal = outflowVouchers.reduce((s: bigint, v: any) => s + BigInt(v.totalCredit), 0n)

  // Pending: standard receivable/payable control accounts from trial balance
  const receivablesBal = getBalance('1200')
  const payablesBal = getBalance('2010') + getBalance('2020')
  const totalAvailable = businessAccounts.reduce((s, a) => s + getBalance(a.code), 0n)
  const balancesReady = !tbQ.isLoading && tbRows.length > 0

  const canPostReceipt = user.permissions.includes('can_create_receipt_voucher')
  const canPostPayment = user.permissions.includes('can_create_payment_voucher')
  const canPostExpense = user.permissions.includes('can_create_expense_batch')
  const canPostContra = user.permissions.includes('can_create_contra')
  const canManagePetty = user.permissions.includes('can_manage_petty_cash')
  const canPostJournal = user.permissions.includes('can_create_journal_voucher')

  function openLedger(accountId: string) {
    window.history.pushState({}, '', `/?ledger=${accountId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Money Summary</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Aap ke paas abhi kitna paisa hai, kahan se aya, kahan gaya aur kya pending hai</p>
        </div>
        <Button size="sm" className="h-8 press-sm shadow-sm" onClick={() => setEntryModal('receive')}><Plus className="size-3.5" /> New Entry</Button>
      </div>

      {/* Current Money */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-2">Current Money</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          {(coaQ.isLoading || tbQ.isLoading) && businessAccounts.length === 0 && [1, 2, 3, 4, 5].map(i => (
            <div key={i} className="border border-border rounded-lg bg-card p-3 animate-pulse" role="status" aria-label="Loading balances">
              <div className="h-5 w-5 rounded bg-muted mb-2" />
              <div className="h-2.5 w-16 rounded bg-muted mb-2" />
              <div className="h-4 w-20 rounded bg-muted" />
            </div>
          ))}
          {businessAccounts.map(a => {
            const bal = getBalance(a.code)
            const icon = BUSINESS_ACCOUNT_ICONS[a.code] ?? '💼'
            const isNegative = bal < 0n
            return (
              <div key={a.id} className={`border rounded-lg bg-card p-3 cursor-pointer hover:bg-muted/20 press-sm ${isNegative ? 'border-amber-300' : 'border-border'}`} onClick={() => openLedger(a.id)}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-lg">{icon}</span>
                  {isNegative && <span className="text-[8px] uppercase bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-medium">Overdrawn</span>}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{a.name}</div>
                <div className={`text-base font-bold ${isNegative ? 'text-amber-700' : 'text-foreground'}`} data-num>{formatMoney(bal)}</div>
              </div>
            )
          })}
          {balancesReady && businessAccounts.length > 0 && (
            <div className="border border-primary/40 rounded-lg bg-card p-3">
              <div className="flex items-center justify-between mb-1"><span className="text-lg">💰</span></div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">Total Available</div>
              <div className={`text-base font-bold ${totalAvailable < 0n ? 'text-amber-700' : 'text-primary'}`} data-num>{formatMoney(totalAvailable)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Daily summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SummaryCard icon={TrendingUp} label="Money In Today" value={formatMoney(moneyInToday)} color="text-emerald-600" />
        <SummaryCard icon={TrendingDown} label="Money Out Today" value={formatMoney(moneyOutToday)} color="text-amber-600" />
        <SummaryCard icon={ReceiptIcon} label="Expenses Today" value={formatMoney(expensesToday)} color="text-rose-600" />
        <SummaryCard icon={Wallet} label="Net Movement" value={formatMoney(moneyInToday - moneyOutToday - expensesToday)} color={moneyInToday - moneyOutToday - expensesToday >= 0n ? 'text-emerald-600' : 'text-amber-600'} />
      </div>

      {/* Paisa Kahan Se Aya / Kahan Gaya (recent, from loaded day book) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="border border-border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Paisa Kahan Se Aya</h2>
            <span className="text-xs font-medium text-emerald-600" data-num>{formatMoney(inflowTotal)}</span>
          </div>
          <div className="divide-y divide-border/40">
            {dayBookQ.isLoading && <p className="p-3 text-xs text-muted-foreground" role="status">Loading…</p>}
            {!dayBookQ.isLoading && inflowVouchers.length === 0 && <p className="p-3 text-xs text-muted-foreground">Koi recent received entry nahi</p>}
            {inflowVouchers.slice(0, 6).map((v: any) => (
              <div key={v.voucherId} className="px-4 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0"><div className="text-sm text-foreground truncate">{v.memo || 'Money received'}</div><div className="text-[10px] text-muted-foreground" data-num>{bizDate(v.voucherDate)}</div></div>
                <span className="text-sm font-medium text-emerald-600 shrink-0" data-num>+{formatMoney(BigInt(v.totalDebit), false)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="border border-border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Paisa Kahan Gaya</h2>
            <span className="text-xs font-medium text-amber-600" data-num>{formatMoney(outflowTotal)}</span>
          </div>
          <div className="divide-y divide-border/40">
            {dayBookQ.isLoading && <p className="p-3 text-xs text-muted-foreground" role="status">Loading…</p>}
            {!dayBookQ.isLoading && outflowVouchers.length === 0 && <p className="p-3 text-xs text-muted-foreground">Koi recent payment/expense entry nahi</p>}
            {outflowVouchers.slice(0, 6).map((v: any) => (
              <div key={v.voucherId} className="px-4 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0"><div className="text-sm text-foreground truncate">{v.memo || (v.voucherType === 'EX' ? 'Expense' : 'Payment')}</div><div className="text-[10px] text-muted-foreground" data-num>{bizDate(v.voucherDate)}</div></div>
                <span className="text-sm font-medium text-amber-600 shrink-0" data-num>−{formatMoney(BigInt(v.totalCredit), false)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Abhi Kya Pending Hai */}
      {balancesReady && (
        <div className="border border-border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border"><h2 className="text-sm font-semibold text-foreground">Abhi Kya Pending Hai</h2></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/40">
            <div className="p-3 flex items-center justify-between gap-2">
              <div><div className="text-sm text-foreground">Customers se lena hai</div><div className="text-[10px] text-muted-foreground">Receivables</div></div>
              <span className="text-sm font-semibold text-emerald-600" data-num>{formatMoney(receivablesBal)}</span>
            </div>
            <div className="p-3 flex items-center justify-between gap-2">
              <div><div className="text-sm text-foreground">Vendors ko dena hai</div><div className="text-[10px] text-muted-foreground">Payables</div></div>
              <span className="text-sm font-semibold text-amber-600" data-num>{formatMoney(payablesBal)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Primary actions */}
      <div className="flex flex-wrap gap-2">
        {canPostReceipt && <QuickAction icon={ArrowDownToLine} label="Receive Payment" onClick={() => setEntryModal('receive')} />}
        {canPostPayment && <QuickAction icon={ArrowUpFromLine} label="Pay Vendor" onClick={() => setEntryModal('pay')} />}
        {canPostExpense && <QuickAction icon={ReceiptIcon} label="Add Expense" onClick={() => setEntryModal('expense')} />}
        {canPostContra && <QuickAction icon={ArrowLeftRight} label="Transfer Funds" onClick={() => setEntryModal('transfer')} />}
        {canManagePetty && <QuickAction icon={Coffee} label="Petty Cash" onClick={() => setEntryModal('petty-topup')} />}
        {canPostJournal && <QuickAction icon={BookOpen} label="Adjustment" onClick={() => setEntryModal('adjustment')} />}
      </div>

      {/* Advanced Account Activity (technical, collapsed by default) */}
      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <button className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-muted/20 press-sm" onClick={() => setAdvancedOpen(o => !o)}>
          <h2 className="text-sm font-semibold text-foreground">Advanced Account Activity</h2>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">{recentVouchers.length} entries <ChevronRight className={`size-3.5 transition-transform ${advancedOpen ? 'rotate-90' : ''}`} /></span>
        </button>
        {advancedOpen && (<>
        <div className="border-t border-border" />
        {/* Desktop table */}
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-left px-4 py-2 font-medium">Description</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-right px-4 py-2 font-medium">In</th>
                <th className="text-right px-4 py-2 font-medium">Out</th>
                <th className="text-left px-4 py-2 font-medium">Ref</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentVouchers.map((v: any) => {
                const isTransfer = v.voucherType === 'CT'
                const isReceipt = v.voucherType === 'RC'
                const isPayment = v.voucherType === 'PM'
                const isExpense = v.voucherType === 'EX'
                const inAmount = isReceipt ? BigInt(v.totalDebit) : 0n
                const outAmount = (isPayment || isExpense) ? BigInt(v.totalCredit) : 0n
                return (
                  <tr key={v.voucherId} className="border-b border-border/40 last:border-0 hover:bg-muted/20 cursor-pointer" onClick={() => { window.history.pushState({}, '', `/?voucher=${v.voucherId}`); window.dispatchEvent(new PopStateEvent('popstate')) }}>
                    <td className="px-4 py-2 text-xs text-muted-foreground" data-num>{bizDate(v.voucherDate)}</td>
                    <td className="px-4 py-2 text-foreground">{v.memo || v.sourceLabel}</td>
                    <td className="px-4 py-2"><TypeBadge type={v.voucherType} label={v.sourceLabel} /></td>
                    <td className="px-4 py-2 text-right text-emerald-600" data-num>{inAmount > 0n ? formatMoney(inAmount, false) : '—'}</td>
                    <td className="px-4 py-2 text-right text-amber-600" data-num>{outAmount > 0n ? formatMoney(outAmount, false) : '—'}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground" data-num>{v.voucherNo || '—'}</td>
                    <td className="px-4 py-2">{v.isCancelled ? <span className="text-[9px] uppercase bg-red-50 text-red-700 px-1 py-0.5 rounded">Cancelled</span> : <span className="text-[9px] uppercase bg-emerald-50 text-emerald-700 px-1 py-0.5 rounded">Posted</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border/40">
          {recentVouchers.map((v: any) => {
            const isReceipt = v.voucherType === 'RC'
            const isPayment = v.voucherType === 'PM'
            const isExpense = v.voucherType === 'EX'
            const inAmount = isReceipt ? BigInt(v.totalDebit) : 0n
            const outAmount = (isPayment || isExpense) ? BigInt(v.totalCredit) : 0n
            return (
              <div key={v.voucherId} className="p-3" onClick={() => { window.history.pushState({}, '', `/?voucher=${v.voucherId}`); window.dispatchEvent(new PopStateEvent('popstate')) }}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground font-medium truncate">{v.memo || v.sourceLabel}</div>
                    <div className="text-[10px] text-muted-foreground" data-num>{bizDate(v.voucherDate)} · {v.voucherNo || ''}</div>
                  </div>
                  <div className="text-right shrink-0">
                    {inAmount > 0n && <div className="text-sm font-medium text-emerald-600" data-num>+{formatMoney(inAmount, false)}</div>}
                    {outAmount > 0n && <div className="text-sm font-medium text-amber-600" data-num>−{formatMoney(outAmount, false)}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <TypeBadge type={v.voucherType} label={v.sourceLabel} />
                  {v.isCancelled && <span className="text-[9px] uppercase bg-red-50 text-red-700 px-1 py-0.5 rounded">Cancelled</span>}
                </div>
              </div>
            )
          })}
        </div>
        </>)}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {entryModal === 'receive' && <MoneyReceivedModal accounts={accounts} businessAccounts={businessAccounts} onClose={() => setEntryModal(null)} />}
        {entryModal === 'pay' && <MoneyPaidModal accounts={accounts} businessAccounts={businessAccounts} onClose={() => setEntryModal(null)} />}
        {entryModal === 'expense' && <ExpenseModal expenseAccounts={expenseAccounts} businessAccounts={businessAccounts} presetPaidFrom={null} onClose={() => setEntryModal(null)} />}
        {entryModal === 'transfer' && <TransferModal businessAccounts={businessAccounts} presetTo={null} onClose={() => setEntryModal(null)} />}
        {entryModal === 'petty-topup' && <TransferModal businessAccounts={businessAccounts} presetTo={businessAccounts.find(a => a.code === '1020')?.id ?? null} onClose={() => setEntryModal(null)} />}
        {entryModal === 'petty-expense' && <ExpenseModal expenseAccounts={expenseAccounts} businessAccounts={businessAccounts} presetPaidFrom={businessAccounts.find(a => a.code === '1020')?.id ?? null} onClose={() => setEntryModal(null)} />}
        {entryModal === 'adjustment' && <AdjustmentModal accounts={accounts} onClose={() => setEntryModal(null)} />}
      </AnimatePresence>
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; color: string }) {
  return <div className="border border-border rounded-lg bg-card p-3"><div className="flex items-center gap-1.5 mb-1"><Icon className={`size-3 ${color}`} /><span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span></div><div className={`text-sm font-bold ${color}`} data-num>{value}</div></div>
}

function QuickAction({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium hover:bg-muted/20 press-sm"><Icon className="size-3.5 text-primary" /> {label}</button>
}

function TypeBadge({ type, label }: { type: string; label: string }) {
  const colors: Record<string, string> = {
    RC: 'bg-emerald-50 text-emerald-700', PM: 'bg-amber-50 text-amber-700', EX: 'bg-rose-50 text-rose-700',
    CT: 'bg-indigo-50 text-indigo-700', JV: 'bg-violet-50 text-violet-700', SI: 'bg-emerald-50 text-emerald-700',
    PU: 'bg-amber-50 text-amber-700', OP: 'bg-sky-50 text-sky-700', PR: 'bg-rose-50 text-rose-700', SR: 'bg-rose-50 text-rose-700',
  }
  return <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-medium ${colors[type] ?? 'bg-muted text-muted-foreground'}`}>{label}</span>
}

function Shell({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}><motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className={`border border-border rounded-xl bg-card shadow-xl p-5 w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[85vh] overflow-y-auto`} onClick={e => e.stopPropagation()}><div className="flex items-center justify-between mb-4"><div><h3 className="text-sm font-semibold text-foreground">{title}</h3>{subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}</div><button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button></div>{children}</motion.div></div>
}

// Purpose options for Money Received
const RECEIVE_PURPOSES = [
  { code: '1200', label: 'Customer Payment' },
  { code: '3010', label: 'Owner Investment / Capital' },
  { code: '4010', label: 'Sales Income Adjustment' },
  { code: '2010', label: 'Vendor Refund' },
  { code: '5020', label: 'Other Income' },
]

// Purpose options for Money Paid
const PAY_PURPOSES = [
  { code: '2010', label: 'Vendor Payment' },
  { code: '2020', label: 'Office Payable' },
  { code: '1200', label: 'Staff Advance' },
  { code: '3020', label: 'Owner Drawing' },
  { code: '1200', label: 'Customer Refund' },
  { code: '5020', label: 'Other Payment' },
]

function MoneyReceivedModal({ accounts, businessAccounts, onClose }: { accounts: Account[]; businessAccounts: Account[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState('')
  const [receivedIntoId, setReceivedIntoId] = useState('')
  const [purposeCode, setPurposeCode] = useState('1200')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<{ ok: boolean; receiptNo?: string; error?: string } | null>(null)

  const mut = useMutation({
    mutationFn: async () => {
      const creditAccount = accounts.find(a => a.code === purposeCode)
      if (!creditAccount) throw new Error('Invalid purpose')
      const idempotencyKey = `ar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const r = await fetch('/api/receipt-voucher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ receiptDate: date, receivedIntoAccountId: receivedIntoId, creditAccountId: creditAccount.id, amount, reference: reference || undefined, notes: notes || undefined, idempotencyKey }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => { toast.success(`Money received: ${j.receiptNo}`); setResult({ ok: true, receiptNo: j.receiptNo }); void qc.invalidateQueries({ queryKey: ['day-book'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }) },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })
  const amt = parseMoney(amount) ?? 0n
  const canPost = receivedIntoId && amt > 0n
  const creditAccount = accounts.find(a => a.code === purposeCode)

  if (result?.ok) return <Shell title="Money Received" onClose={onClose}><div className="text-center py-4"><CheckCircle2 className="size-12 text-primary mx-auto mb-3" /><p className="text-xs text-muted-foreground mb-1">Receipt posted</p><p className="text-2xl font-bold text-primary" data-num>{result.receiptNo}</p><Button variant="ghost" size="sm" className="mt-4" onClick={() => { setResult(null); setAmount(''); setReference(''); setNotes('') }}>New Receipt</Button></div></Shell>

  return <Shell title="Money Received" subtitle="Record cash, bank or wallet money received" onClose={onClose}>
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 bg-background" data-num /></div>
        <div><Label className="text-xs text-muted-foreground">Amount (Rs)</Label><Input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="h-9 bg-background" data-num /></div>
      </div>
      <div><Label className="text-xs text-muted-foreground">Received Into</Label><Select value={receivedIntoId} onValueChange={setReceivedIntoId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label className="text-xs text-muted-foreground">Received From / Purpose</Label><Select value={purposeCode} onValueChange={setPurposeCode}><SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger><SelectContent>{RECEIVE_PURPOSES.map(p => <SelectItem key={p.label} value={p.code}>{p.label}</SelectItem>)}</SelectContent></Select></div>
      {amt > 0n && creditAccount && <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded border border-border">{formatMoney(amt)} received into <strong>{businessAccounts.find(a => a.id === receivedIntoId)?.name ?? '—'}</strong> from <strong>{creditAccount.name}</strong></div>}
      <div className="text-[10px] text-muted-foreground bg-sky-50 border border-sky-200 rounded p-2">For a payment against a specific invoice, open the invoice and use Receive Payment.</div>
      <div><Label className="text-xs text-muted-foreground">Reference (optional)</Label><Input value={reference} onChange={e => setReference(e.target.value)} className="h-9 bg-background" /></div>
      <div><Label className="text-xs text-muted-foreground">Note (optional)</Label><Input value={notes} onChange={e => setNotes(e.target.value)} className="h-9 bg-background" /></div>
      {result && !result.ok && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
      <Button className="w-full" disabled={!canPost || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : 'Record Money Received'}</Button>
    </div>
  </Shell>
}

function MoneyPaidModal({ accounts, businessAccounts, onClose }: { accounts: Account[]; businessAccounts: Account[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState('')
  const [paidFromId, setPaidFromId] = useState('')
  const [purposeCode, setPurposeCode] = useState('2010')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<{ ok: boolean; paymentNo?: string; error?: string } | null>(null)

  const mut = useMutation({
    mutationFn: async () => {
      const debitAccount = accounts.find(a => a.code === purposeCode)
      if (!debitAccount) throw new Error('Invalid purpose')
      const r = await fetch('/api/payment-voucher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentDate: date, paidFromAccountId: paidFromId, debitAccountId: debitAccount.id, amount, reference: reference || undefined, notes: notes || undefined }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => { toast.success(`Money paid: ${j.paymentNo}`); setResult({ ok: true, paymentNo: j.paymentNo }); void qc.invalidateQueries({ queryKey: ['day-book'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }) },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })
  const amt = parseMoney(amount) ?? 0n
  const canPost = paidFromId && amt > 0n
  const debitAccount = accounts.find(a => a.code === purposeCode)

  if (result?.ok) return <Shell title="Money Paid" onClose={onClose}><div className="text-center py-4"><CheckCircle2 className="size-12 text-primary mx-auto mb-3" /><p className="text-xs text-muted-foreground mb-1">Payment posted</p><p className="text-2xl font-bold text-primary" data-num>{result.paymentNo}</p><Button variant="ghost" size="sm" className="mt-4" onClick={() => { setResult(null); setAmount(''); setReference(''); setNotes('') }}>New Payment</Button></div></Shell>

  return <Shell title="Money Paid" subtitle="Record a payment made from a business account" onClose={onClose}>
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 bg-background" data-num /></div>
        <div><Label className="text-xs text-muted-foreground">Amount (Rs)</Label><Input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="h-9 bg-background" data-num /></div>
      </div>
      <div><Label className="text-xs text-muted-foreground">Paid From</Label><Select value={paidFromId} onValueChange={setPaidFromId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label className="text-xs text-muted-foreground">Paid For / Purpose</Label><Select value={purposeCode} onValueChange={setPurposeCode}><SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger><SelectContent>{PAY_PURPOSES.map(p => <SelectItem key={p.label} value={p.code}>{p.label}</SelectItem>)}</SelectContent></Select></div>
      {amt > 0n && debitAccount && <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded border border-border">{formatMoney(amt)} paid from <strong>{businessAccounts.find(a => a.id === paidFromId)?.name ?? '—'}</strong> for <strong>{debitAccount.name}</strong></div>}
      <div className="text-[10px] text-muted-foreground bg-sky-50 border border-sky-200 rounded p-2">For vendor/purchase payments, use the Purchases → Pay Vendor workflow.</div>
      <div><Label className="text-xs text-muted-foreground">Reference (optional)</Label><Input value={reference} onChange={e => setReference(e.target.value)} className="h-9 bg-background" /></div>
      <div><Label className="text-xs text-muted-foreground">Note (optional)</Label><Input value={notes} onChange={e => setNotes(e.target.value)} className="h-9 bg-background" /></div>
      {result && !result.ok && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
      <Button className="w-full" disabled={!canPost || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : 'Record Money Paid'}</Button>
    </div>
  </Shell>
}

function ExpenseModal({ expenseAccounts, businessAccounts, presetPaidFrom, onClose }: { expenseAccounts: Account[]; businessAccounts: Account[]; presetPaidFrom: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [paidFromId, setPaidFromId] = useState(presetPaidFrom ?? '')
  const [lines, setLines] = useState<Array<{ key: string; expenseAccountId: string; description: string; amount: string }>>([{ key: '1', expenseAccountId: '', description: '', amount: '' }])
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<{ ok: boolean; expenseNo?: string; error?: string } | null>(null)

  const total = lines.reduce((s, l) => s + (parseMoney(l.amount) ?? 0n), 0n)
  const QUICK_CATEGORIES = ['Rent', 'Packing', 'Tea', 'Fuel', 'Loading', 'Delivery', 'Utilities', 'Salary/Wages', 'Repairs', 'Miscellaneous']

  function addLine() { setLines(ls => [...ls, { key: String(Date.now()), expenseAccountId: '', description: '', amount: '' }]) }
  function removeLine(key: string) { setLines(ls => ls.length <= 1 ? ls : ls.filter(l => l.key !== key)) }
  function updateLine(key: string, field: string, value: string) { setLines(ls => ls.map(l => l.key === key ? { ...l, [field]: value } : l)) }

  const mut = useMutation({
    mutationFn: async () => {
      const validLines = lines.filter(l => l.expenseAccountId && ((parseMoney(l.amount) ?? 0n) > 0n))
      const r = await fetch('/api/expense-batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expenseDate: date, paymentAccountId: paidFromId, lines: validLines.map(l => ({ expenseAccountId: l.expenseAccountId, description: l.description || undefined, amount: l.amount })), reference: reference || undefined, notes: notes || undefined }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => { toast.success(`Expenses posted: ${j.expenseNo}`); setResult({ ok: true, expenseNo: j.expenseNo }); void qc.invalidateQueries({ queryKey: ['day-book'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }) },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })
  const canPost = paidFromId && lines.length >= 1 && lines.every(l => l.expenseAccountId && (parseMoney(l.amount) ?? 0n) > 0n) && total > 0n

  if (result?.ok) return <Shell title="Record Expenses" onClose={onClose}><div className="text-center py-4"><CheckCircle2 className="size-12 text-primary mx-auto mb-3" /><p className="text-xs text-muted-foreground mb-1">Expense batch posted</p><p className="text-2xl font-bold text-primary" data-num>{result.expenseNo}</p><Button variant="ghost" size="sm" className="mt-4" onClick={() => { setResult(null); setLines([{ key: '1', expenseAccountId: '', description: '', amount: '' }]); setReference(''); setNotes('') }}>New Batch</Button></div></Shell>

  return <Shell title="Record Expenses" subtitle="One or multiple expenses paid from one account" onClose={onClose} wide>
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 bg-background" data-num /></div>
        <div><Label className="text-xs text-muted-foreground">Paid From</Label><Select value={paidFromId} onValueChange={setPaidFromId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select…" /></SelectTrigger><SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between"><Label className="text-xs text-muted-foreground">Expense Lines ({lines.length})</Label><Button variant="ghost" size="sm" className="h-6 text-xs" onClick={addLine}><Plus className="size-3" /> Add</Button></div>
        {lines.map((l, i) => (
          <div key={l.key} className="border border-border/50 rounded p-2 space-y-2">
            <div className="flex items-center justify-between"><span className="text-[10px] uppercase text-muted-foreground">Line {i + 1}</span><button onClick={() => removeLine(l.key)} disabled={lines.length <= 1} className="text-muted-foreground hover:text-destructive disabled:opacity-30"><X className="size-3" /></button></div>
            <Select value={l.expenseAccountId} onValueChange={v => updateLine(l.key, 'expenseAccountId', v)}><SelectTrigger className="h-8 bg-background text-sm"><SelectValue placeholder="Expense type…" /></SelectTrigger><SelectContent>{expenseAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select>
            <Input value={l.description} onChange={e => updateLine(l.key, 'description', e.target.value)} placeholder="Description (optional)" className="h-8 bg-background text-sm" />
            <Input type="text" value={l.amount} onChange={e => updateLine(l.key, 'amount', e.target.value)} placeholder="Amount (Rs)" className="h-8 bg-background text-sm" data-num />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-border pt-2"><span className="text-xs text-muted-foreground">Total ({lines.length} lines)</span><span className="text-sm font-bold" data-num>{formatMoney(total)}</span></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs text-muted-foreground">Reference</Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
        <div><Label className="text-xs text-muted-foreground">Note</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className="h-9 bg-background" /></div>
      </div>
      {result && !result.ok && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
      <Button className="w-full" disabled={!canPost || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : 'Post Expenses'}</Button>
    </div>
  </Shell>
}

function TransferModal({ businessAccounts, presetTo, onClose }: { businessAccounts: Account[]; presetTo: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState(presetTo ?? '')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<{ ok: boolean; contraNo?: string; error?: string } | null>(null)

  const mut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/contra-entry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contraDate: date, fromAccountId: fromId, toAccountId: toId, amount, reference: reference || undefined, notes: notes || undefined }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => { toast.success(`Transfer posted: ${j.contraNo}`); setResult({ ok: true, contraNo: j.contraNo }); void qc.invalidateQueries({ queryKey: ['day-book'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }) },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })
  const amt = parseMoney(amount) ?? 0n
  const canPost = fromId && toId && amt > 0n && fromId !== toId

  if (result?.ok) return <Shell title="Transfer Money" onClose={onClose}><div className="text-center py-4"><CheckCircle2 className="size-12 text-primary mx-auto mb-3" /><p className="text-xs text-muted-foreground mb-1">Transfer posted</p><p className="text-2xl font-bold text-primary" data-num>{result.contraNo}</p><Button variant="ghost" size="sm" className="mt-4" onClick={() => { setResult(null); setAmount(''); setReference(''); setNotes('') }}>New Transfer</Button></div></Shell>

  return <Shell title="Transfer Money" subtitle="Move funds between Cash, Bank or Wallet accounts" onClose={onClose}>
    <div className="space-y-3">
      <div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 bg-background" data-num /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs text-muted-foreground">From</Label><Select value={fromId} onValueChange={setFromId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select…" /></SelectTrigger><SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs text-muted-foreground">To</Label><Select value={toId} onValueChange={setToId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select…" /></SelectTrigger><SelectContent>{businessAccounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div><Label className="text-xs text-muted-foreground">Amount (Rs)</Label><Input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="h-9 bg-background" data-num /></div>
      {fromId === toId && fromId && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> From and To must differ</div>}
      <div><Label className="text-xs text-muted-foreground">Reference (optional)</Label><Input value={reference} onChange={e => setReference(e.target.value)} className="h-9 bg-background" /></div>
      <div><Label className="text-xs text-muted-foreground">Note (optional)</Label><Input value={notes} onChange={e => setNotes(e.target.value)} className="h-9 bg-background" /></div>
      {result && !result.ok && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
      <Button className="w-full" disabled={!canPost || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : 'Transfer Money'}</Button>
    </div>
  </Shell>
}

function AdjustmentModal({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [accountId, setAccountId] = useState('')
  const [direction, setDirection] = useState<'increase' | 'decrease'>('increase')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<{ ok: boolean; voucherNo?: string; error?: string } | null>(null)

  const mut = useMutation({
    mutationFn: async () => {
      const targetAccount = accounts.find(a => a.id === accountId)
      if (!targetAccount) throw new Error('Invalid account')
      // Use Opening Balance Equity (3030) as the offset account
      const equityAccount = accounts.find(a => a.code === '3030')
      if (!equityAccount) throw new Error('Opening Balance Equity account (3030) not found')
      const amt = parseMoney(amount)
      if (!amt || amt <= 0n) throw new Error('Invalid amount')
      // If increase: Debit target, Credit Equity
      // If decrease: Debit Equity, Credit target
      const lines = direction === 'increase'
        ? [{ accountId: targetAccount.id, debit: amt.toString(), credit: '0', memo: `Increase ${targetAccount.name}` }, { accountId: equityAccount.id, debit: '0', credit: amt.toString(), memo: 'Adjustment offset' }]
        : [{ accountId: equityAccount.id, debit: amt.toString(), credit: '0', memo: 'Adjustment offset' }, { accountId: targetAccount.id, debit: '0', credit: amt.toString(), memo: `Decrease ${targetAccount.name}` }]
      const r = await fetch('/api/journal-voucher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jvDate: date, memo: reason || `Adjustment: ${direction} ${targetAccount.name}`, lines }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Failed'); return j
    },
    onSuccess: (j) => { toast.success(`Adjustment posted: ${j.voucherNo}`); setResult({ ok: true, voucherNo: j.voucherNo }); void qc.invalidateQueries({ queryKey: ['day-book'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }) },
    onError: (e: Error) => { setResult({ ok: false, error: e.message }); toast.error(`Failed: ${e.message}`) },
  })
  const amt = parseMoney(amount) ?? 0n
  const canPost = accountId && amt > 0n && reason

  if (result?.ok) return <Shell title="Adjustment" onClose={onClose}><div className="text-center py-4"><CheckCircle2 className="size-12 text-primary mx-auto mb-3" /><p className="text-xs text-muted-foreground mb-1">Adjustment posted</p><p className="text-2xl font-bold text-primary" data-num>{result.voucherNo}</p><Button variant="ghost" size="sm" className="mt-4" onClick={() => { setResult(null); setAmount(''); setReason('') }}>New Adjustment</Button></div></Shell>

  return <Shell title="Adjustment" subtitle="Advanced correction for accountant use" onClose={onClose}>
    <div className="space-y-3">
      <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">Use only for accounting corrections and adjustments. Offset posts to Opening Balance Equity (3030).</div>
      <div><Label className="text-xs text-muted-foreground">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 bg-background" data-num /></div>
      <div><Label className="text-xs text-muted-foreground">Account</Label><Select value={accountId} onValueChange={setAccountId}><SelectTrigger className="h-9 bg-background"><SelectValue placeholder="Select account…" /></SelectTrigger><SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}><span data-num>{a.code}</span> · {a.name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label className="text-xs text-muted-foreground">Direction</Label><Select value={direction} onValueChange={(v) => setDirection(v as 'increase' | 'decrease')}><SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="increase">Increase account</SelectItem><SelectItem value="decrease">Decrease account</SelectItem></SelectContent></Select></div>
      <div><Label className="text-xs text-muted-foreground">Amount (Rs)</Label><Input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="h-9 bg-background" data-num /></div>
      <div><Label className="text-xs text-muted-foreground">Reason *</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this adjustment needed?" className="h-9 bg-background" /></div>
      {result && !result.ok && <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {result.error}</div>}
      <Button className="w-full" disabled={!canPost || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Posting…' : 'Post Adjustment'}</Button>
    </div>
  </Shell>
}
