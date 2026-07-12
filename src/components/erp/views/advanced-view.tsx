'use client'

import { useState } from 'react'
import { JournalVoucherView } from '@/components/erp/views/journal-voucher-view'
import { OpeningBalanceView } from '@/components/erp/views/opening-balance-view'
import { AuditLogView } from '@/components/erp/views/audit-log-view'
import { ClipboardList, Plus, ScrollText } from 'lucide-react'
import type { MeUser } from '@/components/erp/erp-app'

export function AdvancedView({ user }: { user: MeUser }) {
  const [tab, setTab] = useState<'journal' | 'opening' | 'audit'>('journal')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Advanced Accounting</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Journal entries, opening balances and audit log — for accountants</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        <button onClick={() => setTab('journal')} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${tab === 'journal' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <ClipboardList className="size-3.5" /> Journal Entry
        </button>
        <button onClick={() => setTab('opening')} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${tab === 'opening' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <Plus className="size-3.5" /> Opening Balances
        </button>
        <button onClick={() => setTab('audit')} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${tab === 'audit' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <ScrollText className="size-3.5" /> Audit Log
        </button>
      </div>

      {tab === 'journal' && (
        <div className="space-y-3">
          <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            ⚠️ Use only for accounting corrections and adjustments. For normal business actions, use the Accounts page.
          </div>
          <JournalVoucherView user={user} />
        </div>
      )}
      {tab === 'opening' && <OpeningBalanceView />}
      {tab === 'audit' && <AuditLogView />}
    </div>
  )
}
