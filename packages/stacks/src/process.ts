import type { BugHQClient } from '@bughq/sdk'

/**
 * Opt-in process handlers, for workers that install none of their own.
 *
 * Off by default, and that default matters. Attaching an `uncaughtException`
 * listener suppresses the runtime's terminate-on-fault, so a handler that
 * merely reports turns a crash into a zombie — a worker that keeps polling with
 * a dead pool while the supervisor sees a healthy process. These handlers
 * therefore flush and then re-raise, rather than swallowing.
 *
 * The built server entry already installs its own reporting handlers, which is
 * why this is not on by default there.
 */
export function installProcessHandlers(client: BugHQClient): () => void {
  if (typeof process === 'undefined' || typeof process.on !== 'function')
    return () => {}

  const onException = (err: unknown): void => {
    client.captureException(err, { fatal: true })
    // Flush, then let the process die as it would have without us. Restoring
    // the default behaviour is the point: an error tracker must not change
    // whether the app stays up.
    void client.flush(2000).finally(() => {
      console.error(err)
      process.exit(1)
    })
  }

  const onRejection = (reason: unknown): void => {
    client.captureException(reason, { unhandledRejection: true })
    // console.error too: without it, installing this listener silently converts
    // a rejection that would have printed and exited into zero output, exit 0.
    console.error(reason)
  }

  process.on('uncaughtException', onException)
  process.on('unhandledRejection', onRejection)

  return () => {
    process.off('uncaughtException', onException)
    process.off('unhandledRejection', onRejection)
  }
}
