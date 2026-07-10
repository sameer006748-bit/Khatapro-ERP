#!/usr/bin/env bun
/**
 * grant-p5a-permissions.ts — adds can_replace_purchases (and any missing p5 perms)
 * to the local Prisma DB for Owner/Admin and Accountant roles.
 *
 * This is needed because the Supabase migration only grants in Supabase, but the
 * local permission check (loadSessionUser) reads from Prisma.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const P5_PERMS = [
  { code: 'can_pay_vendors', module: 'purchases', description: 'Pay vendors and record advances' },
  { code: 'can_manage_vendors', module: 'purchases', description: 'Create/edit vendors' },
  { code: 'can_return_purchases', module: 'purchases', description: 'Post purchase returns' },
  { code: 'can_replace_purchases', module: 'purchases', description: 'Post purchase replacements (vendor replacement flow)' },
  { code: 'can_view_vendor_ledger', module: 'reports', description: 'View Vendor Ledger' },
]

async function main() {
  console.log('Granting Phase 5a permissions to Owner/Admin and Accountant…')

  // 1. Upsert permissions
  for (const p of P5_PERMS) {
    await db.permission.upsert({
      where: { code: p.code },
      create: p,
      update: { module: p.module, description: p.description },
    })
    console.log(`  ✓ Permission: ${p.code}`)
  }

  // 2. Find Owner/Admin and Accountant roles
  const roles = await db.role.findMany({ where: { name: { in: ['Owner/Admin', 'Accountant'] } } })
  console.log(`  Found ${roles.length} roles: ${roles.map(r => r.name).join(', ')}`)

  // 3. Grant all P5 perms to each role
  for (const role of roles) {
    for (const p of P5_PERMS) {
      const perm = await db.permission.findUnique({ where: { code: p.code } })
      if (!perm) continue
      const existing = await db.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      }).catch(() => null)
      if (!existing) {
        await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } })
        console.log(`  ✓ Granted ${p.code} to ${role.name}`)
      }
    }
  }

  // 4. Verify Owner has all 5
  const owner = roles.find(r => r.name === 'Owner/Admin')
  if (owner) {
    const count = await db.rolePermission.count({ where: { roleId: owner.id } })
    console.log(`  Owner/Admin now has ${count} permissions`)
  }

  console.log('Done.')
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) }).finally(() => db.$disconnect())
