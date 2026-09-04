export type RiderIdentitySource = {
  userId: string
  supabaseUserUuid: string | null
  profileId: string
}

/** Ordered, de-duplicated identity values supported by deployed Rider schemas. */
export function riderIdentityCandidates(user: RiderIdentitySource): string[] {
  return Array.from(new Set([
    user.userId,
    user.supabaseUserUuid ?? '',
    user.profileId,
  ].filter(Boolean)))
}
