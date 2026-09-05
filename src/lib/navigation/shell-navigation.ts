/**
 * Navigation inside the KhataPro shell.
 *
 * The application has exactly two real routes — `/` and `/offline`. Every screen
 * the user reaches from inside the app is `/` with different query state, read
 * back by the shell through `useSearchParams()`: `?page=<key>` selects a page,
 * and `?invoice=`, `?ledger=` and `?voucher=` open a detail view over it.
 *
 * That state must be written with the App Router's patched `history.pushState`,
 * not with `router.push()`. `useSearchParams()` is derived from the router's
 * canonical URL. `pushState` updates that URL synchronously and locally, so it
 * cannot fail. `router.push()` only updates it after resolving the target route
 * from the server, and Next discards the navigation silently when that
 * resolution fails — the tap then changes nothing, raises no error and shows no
 * spinner, leaving the previous screen on display. That is exactly how the
 * mobile "More" sheet died, and every same-route `router.push('/?…')` in the app
 * carried the same latent failure.
 *
 * Permissions are unaffected by this seam. The shell is the authority: it
 * resolves `?page=` through PAGE_REGISTRY + isItemVisible on every query change,
 * drops `?ledger=`/`?invoice=`/`?voucher=` the role may not open, falls back to
 * Home and rewrites the corrected URL. A caller cannot widen its own access by
 * writing a URL here.
 *
 * The shell's own `selectItem` keeps its inline copy of this primitive on
 * purpose: it is the deployed, directly asserted seam for sidebar / mobile More
 * / product-tour navigation, and is left untouched.
 */

/** Opens a shell URL: `/`, or `/?…` query state on the same route. */
export function navigateShell(url: string): void {
  window.history.pushState({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Opens a shell page by its registered key. */
export function openShellPage(key: string): void {
  navigateShell(`/?page=${key}`)
}

/** Returns to the shell's default screen, clearing any detail view. */
export function openShellHome(): void {
  navigateShell('/')
}
