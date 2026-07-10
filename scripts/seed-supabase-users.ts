#!/usr/bin/env bun
/**
 * seed-supabase-users.ts
 *
 * Creates the 4 test users in Supabase Auth + their profiles in the
 * public.profiles table. Idempotent — safe to re-run.
 *
 * This script is meant to be run AFTER the Phase 1 migration has been
 * applied to Supabase (which seeds the roles + permissions + CoA).
 *
 * Test credentials created:
 *   owner@test.local      / password123  →  Owner/Admin
 *   accountant@test.local / password123  →  Accountant
 *   salesman@test.local   / password123  →  Salesman
 *   rider@test.local      / password123  →  Rider
 *
 * Usage: bun run scripts/seed-supabase-users.ts
 *
 * NEVER prints keys. Only prints user emails + status.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'

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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !SVC || SVC.includes('<')) {
  console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

// Admin client (bypasses RLS).
const admin = createClient(URL, SVC, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const BUSINESS_ID = 'biz-default'

const USERS = [
  { email: 'owner@test.local', password: 'password123', displayName: 'Bilal Khan (Owner)', roleName: 'Owner/Admin', phone: '+92-300-1234567' },
  { email: 'accountant@test.local', password: 'password123', displayName: 'Accountant One', roleName: 'Accountant', phone: '+92-300-2222222' },
  { email: 'salesman@test.local', password: 'password123', displayName: 'Salesman One', roleName: 'Salesman', phone: '+92-300-3333333' },
  { email: 'rider@test.local', password: 'password123', displayName: 'Rider One', roleName: 'Rider', phone: '+92-300-4444444' },
]

async function main() {
  console.log('━'.repeat(72))
  console.log('  KhataPro ERP — Supabase Seed Users')
  console.log('━'.repeat(72))
  console.log(`  Project: ${URL}`)
  console.log(`  Business: ${BUSINESS_ID}`)
  console.log('')

  // Verify Phase 1 migration is applied (roles table has rows).
  const { data: roles, error: rolesErr } = await admin
    .from('roles')
    .select('id, name')
    .eq('business_id', BUSINESS_ID)
  if (rolesErr || !roles || roles.length === 0) {
    console.error('✗ Phase 1 migration not applied yet. Run supabase/migrations/00001_phase1_foundation.sql in SQL Editor first.')
    process.exit(1)
  }
  console.log(`  ✓ Found ${roles.length} system roles.`)

  for (const u of USERS) {
    const role = roles.find((r) => r.name === u.roleName)
    if (!role) {
      console.error(`✗ Role "${u.roleName}" not found in Supabase.`)
      continue
    }

    // 1. Create user in Supabase Auth (or find existing by email).
    let authUser: { id: string; email?: string } | null = null
    // Try to list users with this email.
    const { data: existing, error: listErr } = await admin.auth.admin.listUsers()
    if (!listErr && existing) {
      authUser = existing.users.find((u2) => u2.email === u.email) ?? null
    }

    if (!authUser) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: { display_name: u.displayName },
      })
      if (createErr) {
        console.error(`✗ Failed to create ${u.email}: ${createErr.message}`)
        continue
      }
      authUser = created.user
      console.log(`  ✓ Created Auth user: ${u.email}`)
    } else {
      console.log(`  · Auth user already exists: ${u.email}`)
    }

    if (!authUser) {
      console.error(`✗ No auth user for ${u.email}`)
      continue
    }

    // 2. Upsert profile row.
    const { error: profErr } = await admin
      .from('profiles')
      .upsert(
        {
          user_id: authUser.id,
          business_id: BUSINESS_ID,
          role_id: role.id,
          display_name: u.displayName,
          phone: u.phone,
          is_active: true,
        },
        { onConflict: 'user_id' },
      )
    if (profErr) {
      console.error(`✗ Failed to upsert profile for ${u.email}: ${profErr.message}`)
      continue
    }
    console.log(`  ✓ Profile: ${u.email} → ${u.roleName}`)
  }

  console.log('')
  console.log('━'.repeat(72))
  console.log('  ✅ Seed complete. Test credentials:')
  console.log('━'.repeat(72))
  for (const u of USERS) {
    console.log(`  ${u.roleName.padEnd(14)} ${u.email.padEnd(28)} / ${u.password}`)
  }
  console.log('')
  console.log('  NOTE: NextAuth (credentials provider) still uses the local Prisma')
  console.log('  User table for login. To log in as these Supabase users, you need')
  console.log('  to ALSO create them in the local Prisma DB via the existing')
  console.log('  Phase 1 register/invite flow, OR switch NextAuth to use Supabase')
  console.log('  Auth. For now, the existing local test users still work:')
  console.log('    owner@test.local / password123  (local Prisma)')
  console.log('    accountant@test.local / password123  (local Prisma)')
  console.log('    salesman@test.local / password123  (local Prisma)')
  console.log('    rider@test.local / password123  (local Prisma)')
  console.log('━'.repeat(72))
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
