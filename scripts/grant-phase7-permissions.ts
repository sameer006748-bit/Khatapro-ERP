import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const P7_PERMS = [
  { code: 'can_view_delivery_orders', module: 'delivery', description: 'View delivery orders' },
  { code: 'can_create_online_orders', module: 'delivery', description: 'Create Online COD orders' },
  { code: 'can_assign_rider', module: 'delivery', description: 'Assign/reassign riders' },
  { code: 'can_update_delivery_status', module: 'delivery', description: 'Update delivery status' },
  { code: 'can_mark_delivered', module: 'delivery', description: 'Mark orders delivered' },
  { code: 'can_mark_returned', module: 'delivery', description: 'Mark orders returned' },
  { code: 'can_manage_riders', module: 'delivery', description: 'Create/edit riders' },
  { code: 'can_view_rider_ledger', module: 'delivery', description: 'View rider ledger' },
  { code: 'can_create_cod_submission', module: 'delivery', description: 'Create COD submissions' },
  { code: 'can_confirm_cod_submission', module: 'delivery', description: 'Confirm COD submissions' },
  { code: 'can_view_cod_settlements', module: 'delivery', description: 'View COD settlements' },
  { code: 'can_edit_delivery_fee_split', module: 'delivery', description: 'Edit delivery fee split' },
]
async function main() {
  console.log('Granting Phase 7 permissions…')
  for (const p of P7_PERMS) { await db.permission.upsert({ where: { code: p.code }, create: p, update: { module: p.module, description: p.description } }); console.log(`  ✓ ${p.code}`) }
  const roles = await db.role.findMany({ where: { name: { in: ['Owner/Admin', 'Accountant', 'Salesman', 'Rider'] } } })
  const grants: Record<string, string[]> = {
    'Owner/Admin': P7_PERMS.map(p => p.code),
    'Accountant': ['can_view_delivery_orders','can_view_rider_ledger','can_confirm_cod_submission','can_view_cod_settlements','can_mark_delivered','can_mark_returned','can_assign_rider','can_update_delivery_status'],
    'Salesman': ['can_create_online_orders'],
    'Rider': ['can_update_delivery_status','can_mark_delivered','can_mark_returned','can_create_cod_submission','can_view_delivery_orders'],
  }
  for (const role of roles) {
    const codes = grants[role.name] ?? []
    for (const code of codes) {
      const perm = await db.permission.findUnique({ where: { code } })
      if (!perm) continue
      const existing = await db.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } } }).catch(() => null)
      if (!existing) { await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } }); console.log(`  ✓ ${code} → ${role.name}`) }
    }
  }
  const owner = roles.find(r => r.name === 'Owner/Admin')
  if (owner) { const count = await db.rolePermission.count({ where: { roleId: owner.id } }); console.log(`  Owner/Admin now has ${count} permissions`) }
  console.log('Done.')
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
