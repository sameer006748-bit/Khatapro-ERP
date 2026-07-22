import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const setup = await readFile('src/components/erp/views/setup-view.tsx', 'utf8')
const shell = await readFile('src/components/erp/dashboard-shell.tsx', 'utf8')

const mappings = {
  'Business Accounts': 'business-accounts',
  'Chart of Accounts': 'coa',
  'Users & Roles': 'users',
  'Permission Matrix': 'permissions',
  'Audit Log': 'audit',
  'Biz-Day Test': 'biz-day-test',
}

test('all six Setup cards map to registered page keys', () => {
  for (const [title, key] of Object.entries(mappings)) {
    assert.match(setup, new RegExp(`title: '${title.replace(/[&]/g, '\\$&')}',[\\s\\S]*?route: '${key}'`))
    assert.match(shell, new RegExp(`key: '${key}'`))
  }
})

test('every Setup target resolves to its existing view component', () => {
  for (const [key, component] of Object.entries({
    'business-accounts': 'BusinessAccountsView',
    coa: 'CoaView',
    users: 'UsersView',
    permissions: 'PermissionMatrixView',
    audit: 'AuditLogView',
    'biz-day-test': 'BizDayTestView',
  })) {
    assert.match(shell, new RegExp(`active === '${key}'\\) return <${component}`))
  }
})

test('available cards are full semantic buttons with native keyboard activation', () => {
  assert.match(setup, /<button[\s\S]*?type="button"[\s\S]*?onClick=\{\(\) => onNavigate\(c\.route\)\}/)
  assert.match(setup, /min-h-44/)
  assert.match(setup, /focus-visible:ring-2/)
})

test('unavailable cards are non-interactive and do not advertise Open', () => {
  assert.match(setup, /const locked = !canOpen\(c\.route\)/)
  assert.match(setup, /locked \? \([\s\S]*?<div key=\{c\.title\}[\s\S]*?aria-disabled="true"/)
  assert.match(setup, /locked \? \([\s\S]*?Restricted[\s\S]*?\) : \([\s\S]*?Open/)
})

test('navigation rejects unknown keys and retains the existing permission gate', () => {
  assert.match(shell, /const item = PAGE_REGISTRY\.get\(key\)/)
  assert.match(shell, /if \(!item \|\| !isItemVisible\(user, item\)\) return/)
  assert.match(shell, /canOpen=\{\(key\) => \{[\s\S]*?isItemVisible\(user, item\)/)
})

test('card navigation uses query-page history so browser Back remains available', () => {
  assert.match(shell, /window\.history\.pushState\(\{\}, '', `\/\?page=\$\{key\}`\)/)
  assert.match(shell, /window\.dispatchEvent\(new PopStateEvent\('popstate'\)\)/)
})
