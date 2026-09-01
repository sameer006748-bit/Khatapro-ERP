'use client'

import { useState } from 'react'
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, NotebookTabs } from 'lucide-react'
import { PageHeader } from '@/components/erp/page-header'
import type { MeUser } from '@/components/erp/erp-app'
import { JournalVoucherView } from '@/components/erp/views/journal-voucher-view'
import { PaymentVoucherView, ReceiptVoucherView, ContraEntryView } from '@/components/erp/views/voucher-forms-view'

type VoucherTab = 'journal' | 'receipt' | 'payment' | 'contra'

const TABS: Array<{ id: VoucherTab; label: string; permission: string; icon: typeof NotebookTabs }> = [
  { id: 'journal', label: 'Journal', permission: 'can_create_journal_voucher', icon: NotebookTabs },
  { id: 'receipt', label: 'Receipt', permission: 'can_create_receipt_voucher', icon: ArrowDownToLine },
  { id: 'payment', label: 'Payment', permission: 'can_create_payment_voucher', icon: ArrowUpFromLine },
  { id: 'contra', label: 'Contra', permission: 'can_create_contra', icon: ArrowLeftRight },
]

export function VouchersView({ user, initialTab = 'journal' }: { user: MeUser; initialTab?: VoucherTab }) {
  const allowedTabs = TABS.filter(tab => user.permissions.includes(tab.permission))
  const [tab, setTab] = useState<VoucherTab>(allowedTabs.some(item => item.id === initialTab) ? initialTab : allowedTabs[0]?.id ?? 'journal')

  return <div className="space-y-4">
    <PageHeader compact title="Vouchers" description="Record and review supported accounting entries from one workspace." />
    {allowedTabs.length > 0 ? <>
      <div className="flex overflow-x-auto border-b border-border" role="tablist" aria-label="Voucher types">
        {allowedTabs.map(item => { const Icon = item.icon; const selected = tab === item.id; return <button key={item.id} type="button" role="tab" aria-selected={selected} onClick={() => setTab(item.id)} className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium ${selected ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}><Icon className="size-3.5" />{item.label}</button> })}
      </div>
      {tab === 'journal' && <JournalVoucherView user={user} />}
      {tab === 'receipt' && <ReceiptVoucherView user={user} />}
      {tab === 'payment' && <PaymentVoucherView user={user} />}
      {tab === 'contra' && <ContraEntryView user={user} />}
    </> : <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">You do not have permission to create vouchers.</div>}
  </div>
}
