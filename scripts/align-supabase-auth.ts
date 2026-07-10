#!/usr/bin/env bun
/**
 * align-supabase-auth.ts
 *
 * Phase 2.1 Auth Alignment script.
 *
 * For each existing Prisma User, this script:
 *   1. Creates (or finds) the matching user in Supabase Auth.
 *   2. Captures the Supabase auth.users UUID.
 *   3. Stores it in Prisma User.supabaseUserUuid.
 *   4. Upserts the Supabase public.profiles row (linking auth.users → role).
 *
 * After running this script:
 *   - Every NextAuth login resolves to a real Supabase auth.users UUID.
 *   - postVoucherViaSupabase passes the UUID as posted_by (no more null).
 *   - Supabase audit_logs.user_id is a real UUID.
 *
 * Idempotent: safe to re-run. NEVER prints keys.
 *
 * Usage: bun run scripts/align-supabase-auth.ts
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '@prisma/client'

// Load .env.local manually.
const envLocalPath = join(process.cwd(), '.env.local')
if (!existsSync(envLocalPath)) {
  console.error('✗ .env.local not found.')
  process.exit(1)
}
const envLocal = readFileSync(envLocalPath, 'utf8')
for (const line of envLocal.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

// Also load .env for DATABASE_URL (Prisma needs it).
const envPath = join(process.cwd(), '.env')
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !SVC || SVC.includes('<')) {
  console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(URL, SVC, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const db = new PrismaClient()

const PREVIEW_USERS = [
  { email: 'owner@test.local', password: 'password123', displayName: 'Bilal Khan (Owner)', roleName: 'Owner/Admin', phone: '+92-300-1234567' },
  { email: 'accountant@test.local', password: 'password123', displayName: 'Accountant One', roleName: 'Accountant', phone: '+92-300-2222222' },
  { email: 'salesman@test.local', password: 'password123', displayName: 'Salesman One', roleName: 'Salesman', phone: '+92-300-3333333' },
  { email: 'rider@test.local', password: 'password123', displayName: 'Rider One', roleName: 'Rider', phone: '+92-300-4444444' },
]

const BUSINESS_ID = 'biz-default'

async function main() {
  console.log('━'.repeat(72))
  console.log('  KhataPro ERP — Phase 2.1 Auth Alignment')
  console.log('━'.repeat(72))
  console.log(`  Supabase URL: ${URL}`)
  console.log(`  Business: ${BUSINESS_ID}`)
  console.log('')

  // Verify Phase 1 migration is applied (roles table exists).
  const { data: roles, error: rolesErr } = await admin
    .from('roles')
    .select('id, name')
    .eq('business_id', BUSINESS_ID)
  if (rolesErr || !roles || roles.length === 0) {
    console.error('✗ Phase 1 migration not applied. Run 00001_phase1_foundation.sql first.')
    process.exit(1)
  }
  console.log(`  ✓ Found ${roles.length} system roles in Supabase.`)

  // Get all Prisma users.
  const prismaUsers = await db.user.findMany({ include: { profile: { include: { role: true } } } })
  console.log(`  ✓ Found ${prismaUsers.length} users in Prisma.`)
  console.log('')

  let aligned = 0
  let skipped = 0

  for (const pu of prismaUsers) {
    const preview = PREVIEW_USERS.find((p) => p.email === pu.email)

    // 1. Find or create the user in Supabase Auth.
    let supabaseUser: { id: string; email?: string } | null = null

    // Check if already linked.
    if (pu.supabaseUserUuid) {
      // Verify the linked UUID still exists in Supabase Auth.
      const { data: existing, error: listErr } = await admin.auth.admin.listUsers()
      if (!listErr && existing) {
        supabaseUser = existing.users.find((u) => u.id === pu.supabaseUserUuid) ?? null
      }
      if (supabaseUser) {
        console.log(`  · ${pu.email} already linked to Supabase UUID ${supabaseUser.id}`)
      }
    }

    // If not linked, find by email or create.
    if (!supabaseUser) {
      const { data: existing, error: listErr } = await admin.auth.admin.listUsers()
      if (!listErr && existing) {
        supabaseUser = existing.users.find((u) => u.email === pu.email) ?? null
      }

      if (!supabaseUser) {
        // Create in Supabase Auth.
        const password = preview?.password ?? 'password123'
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: pu.email,
          password,
          email_confirm: true,
          user_metadata: { display_name: pu.profile?.displayName ?? pu.email },
        })
        if (createErr) {
          console.error(`  ✗ Failed to create Supabase Auth user for ${pu.email}: ${createErr.message}`)
          continue
        }
        supabaseUser = created.user
        console.log(`  ✓ Created Supabase Auth user: ${pu.email} → ${supabaseUser.id}`)
      } else {
        console.log(`  ✓ Found existing Supabase Auth user: ${pu.email} → ${supabaseUser.id}`)
      }
    }

    if (!supabaseUser) {
      console.error(`  ✗ No Supabase user for ${pu.email}`)
      continue
    }

    // 2. Link the UUID to the Prisma User.
    if (pu.supabaseUserUuid !== supabaseUser.id) {
      await db.user.update({
        where: { id: pu.id },
        data: { supabaseUserUuid: supabaseUser.id },
      })
      console.log(`  ✓ Linked Prisma User ${pu.email} → supabaseUserUuid ${supabaseUser.id}`)
    }

    // 3. Upsert Supabase profile (linking auth.users → role).
    const roleName = pu.profile?.role?.name ?? preview?.roleName
    if (roleName) {
      const role = roles.find((r) => r.name === roleName)
      if (role) {
        const { error: profErr } = await admin
          .from('profiles')
          .upsert(
            {
              user_id: supabaseUser.id,
              business_id: BUSINESS_ID,
              role_id: role.id,
              display_name: pu.profile?.displayName ?? preview?.displayName ?? pu.email,
              phone: pu.profile?.phone ?? preview?.phone ?? null,
              is_active: true,
            },
            { onConflict: 'user_id' },
          )
        if (profErr) {
          console.error(`  ✗ Failed to upsert Supabase profile for ${pu.email}: ${profErr.message}`)
        } else {
          console.log(`  ✓ Supabase profile: ${pu.email} → ${roleName}`)
        }
      }
    }

    aligned++
  }

  console.log('')
  console.log('━'.repeat(72))
  console.log(`  ✅ Aligned ${aligned} users (${skipped} skipped).`)
  console.log('━'.repeat(72))
  console.log('')
  console.log('  Preview login credentials (NextAuth → resolves to Supabase UUID):')
  for (const p of PREVIEW_USERS) {
    console.log(`    ${p.roleName.padEnd(14)} ${p.email.padEnd(28)} / ${p.password}`)
  }
  console.log('')
  console.log('  Next steps:')
  console.log('    - Restart the dev server to clear cached session data.')
  console.log('    - Sign in as any user; posted vouchers will now have posted_by = real UUID.')
}

main()
  .catch((e) => {
    console.error('Fatal:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
