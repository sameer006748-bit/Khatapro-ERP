/**
 * How a permission denial becomes an HTTP answer.
 *
 * `requirePermission` and `requireOwner` deny by throwing an Error that carries
 * the status they mean. The route wrappers used to catch that throw and answer
 * 500 REQUEST_FAILED, so on production a Salesman writing to a rider route got
 * an empty 500 and an owner-only read got "The request could not be completed."
 *
 * The rule lives here, free of `next/server`, so it can be exercised directly
 * in tests the way the other compatibility modules are.
 */

export type DeniedStatus = 401 | 403

/**
 * Only the two statuses the guards actually set are honored. Trusting any
 * numeric `status` on any thrown value would let a provider or database error
 * choose its own response code.
 */
export function deniedStatusFromError(error: unknown): DeniedStatus | null {
  const status = (error as { status?: unknown } | null)?.status
  return status === 401 || status === 403 ? status : null
}

export function deniedErrorCode(status: DeniedStatus): 'UNAUTHORIZED' | 'FORBIDDEN' {
  return status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN'
}
