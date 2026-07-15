/**
 * One-time owner bootstrap utility for Supabase Auth.
 *
 * Behavior:
 *  - Default: dry-run (prints what would happen)
 *  - Requires explicit --execute flag to make changes
 *
 * Reads configuration from environment variables (never from CLI args):
 * Required:
 *  - BOOTSTRAP_SUPABASE_URL
 *  - BOOTSTRAP_SUPABASE_SERVICE_ROLE_KEY
 *  - BOOTSTRAP_OWNER_EMAIL
 *  - BOOTSTRAP_OWNER_PASSWORD
 *  - BOOTSTRAP_OWNER_NAME
 * Optional:
 *  - BOOTSTRAP_BUSINESS_NAME
 *
 * Never prints passwords, tokens, keys, hashes, or raw provider errors.
 * Email may be shown in masked form only.
 *
 * Usage:
 *  # Dry run
 *  npx tsx scripts/bootstrap-supabase-owner.ts
 *
 *  # Execute
 *  npx tsx scripts/bootstrap-supabase-owner.ts --execute
 *
 * Safety:
 *  - Skips if any active owner already exists
 *  - Reuses existing Supabase Auth user if email already registered
 *  - Creates missing profile only for the exact owner bootstrap case
 *  - No migration is applied
 *  - No existing profiles/roles/permissions are modified
 *  - Compensates by deleting newly created Auth user if profile creation fails
 */

/// <reference types="node" />

import { createClient } from '@supabase/supabase-js'

const DRY_RUN = !process.argv.includes('--execute')

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain || local.length <= 2) return '***@' + domain
  return local.slice(0, 2) + '***@' + domain
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.includes('your-')) {
    console.error(`Missing or placeholder value for ${name}. Set it in .env.local.`)
    process.exit(1)
  }
  return value
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function main() {
  console.log('=== Supabase Owner Bootstrap ===')
  if (DRY_RUN) {
    console.log('Mode: DRY RUN (no changes will be made)')
    console.log('Pass --execute to apply changes.')
  } else {
    console.log('Mode: EXECUTE')
  }

  const url = requireEnv('BOOTSTRAP_SUPABASE_URL')
  const serviceRoleKey = requireEnv('BOOTSTRAP_SUPABASE_SERVICE_ROLE_KEY')
  const rawEmail = requireEnv('BOOTSTRAP_OWNER_EMAIL')
  const rawPassword = requireEnv('BOOTSTRAP_OWNER_PASSWORD')
  const rawName = requireEnv('BOOTSTRAP_OWNER_NAME')
  const businessName = process.env.BOOTSTRAP_BUSINESS_NAME || ''

  const email = rawEmail.trim().toLowerCase()
  const name = rawName.trim()
  const password = rawPassword

  if (!validateEmail(email)) {
    console.error('Invalid BOOTSTRAP_OWNER_EMAIL format.')
    process.exit(1)
  }
  if (password.length < 6) {
    console.error('BOOTSTRAP_OWNER_PASSWORD must be at least 6 characters.')
    process.exit(1)
  }
  if (name.length < 1 || name.length > 80) {
    console.error('BOOTSTRAP_OWNER_NAME must be 1-80 characters.')
    process.exit(1)
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const businessId = 'biz-default'

  // 1) Check for existing active owner
  const { data: ownerRole, error: roleError } = await admin
    .from('roles')
    .select('id')
    .eq('business_id', businessId)
    .eq('name', 'Owner/Admin')
    .eq('is_system', true)
    .single()

  if (roleError || !ownerRole) {
    console.error('Owner/Admin role not seeded in Supabase.')
    process.exit(1)
  }
  const ownerRoleId = ownerRole.id

  const { count, error: countError } = await admin
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('role_id', ownerRoleId)
    .eq('is_active', true)

  if (countError) {
    console.error('Failed to check owner existence.')
    process.exit(1)
  }

  if ((count ?? 0) > 0) {
    console.log('An active owner already exists. Aborting.')
    process.exit(0)
  }

  console.log('No active owner exists.')

  // 2) Look up existing Auth user by email
  const { data: listData, error: listError } = await admin.auth.admin.listUsers()
  if (listError) {
    console.error('Failed to list users.')
    process.exit(1)
  }

  const existingAuthUser = (listData?.users ?? []).find((u) => u.email === email) ?? null

  // 3) If Auth user exists, check for existing profile
  if (existingAuthUser) {
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('business_id, role_id, is_active')
      .eq('user_id', existingAuthUser.id)
      .single()

    if (existingProfile) {
      if (existingProfile.business_id !== businessId) {
        console.error('Existing Auth user has a cross-business profile. Aborting.')
        process.exit(1)
      }
      if (!existingProfile.is_active) {
        console.error('Existing Auth user profile is inactive. Aborting.')
        process.exit(1)
      }
      if (existingProfile.role_id !== ownerRoleId) {
        console.error('Existing Auth user profile role mismatch. Aborting.')
        process.exit(1)
      }
      console.log('Existing Auth user already has a matching active owner profile. Aborting.')
      process.exit(0)
    }
  }

  // 4) From here on, no database writes in dry-run
  if (DRY_RUN) {
    if (existingAuthUser) {
      console.log(`Would create missing owner profile for existing Auth user (${maskEmail(email)}).`)
    } else {
      console.log(`Would create new Auth user (${maskEmail(email)}) and owner profile.`)
    }
    if (businessName) {
      console.log('Would update business name in public.business.')
    }
    return
  }

  // 5) Execute mode
  let createdNewAuthUser = false
  let authUserId: string

  if (existingAuthUser) {
    authUserId = existingAuthUser.id
    console.log('Reusing existing Auth user.')
  } else {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createError || !created.user) {
      console.error('Failed to create Auth user.')
      process.exit(1)
    }
    authUserId = created.user.id
    createdNewAuthUser = true
    console.log('Created new Auth user.')
  }

  // 6) Create profile
  const { error: profileError } = await admin
    .from('profiles')
    .insert({
      user_id: authUserId,
      business_id: businessId,
      role_id: ownerRoleId,
      display_name: name,
      phone: null,
      is_active: true,
    })

  if (profileError) {
    console.error('Failed to create owner profile.')
    if (createdNewAuthUser) {
      try {
        await admin.auth.admin.deleteUser(authUserId)
      } catch {
        // ignore cleanup failure
      }
    }
    process.exit(1)
  }

  console.log('Owner profile created.')

  // 7) Optionally update business name
  if (businessName) {
    const { error: bizError } = await admin
      .from('business')
      .update({ name: businessName })
      .eq('id', businessId)

    if (bizError) {
      console.error('Failed to update business name.')
      process.exit(1)
    }
    console.log('Business name updated.')
  }

  console.log('Owner bootstrap completed successfully.')
}

main().catch(() => {
  console.error('Bootstrap failed.')
  process.exit(1)
})