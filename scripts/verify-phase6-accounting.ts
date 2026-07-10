#!/usr/bin/env bun
/**
 * verify-phase6-accounting.ts — verifies the 10 required Phase 6 accounting tests.
 *
 * REQUIRES: Phase 6 migration applied.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

try {
  const envLocal = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of envLocal.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { console.error('⚠ .env.local not found'); process.exit(1) }

const BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000'
let cookie = ''
const results: Array<{ test: string; pass: boolean; detail: string }> = []

function record(test: string, pass: boolean, detail: string) {
  results.push({ test, pass, detail })
  console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'}: ${test} — ${detail}`)
}

async function login(email: string, password: string) {
  if (process.env.SESSION_COOKIE) {
    cookie = process.env.SESSION_COOKIE
    const me = await fetch(`${BASE}/api/me`, { headers: { cookie } })
    const meJ = await me.json() as any
    if (meJ.user) return meJ.user
  }
  const csrfR = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie } })
  const csrfJ = await csrfR.json() as any
  cookie = (csrfR.headers.get('set-cookie') || '').split(';')[0] || cookie
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ email, password, csrfToken: csrfJ.csrfToken, callbackUrl: '/', json: 'true' }).toString(),
    redirect: 'manual',
  })
  const setCookies = r.headers.get('set-cookie') || ''
  if (setCookies) { const sc = setCookies.split(';')[0]; cookie = cookie ? `${cookie}; ${sc}` : sc }
  const me = await fetch(`${BASE}/api/me`, { headers: { cookie } })
  const meJ = await me.json() as any
  if (!meJ.user) throw new Error(`Login failed for ${email}`)
  return meJ.user
}

async function api(path: string, method = 'GET', body?: any) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json() as any
  return { ok: r.ok, status: r.status, json: j }
}

async function getTrialBalance() {
  const r = await api('/api/trial-balance')
  return r.json?.rows ?? []
}
function findAccount(rows: any[], code: string) {
  return rows.find((r: any) => r.accountCode === code)
}

async function main() {
  console.log('━'.repeat(72))
  console.log('  KhataPro ERP — Phase 6 Accounting Verification')
  console.log('━'.repeat(72))

  // Check migration applied
  const dbCheck = await api('/api/day-book')
  if (dbCheck.status === 500 && dbCheck.json?.error?.includes('day_book')) {
    console.log('\n❌ MIGRATION NOT APPLIED — day_book RPC missing.')
    console.log('   Apply supabase/migrations/00006_phase6_vouchers_expenses.sql first.')
    process.exit(1)
  }

  console.log('\n▸ Logging in as owner…')
  const user = await login('owner@test.local', 'password123')
  console.log(`  ✓ Logged in: ${user.displayName}`)

  // Get accounts
  const coaR = await api('/api/setup/coa')
  const accounts = (coaR.json?.categories ?? []).flatMap((c: any) => c.accounts).filter((a: any) => a.isActive)
  const cash = accounts.find((a: any) => a.code === '1010')
  const bank = accounts.find((a: any) => a.code === '1030')
  const jazzCash = accounts.find((a: any) => a.code === '1050')
  const pettyCash = accounts.find((a: any) => a.code === '1020')
  const custRecv = accounts.find((a: any) => a.code === '1200')
  const expenses = accounts.filter((a: any) => {
    const cat = (coaR.json?.categories ?? []).find((c: any) => c.accounts.some((ac: any) => ac.id === a.id))
    return cat?.type === 'Expense'
  })
  console.log(`  ✓ Cash: ${cash?.code}, Bank: ${bank?.code}, JazzCash: ${jazzCash?.code}, PettyCash: ${pettyCash?.code}`)
  console.log(`  ✓ Found ${expenses.length} expense accounts`)

  // ─── TEST 1: CONTRA — Cash → JazzCash Rs 10,000 ───
  console.log('\n━ TEST 1: Contra — Cash → JazzCash Rs 10,000')
  console.log('  Expected: JazzCash debit 1000000, Cash credit 1000000')
  const tbBefore1 = await getTrialBalance()
  const cashBefore1 = findAccount(tbBefore1, '1010')
  const jazzBefore1 = findAccount(tbBefore1, '1050')
  const contraR = await api('/api/contra-entry', 'POST', {
    contraDate: new Date().toISOString().slice(0, 10),
    fromAccountId: cash.id, toAccountId: jazzCash.id, amount: '10000',
  })
  if (!contraR.ok) { record('Post contra', false, JSON.stringify(contraR.json)); return }
  console.log(`  ✓ Contra posted: ${contraR.json.contraNo}`)
  const tbAfter1 = await getTrialBalance()
  const cashAfter1 = findAccount(tbAfter1, '1010')
  const jazzAfter1 = findAccount(tbAfter1, '1050')
  const cashDelta1 = BigInt(cashAfter1.balance) - BigInt(cashBefore1.balance)
  const jazzDelta1 = BigInt(jazzAfter1.balance) - BigInt(jazzBefore1.balance)
  record('Contra: Cash credit 1000000 (balance -1000000)', cashDelta1 === -1000000n, `Δ=${cashDelta1}`)
  record('Contra: JazzCash debit 1000000 (balance +1000000)', jazzDelta1 === 1000000n, `Δ=${jazzDelta1}`)

  // ─── TEST 2: EXPENSE BATCH — Rent 5k + Packing 3k + Tea 1k + Fuel 2k from Cash ───
  console.log('\n━ TEST 2: Expense Batch — Rent 5k + Packing 3k + Tea 1k + Fuel 2k from Cash')
  console.log('  Expected: 4 expense debits totaling 1100000, Cash credit 1100000 once')
  const tbBefore2 = await getTrialBalance()
  const cashBefore2 = findAccount(tbBefore2, '1010')
  const expenseBefore2: Record<string, bigint> = {}
  for (const e of expenses) expenseBefore2[e.code] = BigInt(findAccount(tbBefore2, e.code)?.balance ?? '0')

  const expR = await api('/api/expense-batch', 'POST', {
    expenseDate: new Date().toISOString().slice(0, 10),
    paymentAccountId: cash.id,
    lines: [
      { expenseAccountId: expenses[0].id, description: 'Rent', amount: '5000' },
      { expenseAccountId: expenses[1].id, description: 'Packing', amount: '3000' },
      { expenseAccountId: expenses[0].id, description: 'Tea', amount: '1000' },
      { expenseAccountId: expenses[1].id, description: 'Fuel', amount: '2000' },
    ],
  })
  if (!expR.ok) { record('Post expense batch', false, JSON.stringify(expR.json)); return }
  console.log(`  ✓ Expense batch posted: ${expR.json.expenseNo}`)
  const tbAfter2 = await getTrialBalance()
  const cashAfter2 = findAccount(tbAfter2, '1010')
  const cashDelta2 = BigInt(cashAfter2.balance) - BigInt(cashBefore2.balance)
  record('Expense batch: Cash credit 1100000 (balance -1100000)', cashDelta2 === -1100000n, `Δ=${cashDelta2}`)

  // Check Day Book shows one collapsed row for the expense batch
  const dbR = await api('/api/day-book')
  const dbRows = dbR.json?.rows ?? []
  const expVoucher = dbRows.find((r: any) => r.voucherId === expR.json.voucherId)
  record('Day Book: expense batch shows as one collapsed row', !!expVoucher, expVoucher ? `lines: ${expVoucher.lines.length}` : 'not found')
  record('Day Book: expense batch has 5 lines (4 debits + 1 credit)', expVoucher?.lines.length === 5, `got ${expVoucher?.lines.length}`)

  // ─── TEST 3: RECEIPT VOUCHER — Receive Rs 4,000 into Bank against Customer Receivable ───
  console.log('\n━ TEST 3: Receipt Voucher — Receive Rs 4,000 into Bank against Customer Receivable')
  console.log('  Expected: Bank debit 400000, Customer Receivable credit 400000')
  const tbBefore3 = await getTrialBalance()
  const bankBefore3 = findAccount(tbBefore3, '1030')
  const custBefore3 = findAccount(tbBefore3, '1200')
  const recR = await api('/api/receipt-voucher', 'POST', {
    receiptDate: new Date().toISOString().slice(0, 10),
    receivedIntoAccountId: bank.id, creditAccountId: custRecv.id, amount: '4000',
  })
  if (!recR.ok) { record('Post receipt voucher', false, JSON.stringify(recR.json)); return }
  console.log(`  ✓ Receipt posted: ${recR.json.receiptNo}`)
  const tbAfter3 = await getTrialBalance()
  const bankAfter3 = findAccount(tbAfter3, '1030')
  const custAfter3 = findAccount(tbAfter3, '1200')
  const bankDelta3 = BigInt(bankAfter3.balance) - BigInt(bankBefore3.balance)
  const custDelta3 = BigInt(custAfter3.balance) - BigInt(custBefore3.balance)
  record('Receipt: Bank debit 400000 (balance +400000)', bankDelta3 === 400000n, `Δ=${bankDelta3}`)
  record('Receipt: Customer Receivable credit 400000 (balance -400000)', custDelta3 === -400000n, `Δ=${custDelta3}`)

  // ─── TEST 4: PAYMENT VOUCHER — Pay Rs 3,000 from Cash against Vendor Payable ───
  console.log('\n━ TEST 4: Payment Voucher — Pay Rs 3,000 from Cash against Vendor Payable')
  console.log('  Expected: Vendor Payable debit 300000, Cash credit 300000')
  const payable = accounts.find((a: any) => a.code === '2010')
  const tbBefore4 = await getTrialBalance()
  const cashBefore4 = findAccount(tbBefore4, '1010')
  const payBefore4 = findAccount(tbBefore4, '2010')
  const payR = await api('/api/payment-voucher', 'POST', {
    paymentDate: new Date().toISOString().slice(0, 10),
    paidFromAccountId: cash.id, debitAccountId: payable.id, amount: '3000',
  })
  if (!payR.ok) { record('Post payment voucher', false, JSON.stringify(payR.json)); return }
  console.log(`  ✓ Payment posted: ${payR.json.paymentNo}`)
  const tbAfter4 = await getTrialBalance()
  const cashAfter4 = findAccount(tbAfter4, '1010')
  const payAfter4 = findAccount(tbAfter4, '2010')
  const cashDelta4 = BigInt(cashAfter4.balance) - BigInt(cashBefore4.balance)
  const payDelta4 = BigInt(payAfter4.balance) - BigInt(payBefore4.balance)
  record('Payment: Cash credit 300000 (balance -300000)', cashDelta4 === -300000n, `Δ=${cashDelta4}`)
  record('Payment: Vendor Payable debit 300000 (balance +300000)', payDelta4 === 300000n, `Δ=${payDelta4}`)

  // ─── TEST 5: JOURNAL VOUCHER — Debit Packing Expense 1k, Credit Misc Expense 1k ───
  console.log('\n━ TEST 5: Journal Voucher — Debit Packing Expense 1k, Credit Misc Expense 1k')
  const tbBefore5 = await getTrialBalance()
  const jvR = await api('/api/journal-voucher', 'POST', {
    jvDate: new Date().toISOString().slice(0, 10),
    memo: 'Reclass packing to misc',
    lines: [
      { accountId: expenses[1].id, debit: '1000', memo: 'Packing' },
      { accountId: expenses[0].id, credit: '1000', memo: 'Misc' },
    ],
  })
  if (!jvR.ok) { record('Post journal voucher', false, JSON.stringify(jvR.json)); return }
  console.log(`  ✓ JV posted: ${jvR.json.voucherNo}`)
  const tbAfter5 = await getTrialBalance()
  const exp1Before = BigInt(findAccount(tbBefore5, expenses[1].code)?.balance ?? '0')
  const exp1After = BigInt(findAccount(tbAfter5, expenses[1].code)?.balance ?? '0')
  const exp0Before = BigInt(findAccount(tbBefore5, expenses[0].code)?.balance ?? '0')
  const exp0After = BigInt(findAccount(tbAfter5, expenses[0].code)?.balance ?? '0')
  record('JV: Packing Expense debit 100000 (balance +100000)', exp1After - exp1Before === 100000n, `Δ=${exp1After - exp1Before}`)
  record('JV: Misc Expense credit 100000 (balance -100000)', exp0After - exp0Before === -100000n, `Δ=${exp0After - exp0Before}`)

  // ─── TEST 6: PETTY CASH TOP-UP — Cash → Petty Cash Rs 5,000 ───
  console.log('\n━ TEST 6: Petty Cash Top-Up — Cash → Petty Cash Rs 5,000 (Contra)')
  const tbBefore6 = await getTrialBalance()
  const cashBefore6 = findAccount(tbBefore6, '1010')
  const pettyBefore6 = findAccount(tbBefore6, '1020')
  const topupR = await api('/api/contra-entry', 'POST', {
    contraDate: new Date().toISOString().slice(0, 10),
    fromAccountId: cash.id, toAccountId: pettyCash.id, amount: '5000',
  })
  if (!topupR.ok) { record('Petty cash top-up', false, JSON.stringify(topupR.json)); return }
  console.log(`  ✓ Top-up posted: ${topupR.json.contraNo}`)
  const tbAfter6 = await getTrialBalance()
  const cashAfter6 = findAccount(tbAfter6, '1010')
  const pettyAfter6 = findAccount(tbAfter6, '1020')
  record('Petty top-up: Cash credit 500000 (balance -500000)', BigInt(cashAfter6.balance) - BigInt(cashBefore6.balance) === -500000n, `Δ=${BigInt(cashAfter6.balance) - BigInt(cashBefore6.balance)}`)
  record('Petty top-up: Petty Cash debit 500000 (balance +500000)', BigInt(pettyAfter6.balance) - BigInt(pettyBefore6.balance) === 500000n, `Δ=${BigInt(pettyAfter6.balance) - BigInt(pettyBefore6.balance)}`)

  // ─── TEST 7: PETTY CASH EXPENSE — Tea Expense Rs 500 from Petty Cash ───
  console.log('\n━ TEST 7: Petty Cash Expense — Tea Expense Rs 500 from Petty Cash')
  const tbBefore7 = await getTrialBalance()
  const pettyBefore7 = findAccount(tbBefore7, '1020')
  const teaBefore7 = findAccount(tbBefore7, expenses[0].code)
  const teaExpR = await api('/api/expense-batch', 'POST', {
    expenseDate: new Date().toISOString().slice(0, 10),
    paymentAccountId: pettyCash.id,
    lines: [{ expenseAccountId: expenses[0].id, description: 'Tea', amount: '500' }],
  })
  if (!teaExpR.ok) { record('Petty cash expense', false, JSON.stringify(teaExpR.json)); return }
  console.log(`  ✓ Petty expense posted: ${teaExpR.json.expenseNo}`)
  const tbAfter7 = await getTrialBalance()
  const pettyAfter7 = findAccount(tbAfter7, '1020')
  const teaAfter7 = findAccount(tbAfter7, expenses[0].code)
  record('Petty expense: Petty Cash credit 50000 (balance -50000)', BigInt(pettyAfter7.balance) - BigInt(pettyBefore7.balance) === -50000n, `Δ=${BigInt(pettyAfter7.balance) - BigInt(pettyBefore7.balance)}`)
  record('Petty expense: Tea Expense debit 50000 (balance +50000)', BigInt(teaAfter7.balance) - BigInt(teaBefore7.balance) === 50000n, `Δ=${BigInt(teaAfter7.balance) - BigInt(teaBefore7.balance)}`)

  // ─── TEST 8: REVERSE JOURNAL VOUCHER ───
  console.log('\n━ TEST 8: Reverse Test 5 (Journal Voucher)')
  const tbBefore8 = await getTrialBalance()
  const revR = await api(`/api/vouchers/${jvR.json.voucherId}/reverse`, 'POST', { reason: 'Test reversal' })
  if (!revR.ok) { record('Reverse JV', false, JSON.stringify(revR.json)); return }
  console.log(`  ✓ Reversal posted: ${revR.json.reversalVoucherId}`)
  const tbAfter8 = await getTrialBalance()
  // Net ledger effect should be zero (original + reversal cancel out)
  const exp1Before8 = BigInt(findAccount(tbBefore8, expenses[1].code)?.balance ?? '0')
  const exp1After8 = BigInt(findAccount(tbAfter8, expenses[1].code)?.balance ?? '0')
  const exp0Before8 = BigInt(findAccount(tbBefore8, expenses[0].code)?.balance ?? '0')
  const exp0After8 = BigInt(findAccount(tbAfter8, expenses[0].code)?.balance ?? '0')
  record('Reversal: Packing Expense net effect zero', exp1After8 - exp1Before8 === -100000n, `Δ=${exp1After8 - exp1Before8} (should be -100000 to cancel)`)
  record('Reversal: Misc Expense net effect zero', exp0After8 - exp0Before8 === 100000n, `Δ=${exp0After8 - exp0Before8} (should be +100000 to cancel)`)

  // Attempt second reversal — should fail
  console.log('  Attempting second reversal (should fail)…')
  const rev2R = await api(`/api/vouchers/${jvR.json.voucherId}/reverse`, 'POST', { reason: 'Second attempt' })
  record('Second reversal blocked', !rev2R.ok, `status=${rev2R.status}`)

  // ─── TEST 9: UNBALANCED JOURNAL ───
  console.log('\n━ TEST 9: Attempt unbalanced journal voucher')
  const unbalR = await api('/api/journal-voucher', 'POST', {
    jvDate: new Date().toISOString().slice(0, 10),
    memo: 'Unbalanced test',
    lines: [
      { accountId: expenses[0].id, debit: '5000' },
      { accountId: expenses[1].id, credit: '3000' },
    ],
  })
  record('Unbalanced JV rejected', !unbalR.ok, `status=${unbalR.status}, error=${unbalR.json?.error?.slice(0, 60)}`)

  // ─── TEST 10: DIRECT VOUCHER LINE INSERT ───
  console.log('\n━ TEST 10: Attempt direct voucher_lines insert (RLS should block)')
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''
  const insertR = await fetch(`${SUPABASE_URL}/rest/v1/voucher_lines`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${PUBLISHABLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ voucher_id: '00000000-0000-0000-0000-000000000000', account_id: '00000000-0000-0000-0000-000000000000', debit: '100', credit: '0', line_order: 1 }),
  })
  record('Direct voucher_lines insert blocked by RLS', !insertR.ok, `status=${insertR.status}`)

  // ─── SUMMARY ───
  console.log('\n' + '━'.repeat(72))
  console.log('  PHASE 6 ACCOUNTING VERIFICATION SUMMARY')
  console.log('━'.repeat(72))
  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass).length
  console.log(`  Passed: ${passed} / ${results.length}`)
  console.log(`  Failed: ${failed} / ${results.length}`)
  if (failed > 0) {
    console.log('\n  FAILED TESTS:')
    for (const r of results.filter(r => !r.pass)) console.log(`    ❌ ${r.test}: ${r.detail}`)
    process.exit(1)
  } else {
    console.log('\n  ✅ ALL PHASE 6 ACCOUNTING TESTS PASSED')
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
