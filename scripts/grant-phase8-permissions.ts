import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const PERMS = [
  { code: 'can_view_sales_reports', module: 'reports', description: 'View sales reports' },
  { code: 'can_view_purchase_reports', module: 'reports', description: 'View purchase reports' },
  { code: 'can_view_inventory_reports', module: 'reports', description: 'View inventory reports' },
  { code: 'can_view_delivery_reports', module: 'reports', description: 'View delivery reports' },
  { code: 'can_view_audit_reports', module: 'reports', description: 'View audit reports' },
]
async function main() {
  for (const p of PERMS) { await db.permission.upsert({ where: { code: p.code }, create: p, update: { module: p.module, description: p.description } }); console.log(`  ✓ ${p.code}`) }
  const roles = await db.role.findMany({ where: { name: { in: ['Owner/Admin', 'Accountant'] } } })
  for (const role of roles) for (const p of PERMS) {
    const perm = await db.permission.findUnique({ where: { code: p.code } })
    if (!perm) continue
    const existing = await db.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } } }).catch(() => null)
    if (!existing) { await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } }); console.log(`  ✓ ${p.code} → ${role.name}`) }
  }
  console.log('Done.')
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
