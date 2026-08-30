import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const shell = await readFile('src/components/erp/dashboard-shell.tsx', 'utf8')
const setup = await readFile('src/components/erp/views/setup-view.tsx', 'utf8')
const assistant = await readFile('src/components/erp/ai-assistant.tsx', 'utf8')
const status = await readFile('src/components/erp/supabase-status-badge.tsx', 'utf8')
const outOfCitySale = await readFile('src/components/erp/views/ofc-sale-view.tsx', 'utf8')
const salesList = await readFile('src/components/erp/views/sales-list-view.tsx', 'utf8')
const permissions = await readFile('src/components/erp/views/permission-matrix-view.tsx', 'utf8')

test('client navigation uses clear business wording in desktop and mobile labels', () => {
  assert.match(shell, /label: 'Daily Work'/)
  assert.match(shell, /label: 'Out-of-City Sale', short: 'Out-of-City'/)
  assert.match(shell, /label: 'Roles & Permissions', short: 'Permissions'/)
  assert.match(shell, /id: 'work', label: 'Daily Work'/)
  assert.doesNotMatch(shell, /label: 'OFC Sale'|label: 'Day Work'/)
})

test('destination screens carry the polished navigation terminology through the workflow', () => {
  assert.match(outOfCitySale, />Out-of-City Sale</)
  assert.match(outOfCitySale, /Post Out-of-City Sale/)
  assert.match(salesList, /> Out-of-City Sale/)
  assert.doesNotMatch(outOfCitySale, />OFC Sale|Post OFC Sale|OFC sale posted/)
  assert.doesNotMatch(salesList, /> OFC Sale|Online \/ OFC sale/)
  assert.match(permissions, /Roles &amp; Permissions/)
})

test('navigation keeps one semantic Lucide icon family and a consistent visual rhythm', () => {
  assert.match(shell, /icon: CalendarCheck2/)
  assert.match(shell, /key: 'online-sale'[\s\S]*?icon: Globe2/)
  assert.match(shell, /key: 'delivery'[\s\S]*?icon: PackageCheck/)
  assert.match(shell, /key: 'inventory'[\s\S]*?icon: Boxes/)
  assert.match(shell, /type LucideIcon/)
  assert.match(shell, /className="size-\[18px\]" strokeWidth=\{1\.9\}/)
})

test('navigation active, hover, focus, and accessibility states stay restrained and clear', () => {
  assert.match(shell, /bg-primary\/\[0\.09\]/)
  assert.match(shell, /hover:bg-muted\/70/)
  assert.match(shell, /focus-visible:ring-2 focus-visible:ring-ring\/60/)
  assert.match(shell, /aria-current=\{isActive \? 'page' : undefined\}/)
  assert.match(shell, /aria-expanded=\{isExpanded\}/)
})

test('Setup cards use client-facing descriptions without diagnostic or route-slug leakage', () => {
  assert.match(setup, /Manage business accounts, team access and accounting setup\./)
  assert.match(setup, /title: 'Roles & Permissions'/)
  assert.doesNotMatch(setup, /biz-day-test|Biz-Day Test|\{c\.route\}/)
  assert.doesNotMatch(setup, /UTC instants|Owner\/Admin only|linked Asset ledger/)
})

test('KhataPro AI launcher uses a calm outline treatment instead of a black floating action', () => {
  assert.match(assistant, /variant="outline"/)
  assert.match(assistant, /border-primary\/25 bg-card\/95/)
  assert.match(assistant, /aria-label="Ask KhataPro AI"/)
  assert.match(assistant, /aria-haspopup="dialog"/)
  assert.doesNotMatch(assistant, /bg-black|bg-slate-9|bg-zinc-9/)
})

test('header status exposes business-safe wording instead of raw service messages', () => {
  assert.match(status, />\s*System Online\s*</)
  assert.match(status, /title="All services are available"/)
  assert.match(status, /title="Some services need attention"/)
  assert.doesNotMatch(status, /title=\{s\.message\}/)
})
