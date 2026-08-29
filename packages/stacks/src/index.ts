/**
 * @bughq/stacks — bughq error tracking for Stacks apps, installed as a log
 * transport.
 *
 * ```ts
 * // config/logging.ts
 * import { bughqTransport } from '@bughq/stacks'
 *
 * export default {
 *   logsPath: storagePath('logs/stacks.log'),
 *   deploymentsPath: storagePath('logs/deployments.log'),
 *   transports: [bughqTransport()],
 * } satisfies LoggingConfig
 * ```
 *
 * Records at or above `eventLevel` become issues; everything below becomes a
 * breadcrumb on the same trace. Failed jobs and router 500s arrive for free,
 * because the framework already logs both with the live Error attached.
 */
import type { Breadcrumb, BugHQClient, BugHQUser, Level } from '@bughq/sdk'
import type { BugHQStacksOptions } from './config'
import type { LogTransport } from './types'
import { closeClient, ensureClient, getClient } from './client'
import { resolveOptions } from './config'
import { bridgeRouter } from './router'
import { installProcessHandlers } from './process'
import { attachQueueSources } from './sources/queue'
import { createTransport } from './transport'

export type { BugHQStacksOptions, ResolvedOptions } from './config'
export type { LogContext, LogRecord, LogTransport, StacksLogLevel } from './types'
export type { Breadcrumb, BugHQClient, BugHQUser, Level }
export { defineBugHQ } from './config'

let transport: LogTransport | null = null

/**
 * Build the bughq transport and attach it.
 *
 * Returned synchronously so it can sit inline in `config/logging.ts`, and
 * self-registering because a config-declared transport alone is not reliable
 * today: `initLogger` reads a module-load snapshot of config rather than the
 * live proxy and memoizes it, and `log.debug` returns before init when no
 * transport is attached yet. Registering here closes both. The registry has no
 * dedupe of its own, so appearing twice is expected and handled — the record
 * identity WeakSet in the transport makes double delivery a no-op.
 */
export function bughqTransport(options: BugHQStacksOptions = {}): LogTransport {
  if (transport)
    return transport

  const opts = resolveOptions(options)
  const client = ensureClient(opts.client)

  transport = createTransport(client, opts)
  bridgeRouter()

  if (opts.enabled) {
    void register(transport)
    if (opts.queueFailures)
      attachQueueSources()
    if (opts.unhandled)
      installProcessHandlers(client)
  }

  return transport
}

/**
 * Attach bughq in a process that never reads `config/logging.ts` — a queue
 * worker, a CLI command, the compiled binary path where `SKIP_CONFIG_LOADING`
 * means the config file is never loaded at all.
 *
 * Returns a detach function.
 */
export function install(options: BugHQStacksOptions = {}): () => void {
  const t = bughqTransport(options)
  let detach: (() => void) | null = null
  void register(t).then((fn) => { detach = fn })
  return () => {
    detach?.()
    detach = null
  }
}

const LOGGING = '@stacksjs/logging'

async function register(t: LogTransport): Promise<(() => void) | null> {
  try {
    // Variable specifier on purpose: @stacksjs/logging is an OPTIONAL peer, so
    // it is absent from this repo and from any process that does not boot the
    // framework. A literal specifier makes TypeScript resolve it at build time
    // and the .d.ts build fails on a module that is not meant to be there.
    const mod = await import(LOGGING) as {
      registerTransport?: (t: LogTransport) => () => void
      transports?: () => readonly LogTransport[]
    }
    if (typeof mod.registerTransport !== 'function')
      return null
    // Idempotency gate: never construct or attach a second bughq transport,
    // however many times config/logging.ts is evaluated in this process.
    if (mod.transports?.().some(existing => existing.name === 'bughq'))
      return null
    return mod.registerTransport(t)
  }
  catch {
    return null
  }
}

/** Manual capture. The facade equivalent, as an object rather than a class. */
export const bughq = {
  captureException(err: unknown, extra?: Record<string, unknown>): void {
    getClient()?.captureException(err, extra)
  },
  captureMessage(message: string, level: Level = 'info', extra?: Record<string, unknown>): void {
    getClient()?.captureMessage(message, level, extra)
  },
  addBreadcrumb(crumb: Breadcrumb): void {
    getClient()?.addBreadcrumb(crumb)
  },
  setUser(user: BugHQUser | null): void {
    getClient()?.setUser(user)
  },
  setTag(key: string, value: string): void {
    getClient()?.setTag(key, value)
  },
  setContext(name: string, context: Record<string, unknown> | null): void {
    getClient()?.setContext(name, context)
  },
  /**
   * Drain the queue. Worth calling before a deliberate `process.exit()`, which
   * otherwise drops in-flight sends — the framework's own `report()` write is
   * not registered in the set `log.flush()` awaits, so the built server's
   * `report(); log.flush().finally(exit)` is a microtask race.
   */
  flush(timeoutMs?: number): Promise<boolean> {
    const client = getClient()
    return client ? client.flush(timeoutMs) : Promise.resolve(true)
  },
  getClient(): BugHQClient | null {
    return getClient()
  },
}

export { getClient }

/** Tear down. Primarily a test seam; also correct in a long-lived REPL. */
export function close(): void {
  transport = null
  closeClient()
}

export default bughq
