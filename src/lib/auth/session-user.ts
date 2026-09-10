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
