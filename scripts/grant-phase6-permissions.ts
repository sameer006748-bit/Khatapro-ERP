#!/usr/bin/env bun
/**
 * grant-phase6-permissions.ts — adds Phase 6 permissions to local Prisma DB
 * for Owner/Admin and Accountant roles.
 */
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const P6_PERMS = [
  { code: 'can_view_day_book', module: 'accounting', description: 'View Day Book (all posted vouchers)' },
  { code: 'can_create_payment_voucher', module: 'accounting', description: 'Create Payment Voucher' },
  { code: 'can_create_receipt_voucher', module: 'accounting', description: 'Create Receipt Voucher' },
  { code: 'can_create_journal_voucher', module: 'accounting', description: 'Create Journal Voucher' },
  { code: 'can_create_contra', module: 'accounting', description: 'Create Contra Entry' },
  { code: 'can_manage_petty_cash', module: 'accounting', description: 'Manage Petty Cash (top-up + expense)' },
  { code: 'can_create_expense_batch', module: 'accounting', description: 'Create Expense Batch' },
  { code: 'can_reverse_voucher', module: 'accounting', description: 'Reverse / cancel posted vouchers' },
]

async function main() {
  console.log('Granting Phase 6 permissions to Owner/Admin and Accountant…')
  for (const p of P6_PERMS) {
    await db.permission.upsert({ where: { code: p.code }, create: p, update: { module: p.module, description: p.description } })
    console.log(`  ✓ Permission: ${p.code}`)
  }
  const roles = await db.role.findMany({ where: { name: { in: ['Owner/Admin', 'Accountant'] } } })
  for (const role of roles) {
    for (const p of P6_PERMS) {
      const perm = await db.permission.findUnique({ where: { code: p.code } })
      if (!perm) continue
      const existing = await db.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } } }).catch(() => null)
      if (!existing) {
        await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } })
        console.log(`  ✓ Granted ${p.code} to ${role.name}`)
      }
    }
  }
  const owner = roles.find(r => r.name === 'Owner/Admin')
  if (owner) {
    const count = await db.rolePermission.count({ where: { roleId: owner.id } })
    console.log(`  Owner/Admin now has ${count} permissions`)
  }
  console.log('Done.')
}
main().catch(e => { console.error('Fatal:', e); process.exit(1) }).finally(() => db.$disconnect())
