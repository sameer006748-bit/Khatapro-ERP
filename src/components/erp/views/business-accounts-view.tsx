'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Business Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Each business account has a 1:1 linked ledger account under Asset. Balance is derived
            from voucher lines (Phase 2+); currently 0 because no vouchers exist.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'New business account'}</Button>
        )}
      </div>

      {open && canManage && (
        <Card className="bg-card">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-base">Create business account</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <CreateForm
              submitting={createMut.isPending}
              onSubmit={(v) => createMut.mutate(v)}
            />
          </CardContent>
        </Card>
      )}

      <Card className="bg-card">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base">
            Accounts <span className="text-muted-foreground text-xs ml-2" data-num>{q.data?.rows.length ?? 0}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : q.data?.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="text-left p-3">Name</th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-left p-3">Holder / Bank / A/c#</th>
                    <th className="text-left p-3">Ledger</th>
                    <th className="text-right p-3">Balance</th>
                    <th className="text-left p-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-accent/20">
                      <td className="p-3">
                        <div className="font-medium">{r.name}</div>
                        {!r.isActive && (
                          <span className="text-[10px] uppercase text-destructive">Inactive</span>
                        )}
                      </td>
                      <td className="p-3">{r.type}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        <div>{r.accountHolder ?? '—'}</div>
                        <div>{r.bankName ?? ''}</div>
                        <div data-num>{r.accountNumber ?? ''}</div>
                      </td>
                      <td className="p-3 text-xs">
                        <div className="font-medium" data-num>{r.ledger.code}</div>
                        <div className="text-muted-foreground">{r.ledger.name}</div>
                        <div className="text-muted-foreground">{r.ledger.category}</div>
                      </td>
                      <td className="p-3 text-right" data-num>
                        {formatMoney(BigInt(r.ledger.balancePaisas))}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground" data-num>
                        {formatTableDate(r.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">
              No business accounts yet. Create one to see the linked ledger account appear.
            </div>
          )}
        </CardContent>
      </Card>
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
      className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3"
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
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required className="bg-background" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Type</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="bg-background">
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
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Account holder
        </Label>
        <Input value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} className="bg-background" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Bank name</Label>
        <Input value={bankName} onChange={(e) => setBankName(e.target.value)} className="bg-background" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Account number
        </Label>
        <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="bg-background" data-num />
      </div>
      <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create account'}
        </Button>
      </div>
    </form>
  )
}
