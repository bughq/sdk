import type { BugHQConfig } from '@bughq/sdk'

/**
 * True when there's enough config to report: a key, or a dsn that carries one.
 *
 * `project` is NOT required, and requiring it was a real outage. The SDK core
 * went key-only in 7d4875d — an ingest key is globally unique and identifies
 * its project on its own (see BugHQConfig.project in @bughq/sdk, "Optional: the
 * ingest key alone identifies the project"). This wrapper was never updated, so
 * it kept enforcing the older contract.
 *
 * The cost was silent and total. Both runtime plugins return early on a false
 * here, before init(), so an app configured with `bughq: { key }` — which is
 * exactly what the bughq dashboard's own Nuxt snippet prints — captured
 * NOTHING: no console, no breadcrumbs, no errors. No warning and no request,
 * because nothing had loaded to emit one. Two production frontends ran that way
 * for weeks while appearing correctly configured.
 *
 * A `project` is still honoured when given, and is still the way to point one
 * key at a specific project id.
 */
export function bughqEnabled(config: Partial<BugHQConfig> | null | undefined): boolean {
  return !!(config && (config.key || config.dsn))
}
