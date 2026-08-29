import type { BugHQUser } from '@bughq/sdk'

/**
 * Lazy bridge to `@stacksjs/router`.
 *
 * Loaded through a dynamic import in a try/catch, never a static one. Importing
 * a framework package statically breaks this package in exactly the CLI and
 * worker processes it most needs to survive in — `@stacksjs/config` fails
 * outright from a plain script in a real Stacks app with an unrelated
 * `ENOENT while resolving package` error.
 *
 * The import is async and `LogTransport.log` is synchronous, so the resolved
 * functions are cached here. Until the import lands, `traceId()` returns
 * undefined and work falls back to the process-level scope: a handful of very
 * early records lose per-request grouping, and nothing is dropped.
 */

type TraceFn = () => string | undefined
type RequestFn = () => unknown

let traceFn: TraceFn | null = null
let requestFn: RequestFn | null = null
let attempted = false

/** Variable specifier: an optional peer TypeScript must not resolve. */
const ROUTER = '@stacksjs/router'

export function bridgeRouter(): void {
  if (attempted)
    return
  attempted = true

  void import(ROUTER)
    .then((mod: Record<string, unknown>) => {
      if (typeof mod.getTraceId === 'function')
        traceFn = mod.getTraceId as TraceFn
      if (typeof mod.getCurrentRequest === 'function')
        requestFn = mod.getCurrentRequest as RequestFn
    })
    .catch(() => {
      // No router in this process — a CLI, a worker, a test. Expected.
    })
}

/**
 * Trace id for the current unit of work, or undefined outside one.
 *
 * Covers both units: the router opens `runWithRequest()` per request, and
 * `runJob()` wraps every job in `withTraceId()`, including on the sync driver.
 * AsyncLocalStorage survives the await inside `log.error`, so this resolves
 * correctly from inside the transport callback.
 */
export function traceId(): string | undefined {
  try {
    return traceFn?.() ?? undefined
  }
  catch {
    return undefined
  }
}

/**
 * The authenticated user, read synchronously.
 *
 * `authUser()` is async and cannot be awaited inside `log()`, so this reads
 * `_authenticatedUser` off the request instead — a documented marker on the
 * exported `StacksRequestMarkers` interface, typed `unknown`. Gate on the
 * request first: calling into auth outside a request scope emits four
 * `[RequestContext] Accessing request.X outside of request context` warnings
 * before returning undefined.
 */
export function currentUser(): BugHQUser | null {
  let raw: unknown
  try {
    const req = requestFn?.() as { _authenticatedUser?: unknown } | undefined
    if (!req)
      return null
    raw = req._authenticatedUser
  }
  catch {
    return null
  }

  if (!raw || typeof raw !== 'object')
    return null

  const record = raw as Record<string, unknown>
  const user: BugHQUser = {}

  if (typeof record.id === 'string' || typeof record.id === 'number')
    user.id = record.id
  if (typeof record.email === 'string')
    user.email = record.email

  const name = record.name ?? record.username
  if (typeof name === 'string')
    user.username = name

  return Object.keys(user).length > 0 ? user : null
}

/** Test seam. */
export function __setRouterBridge(trace: TraceFn | null, request: RequestFn | null): void {
  traceFn = trace
  requestFn = request
  attempted = true
}
