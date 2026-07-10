'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { formatMoney, parseMoney } from '@/lib/format'
import { toast } from 'sonner'
import { ArrowRight, AlertCircle, CheckCircle2, Wallet } from 'lucide-react'
import { motion } from 'framer-motion'

type Account = {
  id: string
  code: string
  name: string
  isBusinessAccount: boolean
  isPartyAccount: boolean
  partyType: string | null
  balancePaisas: string
}
type Category = {
  id: string
  code: string
  name: string
  type: string
  accounts: Account[]
}

export function OpeningBalanceView() {
  const qc = useQueryClient()
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [side, setSide] = useState<'debit' | 'credit'>('debit')
  const [memo, setMemo] = useState('')
  const [result, setResult] = useState<{ ok: boolean; voucherId?: string; error?: string } | null>(null)

  const coaQ = useQuery<{ categories: Category[] }>({
    queryKey: ['coa'],
    queryFn: () => fetch('/api/setup/coa').then((r) => r.json()),
  })

  const postMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/opening-balance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId, amount, side, memo: memo || undefined }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'POST_FAILED')
      return j
    },
    onSuccess: (j) => {
      toast.success('Opening balance posted via Opening Voucher (OP).')
      setResult({ ok: true, voucherId: j.voucherId })
      void qc.invalidateQueries({ queryKey: ['trial-balance'] })
      void qc.invalidateQueries({ queryKey: ['coa'] })
      setAmount('')
      setMemo('')
    },
    onError: (e: Error) => {
      setResult({ ok: false, error: e.message })
      toast.error(`Opening balance rejected: ${e.message}`)
    },
  })

  const parsedAmount = parseMoney(amount)
  const equityAccount = (coaQ.data?.categories ?? [])
    .flatMap((c) => c.accounts)
    .find((a) => a.code === '3030')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          Opening Balance
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Post an opening balance for any account. The server creates a balanced{' '}
          <strong className="text-foreground">Opening Voucher (OP)</strong> with the target account
          on one side and <strong className="text-foreground">Opening Balance Equity (3030)</strong>{' '}
          on the other — so the Trial Balance is balanced from day one. Opening balances are never
          stored as display-only numbers.
        </p>
      </div>

      <div className="card-3d p-5 sm:p-6">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="h-10 bg-background press-sm">
                <SelectValue placeholder="Select account…" />
              </SelectTrigger>
              <SelectContent>
                {(coaQ.data?.categories ?? []).flatMap((c) =>
                  c.accounts
                    .filter((a) => a.code !== '3030') // can't open the offset against itself
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span data-num>{a.code}</span> · {a.name}
                        {a.isBusinessAccount && ' (Business A/c)'}
                        {a.isPartyAccount && ` (${a.partyType})`}
                      </SelectItem>
                    )),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid sm:grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Amount (PKR)</Label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 50,000"
                className="h-10 bg-background press-sm"
                data-num
              />
              {parsedAmount !== null && parsedAmount > 0n && (
                <p className="text-[11px] text-muted-foreground">
                  Parsed: <span className="font-medium text-foreground" data-num>{formatMoney(parsedAmount)}</span>
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Side</Label>
              <RadioGroup
                value={side}
                onValueChange={(v) => setSide(v as 'debit' | 'credit')}
                className="grid grid-cols-2 gap-2 pt-1.5"
              >
                <Label
                  htmlFor="side-debit"
                  className={`flex items-center gap-2 px-3 h-10 border rounded-lg cursor-pointer press-sm ${
                    side === 'debit'
                      ? 'border-primary bg-accent/60 text-foreground'
                      : 'border-border bg-background text-muted-foreground'
                  }`}
                >
                  <RadioGroupItem id="side-debit" value="debit" />
                  <span className="text-sm font-medium">Debit</span>
                </Label>
                <Label
                  htmlFor="side-credit"
                  className={`flex items-center gap-2 px-3 h-10 border rounded-lg cursor-pointer press-sm ${
                    side === 'credit'
                      ? 'border-primary bg-accent/60 text-foreground'
                      : 'border-border bg-background text-muted-foreground'
                  }`}
                >
                  <RadioGroupItem id="side-credit" value="credit" />
                  <span className="text-sm font-medium">Credit</span>
                </Label>
              </RadioGroup>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Memo (optional)</Label>
            <Textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="e.g. Opening balance as of 1 July 2026"
              className="bg-background press-sm min-h-[60px]"
            />
          </div>

          {/* Preview of the balanced voucher that will be posted */}
          {accountId && parsedAmount !== null && parsedAmount > 0n && equityAccount && (
            <div className="card-3d bg-muted/30 p-4">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                Preview — Opening Voucher (OP)
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left pb-1.5 font-medium">Account</th>
                    <th className="text-right pb-1.5 font-medium">Debit</th>
                    <th className="text-right pb-1.5 font-medium">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1 text-foreground" data-num>
                      {coaQ.data?.categories.flatMap((c) => c.accounts).find((a) => a.id === accountId)?.code}{' '}
                      · {coaQ.data?.categories.flatMap((c) => c.accounts).find((a) => a.id === accountId)?.name}
                    </td>
                    <td className="py-1 text-right text-foreground" data-num>
                      {side === 'debit' ? formatMoney(parsedAmount, false) : '—'}
                    </td>
                    <td className="py-1 text-right text-foreground" data-num>
                      {side === 'credit' ? formatMoney(parsedAmount, false) : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 text-foreground" data-num>
                      3030 · Opening Balance Equity
                    </td>
                    <td className="py-1 text-right text-foreground" data-num>
                      {side === 'credit' ? formatMoney(parsedAmount, false) : '—'}
                    </td>
                    <td className="py-1 text-right text-foreground" data-num>
                      {side === 'debit' ? formatMoney(parsedAmount, false) : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-2 pt-2 border-t border-border text-[11px] text-primary flex items-center gap-1.5">
                <CheckCircle2 className="size-3" /> Balanced: total debit = total credit ={' '}
                <span data-num>{formatMoney(parsedAmount, false)}</span>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => postMut.mutate()}
              disabled={postMut.isPending || !accountId || parsedAmount === null || parsedAmount <= 0n}
              className="press-md shadow-sm"
            >
              {postMut.isPending ? (
                'Posting…'
              ) : (
                <>
                  <ArrowRight className="size-4" /> Post Opening Voucher
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Result */}
      {result && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className={`card-3d p-5 ${
            result.ok ? 'border-primary/40' : 'border-destructive/40'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`grid place-items-center size-9 rounded-xl shrink-0 ${
                result.ok ? 'icon-3d' : 'bg-destructive/10'
              }`}
            >
              {result.ok ? (
                <CheckCircle2 className="size-4 text-primary-foreground" />
              ) : (
                <AlertCircle className="size-4 text-destructive" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div
                className={`text-sm font-semibold ${
                  result.ok ? 'text-primary' : 'text-destructive'
                }`}
              >
                {result.ok ? 'Opening Voucher posted' : 'Rejected'}
              </div>
              {result.ok ? (
                <>
                  <p className="text-xs text-muted-foreground mt-1">
                    Voucher ID: <span className="font-mono" data-num>{result.voucherId}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Open Trial Balance — both the target account and Opening Balance Equity will
                    show the offsetting debit/credit.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">{result.error}</p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Guidance */}
      <div className="card-3d border-primary/30 p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-3">
          <Wallet className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-primary">Test the Opening Voucher</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Pick e.g. <strong className="text-foreground">1010 · Cash</strong>, amount{' '}
          <strong className="text-foreground" data-num>50,000</strong>, side{' '}
          <strong className="text-foreground">Debit</strong>. The server will post:
        </p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
            <span>
              Debit Cash (1010) Rs 50,000 — increases the business account&apos;s balance
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
            <span>
              Credit Opening Balance Equity (3030) Rs 50,000 — offsets so the voucher balances
            </span>
          </li>
        </ul>
      </div>
    </div>
  )
}
