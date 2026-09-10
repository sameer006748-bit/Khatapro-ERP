export type SessionUser = {
  userId: string
  supabaseUserUuid: string | null
  profileId: string
  businessId: string
  roleId: string
  roleName: string
  displayName: string
  email: string
  phone: string | null
  permissions: Set<string>
}

type DatabaseSessionContext = {
  profile_id: string
  business_id: string
  role_id: string
  role_name: string
  display_name: string
  phone: string | null
  permission_codes: string[]
}

type HydratedSessionUser = {
  id: string
  supabaseUserUuid: string | null
  profileId: string
  businessId: string
  roleId: string
  roleName: string
  displayName: string
  email: string
  phone: string | null
  permissions: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Convert the single database-context RPC row into the same SessionUser shape
 * used by the former profile/role/permission query chain. Every authority
 * field is required and malformed database output fails closed.
 */
export function sessionUserFromDatabaseContext(
  identity: { id: string; email: string },
  value: unknown,
): SessionUser | null {
  if (!isNonEmptyString(identity.id) || typeof identity.email !== 'string' || !isRecord(value)) {
    return null
  }

  const candidate: DatabaseSessionContext = {
    profile_id: isNonEmptyString(value.profile_id) ? value.profile_id : '',
    business_id: isNonEmptyString(value.business_id) ? value.business_id : '',
    role_id: isNonEmptyString(value.role_id) ? value.role_id : '',
    role_name: isNonEmptyString(value.role_name) ? value.role_name : '',
    display_name: isNonEmptyString(value.display_name) ? value.display_name : '',
    phone: value.phone === null || typeof value.phone === 'string' ? value.phone : null,
    permission_codes: Array.isArray(value.permission_codes) && value.permission_codes.every(isNonEmptyString)
      ? value.permission_codes
      : [],
  }

  if (
    !candidate.profile_id
    || !candidate.business_id
    || !candidate.role_id
    || !candidate.role_name
    || !candidate.display_name
    || (value.phone !== null && typeof value.phone !== 'string')
    || !Array.isArray(value.permission_codes)
    || !value.permission_codes.every(isNonEmptyString)
  ) return null

  return {
    userId: identity.id,
    supabaseUserUuid: identity.id,
    profileId: candidate.profile_id,
    businessId: candidate.business_id,
    roleId: candidate.role_id,
    roleName: candidate.role_name,
    displayName: candidate.display_name,
    email: identity.email,
    phone: candidate.phone,
    permissions: new Set(candidate.permission_codes),
  }
}

/**
 * Rebuild the internal authorization context from the authoritative fields that
 * the NextAuth session callback hydrated during this request. Missing or
 * malformed fields fail closed; no role or permission defaults are inferred.
 */
export function sessionUserFromHydratedUser(value: unknown): SessionUser | null {
  if (!isRecord(value)) return null

  const candidate: HydratedSessionUser = {
    id: isNonEmptyString(value.id) ? value.id : '',
    supabaseUserUuid: value.supabaseUserUuid === null || isNonEmptyString(value.supabaseUserUuid)
      ? value.supabaseUserUuid
      : null,
    profileId: isNonEmptyString(value.profileId) ? value.profileId : '',
    businessId: isNonEmptyString(value.businessId) ? value.businessId : '',
    roleId: isNonEmptyString(value.roleId) ? value.roleId : '',
    roleName: isNonEmptyString(value.roleName) ? value.roleName : '',
    displayName: isNonEmptyString(value.displayName) ? value.displayName : '',
    email: typeof value.email === 'string' ? value.email : '',
    phone: value.phone === null || typeof value.phone === 'string' ? value.phone : null,
    permissions: Array.isArray(value.permissions) && value.permissions.every(isNonEmptyString)
      ? value.permissions
      : [],
  }

  if (
    !candidate.id
    || !candidate.profileId
    || !candidate.businessId
    || !candidate.roleId
    || !candidate.roleName
    || !candidate.displayName
    || typeof value.email !== 'string'
    || (value.supabaseUserUuid !== null && !isNonEmptyString(value.supabaseUserUuid))
    || (value.phone !== null && typeof value.phone !== 'string')
    || !Array.isArray(value.permissions)
    || !value.permissions.every(isNonEmptyString)
  ) return null

  return {
    userId: candidate.id,
    supabaseUserUuid: candidate.supabaseUserUuid,
    profileId: candidate.profileId,
    businessId: candidate.businessId,
    roleId: candidate.roleId,
    roleName: candidate.roleName,
    displayName: candidate.displayName,
    email: candidate.email,
    phone: candidate.phone,
    permissions: new Set(candidate.permissions),
  }
}
