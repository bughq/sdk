import type { Breadcrumb, BugHQClient, BugHQUser, Level } from '@bughq/sdk'

/**
 * Per-unit-of-work scope, keyed by trace id.
 *
 * The Laravel package resets the client on `JobProcessing` because Octane
 * serves one request per worker at a time. Under Bun, requests genuinely
 * interleave — a global reset would clear another in-flight request's
 * breadcrumbs and identity. So scope is never held on the client: it lives in a
 * map keyed by the router's trace id, and is swapped onto the client only for
 * the synchronous instant a capture takes.
 */

export interface Scope {
  crumbs: Breadcrumb[]
  user: BugHQUser | null
  request: Record<string, unknown> | null
  level: Level | null
  touched: number
}

/** Cap on live scopes. There is no scope-ended callback, so eviction is ours. */
const MAX_SCOPES = 500
/** A scope older than this cannot belong to a request still in flight. */
const SCOPE_TTL_MS = 5 * 60_000

const scopes = new Map<string, Scope>()

/** Scope for work happening outside any request or job. */
const processScope: Scope = { crumbs: [], user: null, request: null, level: null, touched: 0 }

function evict(now: number): void {
  for (const [key, scope] of scopes) {
    if (now - scope.touched > SCOPE_TTL_MS)
      scopes.delete(key)
  }
  // Map iterates in insertion order, so the front is the least recently added.
  while (scopes.size > MAX_SCOPES) {
    const oldest = scopes.keys().next()
    if (oldest.done)
      break
    scopes.delete(oldest.value)
  }
}

export function scopeFor(traceId: string | undefined, now = Date.now()): Scope {
  if (!traceId)
    return processScope

  const existing = scopes.get(traceId)
  if (existing) {
    existing.touched = now
    return existing
  }

  const fresh: Scope = { crumbs: [], user: null, request: null, level: null, touched: now }
  scopes.set(traceId, fresh)
  if (scopes.size > MAX_SCOPES || scopes.size % 64 === 0)
    evict(now)
  return fresh
}

export function pushCrumb(scope: Scope, crumb: Breadcrumb, max: number): void {
  scope.crumbs.push(crumb)
  if (scope.crumbs.length > max)
    scope.crumbs.splice(0, scope.crumbs.length - max)
}

/**
 * Apply a scope, capture, restore — with NO await in between.
 *
 * That is the whole safety argument. `LogTransport.log` is synchronous and the
 * SDK's `dispatch` snapshots the client's fields synchronously before its
 * fire-and-forget send, so nothing can interleave on a single-threaded event
 * loop. If the SDK ever awaits before serializing, this becomes a silent
 * cross-request leak — which is what the concurrency test guards.
 */
export function withScope(client: BugHQClient, scope: Scope, capture: () => void): void {
  client.clearBreadcrumbs()
  // Breadcrumbs are replayed oldest-first by timestamp, not arrival order:
  // log.debug dispatches synchronously while log.error awaits init first, so
  // arrival order is not chronological.
  const ordered = [...scope.crumbs].sort(byTimestamp)
  for (const crumb of ordered)
    client.addBreadcrumb(crumb)

  // Explicit null, never a skipped call: an unset user must clear the previous
  // one rather than inherit a stale identity from another trace.
  client.setUser(scope.user)
  client.setContext('request', scope.request)
  client.setLevel(scope.level)

  try {
    capture()
  }
  finally {
    client.setLevel(null)
    client.setUser(null)
    client.setContext('request', null)
    client.clearBreadcrumbs()
  }
}

function byTimestamp(a: Breadcrumb, b: Breadcrumb): number {
  return String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? ''))
}

/** Test seam. */
export function resetScopes(): void {
  scopes.clear()
  processScope.crumbs.length = 0
  processScope.user = null
  processScope.request = null
  processScope.level = null
}

export function scopeCount(): number {
  return scopes.size
}
