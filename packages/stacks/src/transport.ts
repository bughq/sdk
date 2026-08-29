import type { BugHQClient } from '@bughq/sdk'
import type { ResolvedOptions } from './config'
import type { LogRecord, LogTransport } from './types'
import { rank, toBugHQLevel } from './levels'
import { currentUser, traceId } from './router'
import { pushCrumb, scopeFor, withScope } from './scope'

/**
 * The record the dispatcher hands every transport is ONE object, shared across
 * transports. That makes identity an exact dedupe key — and it is needed,
 * because `registerTransport` has no deduplication of its own: the same
 * transport declared in `config/logging.ts` AND self-registered appears twice
 * in the registry and would otherwise report every event twice.
 */
const seen = new WeakSet<LogRecord>()

export function createTransport(client: BugHQClient, opts: ResolvedOptions): LogTransport {
  const threshold = rank(opts.eventLevel)

  return {
    name: 'bughq',
    // Deliberately no `level`: the transport must see records BELOW the event
    // threshold, because those are the breadcrumbs. Filtering happens here.

    log(record: LogRecord): void {
      if (seen.has(record))
        return
      seen.add(record)

      try {
        deliver(client, opts, threshold, record)
      }
      catch {
        // A transport that throws is named once on stderr and then permanently
        // muted by the dispatcher. Losing bughq for the life of the process
        // because one record had a surprising shape is not a trade worth making.
      }
    },

    flush(): Promise<void> {
      return client.flush().then(() => undefined)
    },
  }
}

function deliver(client: BugHQClient, opts: ResolvedOptions, threshold: number, record: LogRecord): void {
  const scope = scopeFor(traceId())

  if (rank(record.level) < threshold) {
    if (opts.logCrumbs) {
      pushCrumb(scope, {
        type: 'log',
        category: `log.${record.level}`,
        message: record.message,
        level: toBugHQLevel(record.level),
        timestamp: record.timestamp,
      }, opts.maxBreadcrumbs)
    }
    return
  }

  if (opts.captureUser && !scope.user)
    scope.user = currentUser()

  const err = findError(record.args)
  const extra = extraFrom(record)

  withScope(client, scope, () => {
    if (err)
      client.captureException(err, extra)
    else
      client.captureMessage(record.message, toBugHQLevel(record.level), extra)
  })
}

/**
 * Scan the arguments for an Error — never index args[0].
 *
 * The framework's own `report()` calls `log.error(label, error, context)`, so on
 * the path that matters most the Error sits at args[1]. Measured shape:
 * `args: ['[server] uncaughtException', Error(…), {}]`.
 */
function findError(args: unknown[]): Error | undefined {
  for (const arg of args) {
    if (arg instanceof Error)
      return arg
  }
  return undefined
}

function extraFrom(record: LogRecord): Record<string, unknown> {
  const extra: Record<string, unknown> = { log_level: record.level }

  // `record.context` is undefined outside a request — measured, not assumed.
  // The populated key is `trace_id`; nothing in the framework sets `requestId`.
  if (record.context && typeof record.context === 'object') {
    for (const [key, value] of Object.entries(record.context)) {
      if (value !== undefined)
        extra[key] = value
    }
  }

  const details = record.args.filter(a => a !== undefined && !(a instanceof Error))
  if (details.length > 0)
    extra.log_args = details.map(describe)

  return extra
}

/** Keep extras small and serializable; the SDK scrubs strings downstream. */
function describe(value: unknown): unknown {
  if (value === null || typeof value !== 'object')
    return value
  try {
    return JSON.parse(JSON.stringify(value))
  }
  catch {
    return '[unserializable]'
  }
}

/** Test seam: the WeakSet is module state and must not leak between tests. */
export function __forget(record: LogRecord): void {
  seen.delete(record)
}
