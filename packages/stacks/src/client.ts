import type { BugHQConfig } from '@bughq/sdk'
import { BugHQClient } from '@bughq/sdk'

/**
 * One client per process, parked on a global symbol.
 *
 * Module state is not enough. The framework's transport registry is a plain
 * module-scoped array with no `Symbol.for` sharing, so a tree that resolves two
 * physical copies of `@stacksjs/logging` — which this repo has been in before —
 * gets two registries. Anchoring the client to a well-known global means the
 * duplicate graphs at least converge on one client, one queue and one heartbeat
 * rather than silently doubling everything.
 */
const SLOT = Symbol.for('@bughq/stacks:client')

interface Slot { [SLOT]?: BugHQClient | null }

export function getClient(): BugHQClient | null {
  return (globalThis as Slot)[SLOT] ?? null
}

export function setClient(client: BugHQClient | null): void {
  (globalThis as Slot)[SLOT] = client
}

export function ensureClient(config: BugHQConfig): BugHQClient {
  const existing = getClient()
  if (existing)
    return existing

  const client = new BugHQClient({
    ...config,
    framework: config.framework ?? 'stacks',
    sdkName: config.sdkName ?? 'bughq.stacks',
    userAgent: config.userAgent ?? '@bughq/stacks (+server; Bun)',

    // Two overrides that are not negotiable on a server.
    //
    // autoInstrument: the SDK's console channel sits deliberately OUTSIDE the
    // browser guard, so on a server it would patch `console` — and the
    // framework's console writer is downstream of the transport, so bughq would
    // capture its own output and feed itself.
    autoInstrument: false,
    // captureUnhandled: the SDK's own handlers early-return without a `window`,
    // and the built server entry already installs process handlers. Ours are
    // opt-in through `capture.unhandled` instead, for workers that have none.
    captureUnhandled: false,
  })

  setClient(client)
  return client
}

export function closeClient(): void {
  const client = getClient()
  client?.close()
  setClient(null)
}
