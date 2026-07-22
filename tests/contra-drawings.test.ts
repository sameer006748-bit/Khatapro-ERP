import { strict as assert } from 'node:assert'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { promisify } from 'node:util'

const sql = (await readFile('supabase/migrations/00018_contra_drawings.sql', 'utf8')).toLowerCase()
const inspect = (await readFile('supabase/migrations/00018_contra_drawings_inspect.sql', 'utf8')).toLowerCase()
const contraRoute = await readFile('src/app/api/contra-entry/route.ts', 'utf8')
const equityRoute = await readFile('src/app/api/owner-equity/route.ts', 'utf8')
const moneyAccess = await readFile('src/lib/money/operational-money.ts', 'utf8')
const forms = await readFile('src/components/erp/views/voucher-forms-view.tsx', 'utf8')
const shell = await readFile('src/components/erp/dashboard-shell.tsx', 'utf8')
const execFileAsync = promisify(execFile)

test('Contra updates source and destination exactly once without P&L rows', () => {
  assert.ok(sql.includes("transaction_kind in ('contra', 'capital', 'drawings')"))
  assert.ok(sql.includes('balance_paisas = balance_paisas - p_amount'))
  assert.ok(sql.includes('balance_paisas = balance_paisas + p_amount'))
  assert.ok(sql.includes("'contra', p_source_account_id, p_destination_account_id"))
  assert.ok(!sql.includes('public.expenses'))
  assert.ok(!sql.includes('public.payments'))
  assert.ok(!sql.includes('public.invoices'))
})

test('Contra rejects same account and non-positive or fractional money', () => {
  assert.ok(sql.includes('p_source_account_id = p_destination_account_id'))
  assert.ok(sql.includes('p_amount <= 0 or p_amount <> trunc(p_amount)'))
  assert.ok(contraRoute.includes('From and To accounts must differ'))
  assert.ok(contraRoute.includes('amountPaisas <= 0n'))
})

test('all operational mutations are business-scoped idempotent transactions', () => {
  for (const rpc of ['post_contra_transfer', 'post_owner_capital', 'post_owner_drawings']) {
    assert.ok(sql.includes(`create or replace function public.${rpc}`))
    assert.ok(sql.includes(`p_business_id uuid`))
  }
  assert.ok(sql.includes('business_money_transactions_idempotency unique (business_id, idempotency_key)'))
  assert.ok((sql.match(/pg_advisory_xact_lock/g) ?? []).length === 3)
  assert.ok((sql.match(/request_fingerprint/g) ?? []).length >= 6)
})

test('concurrent source withdrawals lock and cannot overspend', () => {
  assert.ok(sql.includes('order by id for update'))
  assert.ok(sql.includes('insufficient source account balance'))
  assert.ok(sql.includes('and business_id = p_business_id and is_active for update'))
})

test('owner capital increases funds and equity, while drawings reduce both', () => {
  assert.ok(sql.includes("'capital', p_destination_account_id, p_amount, p_amount"))
  assert.ok(sql.includes("'drawings', p_source_account_id, p_amount, -p_amount"))
  assert.ok(sql.includes("transaction_kind = 'capital'"))
  assert.ok(sql.includes("transaction_kind = 'drawings'"))
  assert.ok(!equityRoute.includes('expense'))
  assert.ok(!equityRoute.includes('payment-voucher'))
})

test('server routes pass session-verified business and profile identity to RPCs', () => {
  assert.ok(contraRoute.includes("requirePermission(loaded, 'can_create_contra')"))
  assert.ok(contraRoute.includes('actorProfileId: su.profileId'))
  assert.ok(equityRoute.includes("hasPermission(loaded, 'can_manage_owner_equity')"))
  assert.ok(equityRoute.includes('actorProfileId: loaded.profileId'))
  assert.ok(moneyAccess.includes('p_business_id: input.businessId'))
  assert.ok(moneyAccess.includes('p_actor_profile_id: input.actorProfileId'))
})

test('SQL enforces active same-business profiles, permissions, security definer, and grants', () => {
  assert.ok(sql.includes('and pr.business_id = p_business_id and pr.status = \'active\''))
  assert.ok(sql.includes("array['can_create_contra']"))
  assert.ok(sql.includes("array['can_manage_owner_equity']"))
  assert.ok((sql.match(/security definer/g) ?? []).length >= 8)
  assert.ok(sql.includes('set search_path = public'))
  assert.ok(sql.includes('revoke all on function public.post_contra_transfer'))
  assert.ok(sql.includes('to authenticated, service_role'))
})

test('mobile-safe forms expose account, amount, date, note, impact, and recent activity', () => {
  for (const label of ['From account', 'To account', 'Amount (Rs)', 'Date', 'Note', 'Accounting Impact', 'Recent transfers', 'Add Capital', 'Withdraw / Drawings']) {
    assert.ok(forms.includes(label), `missing ${label}`)
  }
  assert.ok(forms.includes('grid sm:grid-cols-2'))
  assert.ok(forms.includes('overflow-x-auto'))
  assert.ok(forms.includes('mut.isPending'))
  assert.ok(forms.includes('Profit impact: None.'))
  assert.ok(shell.includes("key: 'owner-capital'"))
  assert.ok(shell.includes('ownerOnly: true'))
})

test('inspection covers signatures, security, idempotency, grants, and legacy-table exclusion', () => {
  for (const term of ['pg_get_function_identity_arguments', 'security_definer', 'function_acl', 'pg_catalog.pg_constraint', 'accounts', 'vouchers', 'voucher_lines']) {
    assert.ok(inspect.includes(term), `inspection missing ${term}`)
  }
})

test('migrations 00009 through 00017 remain unchanged', async () => {
  const { stdout } = await execFileAsync('git', ['diff', '--name-only'])
  assert.ok(!stdout.split('\n').some((path) => /^supabase\/migrations\/000(?:09|10|11|12|13|14|15|16|17)_/.test(path)), 'historical migrations must stay unchanged')
})
