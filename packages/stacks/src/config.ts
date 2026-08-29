import type { BugHQConfig } from '@bughq/sdk'
import type { StacksLogLevel } from './types'

export interface BugHQStacksOptions extends BugHQConfig {
  /**
   * Records at or above this level become ISSUES; everything below becomes a
   * breadcrumb. Default `error`.
   *
   * This is not the same as `LogTransport.level`, which the framework uses to
   * decide whether to deliver a record at all. The transport deliberately
   * attaches with no level filter so breadcrumbs work without anyone having to
   * touch LOG_LEVEL.
   */
  eventLevel?: StacksLogLevel

  breadcrumbs?: {
    /** Log records below `eventLevel`. Free — they already reach the transport. */
    logs?: boolean
    /** Max crumbs retained per trace. Default 30. */
    maxBreadcrumbs?: number
  }

  capture?: {
    /** Attach the authenticated user to events. Default true. */
    user?: boolean
    /** Annotate failed jobs with job context. The transport captures them either way. */
    queueFailures?: boolean
    /**
     * Install process-level handlers. Default false — the built server entry
     * already installs its own. Turn on for queue workers, which install none.
     */
    unhandled?: boolean
  }
}

export interface ResolvedOptions {
  client: BugHQConfig
  eventLevel: StacksLogLevel
  logCrumbs: boolean
  maxBreadcrumbs: number
  captureUser: boolean
  queueFailures: boolean
  unhandled: boolean
  enabled: boolean
}

function env(key: string): string | undefined {
  // process.env, not @stacksjs/env: env.d.ts is generated from an untracked
  // .env, so a key absent at generation time is a type error in a consumer's
  // build even when the variable is set at runtime.
  const value = typeof process !== 'undefined' ? process.env?.[key] : undefined
  return value === '' ? undefined : value
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = env(key)
  if (raw === undefined)
    return fallback
  return raw !== 'false' && raw !== '0'
}

/**
 * Resolve in one synchronous pass: explicit options win, then `BUGHQ_*`, then
 * defaults.
 *
 * There is deliberately no self-loading of a `config/bughq.ts`. Stacks' config
 * loader iterates a hardcoded list of sections and will never include a new
 * namespace, so the alternative is a dynamic `import()` — which is async, would
 * make this factory async, and is exactly the sort of thing that turns a
 * config file evaluated many times per process into many clients. A user who
 * wants a config file imports it and passes it in, which is explicit, typed,
 * and synchronous.
 */
export function resolveOptions(options: BugHQStacksOptions = {}): ResolvedOptions {
  const { eventLevel, breadcrumbs, capture, ...client } = options

  const sampleRate = client.sampleRate ?? numberFromEnv('BUGHQ_SAMPLE_RATE')
  const enabled = client.enabled ?? envBool('BUGHQ_ENABLED', true)

  return {
    client: {
      ...client,
      dsn: client.dsn ?? env('BUGHQ_DSN'),
      project: client.project ?? env('BUGHQ_PROJECT'),
      key: client.key ?? env('BUGHQ_KEY'),
      // No default host: it would override the host embedded in a DSN.
      host: client.host ?? env('BUGHQ_HOST'),
      release: client.release ?? env('BUGHQ_RELEASE'),
      environment: client.environment ?? env('BUGHQ_ENVIRONMENT') ?? env('APP_ENV'),
      enabled,
      ...(sampleRate === undefined ? {} : { sampleRate }),
    },
    eventLevel: eventLevel ?? 'error',
    logCrumbs: breadcrumbs?.logs ?? true,
    maxBreadcrumbs: breadcrumbs?.maxBreadcrumbs ?? 30,
    captureUser: capture?.user ?? true,
    queueFailures: capture?.queueFailures ?? true,
    unhandled: capture?.unhandled ?? envBool('BUGHQ_CAPTURE_UNHANDLED', false),
    enabled,
  }
}

function numberFromEnv(key: string): number | undefined {
  const raw = env(key)
  if (raw === undefined)
    return undefined
  // Number(), not the framework's env proxy: it only coerces integers for keys
  // ending _PORT/_TIMEOUT/_TTL/_SIZE/_LIMIT/_MAX/_MIN/_INTERVAL/_RETRIES/
  // _CONCURRENCY/_WORKERS/_CONNECTIONS, so BUGHQ_SAMPLE_RATE arrives a string.
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Identity helper, matching the defineApp / defineDatabase idiom. */
export function defineBugHQ(config: BugHQStacksOptions): BugHQStacksOptions {
  return config
}
