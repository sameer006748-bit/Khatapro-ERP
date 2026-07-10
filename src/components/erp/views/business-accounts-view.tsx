'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatMoney, formatTableDate } from '@/lib/format'
import type { MeUser } from '@/components/erp/erp-app'
import { toast } from 'sonner'
import { Wallet, Plus, X, ArrowRight } from 'lucide-react'

type BusinessAccountRow = {
  id: string
  name: string
  type: string
  accountHolder: string | null
  bankName: string | null
  accountNumber: string | null
  isActive: boolean
  createdAt: string
  ledger: {
    id: string
    code: string
    name: string
    category: string
    categoryType: string
    balancePaisas: string
  }
}

const TYPES = ['Cash', 'Petty Cash', 'Bank', 'Easypaisa', 'JazzCash', 'Wallet', 'Custom / Other']

export function BusinessAccountsView({ user }: { user: MeUser }) {
  const qc = useQueryClient()
  const canManage = user.permissions.includes('can_manage_setup')
  const [open, setOpen] = useState(false)

  const q = useQuery<{ rows: BusinessAccountRow[] }>({
    queryKey: ['business-accounts'],
    queryFn: () => fetch('/api/setup/business-accounts').then((r) => r.json()),
  })

  const createMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const r = await fetch('/api/setup/business-accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error ?? 'CREATE_FAILED')
      }
      return r.json()
    },
    onSuccess: () => {
      toast.success('Business account created with linked Asset ledger.')
      void qc.invalidateQueries({ queryKey: ['business-accounts'] })
      void qc.invalidateQueries({ queryKey: ['coa'] })
      setOpen(false)
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            Business Accounts
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
            Each business account has a 1:1 linked ledger account under Asset. Balance is derived
            from voucher lines (Phase 2+); currently 0 because no vouchers exist.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setOpen((v) => !v)} className="press-md shadow-sm">
            {open ? <X className="size-4" /> : <Plus className="size-4" />}
            {open ? 'Close' : 'New business account'}
          </Button>
        )}
      </div>

      {open && canManage && (
        <div className="card-3d p-5 sm:p-6 fade-in">
          <h2 className="text-base font-semibold text-foreground mb-4">Create business account</h2>
          <CreateForm submitting={createMut.isPending} onSubmit={(v) => createMut.mutate(v)} />
        </div>
      )}

      {/* Desktop: table. Mobile: cards. */}
      {q.isLoading ? (
        <div className="card-3d p-8 text-sm text-muted-foreground">Loading…</div>
      ) : q.data?.rows.length ? (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card-3d overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Accounts</h2>
              <span className="text-xs text-muted-foreground" data-num>
                {q.data.rows.length} total
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <th className="text-left p-3.5 font-medium">Name</th>
                    <th className="text-left p-3.5 font-medium">Type</th>
                    <th className="text-left p-3.5 font-medium">Holder / Bank / A/c#</th>
                    <th className="text-left p-3.5 font-medium">Ledger</th>
                    <th className="text-right p-3.5 font-medium">Balance</th>
                    <th className="text-left p-3.5 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors"
                    >
                      <td className="p-3.5">
                        <div className="font-medium text-foreground">{r.name}</div>
                        {!r.isActive && (
                          <span className="text-[10px] uppercase text-destructive">Inactive</span>
                        )}
                      </td>
                      <td className="p-3.5">
                        <span className="inline-block text-xs px-2 py-0.5 bg-muted text-foreground rounded-md">
                          {r.type}
                        </span>
                      </td>
                      <td className="p-3.5 text-xs text-muted-foreground">
                        <div>{r.accountHolder ?? '—'}</div>
                        <div>{r.bankName ?? ''}</div>
                        <div data-num>{r.accountNumber ?? ''}</div>
                      </td>
                      <td className="p-3.5 text-xs">
                        <div className="font-medium text-foreground" data-num>
                          {r.ledger.code}
                        </div>
                        <div className="text-muted-foreground">{r.ledger.name}</div>
                        <div className="text-muted-foreground">{r.ledger.category}</div>
                      </td>
                      <td className="p-3.5 text-right font-medium text-foreground" data-num>
                        {formatMoney(BigInt(r.ledger.balancePaisas))}
                      </td>
                      <td className="p-3.5 text-xs text-muted-foreground" data-num>
                        {formatTableDate(r.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {q.data.rows.map((r) => (
              <div key={r.id} className="card-3d card-3d-hover p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid place-items-center size-10 rounded-xl icon-3d shrink-0">
                      <Wallet className="size-5 text-primary-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{r.name}</div>
                      <span className="inline-block text-[10px] px-1.5 py-0.5 bg-muted text-foreground rounded mt-0.5">
                        {r.type}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Balance
                    </div>
                    <div className="font-semibold text-foreground" data-num>
                      {formatMoney(BigInt(r.ledger.balancePaisas))}
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Ledger
                    </div>
                    <div className="text-foreground font-medium" data-num>
                      {r.ledger.code} · {r.ledger.name}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Created
                    </div>
                    <div className="text-foreground" data-num>
                      {formatTableDate(r.createdAt)}
                    </div>
                  </div>
                  {r.accountNumber && (
                    <div className="col-span-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        A/c #
                      </div>
                      <div className="text-foreground" data-num>
                        {r.accountNumber}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="card-3d p-8 text-center">
          <div className="grid place-items-center size-12 rounded-xl icon-3d-muted mx-auto mb-3">
            <Wallet className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No business accounts yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create one to see the linked ledger account appear.
          </p>
          {canManage && (
            <Button
              variant="outline"
              className="mt-4 press-sm"
              onClick={() => setOpen(true)}
            >
              <Plus className="size-4" /> New business account
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function CreateForm({
  submitting,
  onSubmit,
}: {
  submitting: boolean
  onSubmit: (v: Record<string, unknown>) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<string>('Cash')
  const [accountHolder, setAccountHolder] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')

  return (
    <form
      className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({
          name,
          type,
          accountHolder: accountHolder || undefined,
          bankName: bankName || undefined,
          accountNumber: accountNumber || undefined,
        })
      }}
    >
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required className="h-10 bg-background press-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Type</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-10 bg-background press-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Account holder</Label>
        <Input value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} className="h-10 bg-background press-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Bank name</Label>
        <Input value={bankName} onChange={(e) => setBankName(e.target.value)} className="h-10 bg-background press-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Account number</Label>
        <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="h-10 bg-background press-sm" data-num />
      </div>
      <div className="sm:col-span-2 lg:col-span-3 flex justify-end pt-1">
        <Button type="submit" disabled={submitting} className="press-md shadow-sm">
          {submitting ? 'Creating…' : (
            <>
              <ArrowRight className="size-4" /> Create account
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
