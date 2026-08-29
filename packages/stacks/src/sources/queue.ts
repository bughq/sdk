import { getClient } from '../client'

/**
 * Job context for failed jobs.
 *
 * ANNOTATE ONLY — never capture here. The queue already calls
 * `log.error('Job failed …', event.error)` with the live Error, so the
 * transport has captured it before this handler runs. Capturing again would
 * double-report every failure. This is the same split the Laravel package
 * documents, for the same reason.
 *
 * `job:failed` omits the job name, so `job:processing` is used to remember the
 * id → name mapping. That is the only thing it is used for: it is emphatically
 * NOT a scope reset. Resetting per job would be correct under Octane and wrong
 * under Bun, where units of work interleave.
 */

const names = new Map<string, string>()
const MAX_TRACKED = 1000

let attached = false

/** Variable specifier: an optional peer TypeScript must not resolve. */
const QUEUE = '@stacksjs/queue'

export function attachQueueSources(): void {
  if (attached)
    return
  attached = true

  void import(QUEUE)
    .then((mod: Record<string, unknown>) => {
      const on = mod.onQueueEvent
      if (typeof on !== 'function')
        return

      const subscribe = on as (event: string, handler: (payload: unknown) => void) => unknown

      subscribe('job:processing', (payload) => {
        const { id, name } = fields(payload)
        if (!id || !name)
          return
        if (names.size >= MAX_TRACKED)
          names.clear()
        names.set(id, name)
      })

      subscribe('job:failed', (payload) => {
        const client = getClient()
        if (!client)
          return
        const { id, name } = fields(payload)
        const resolved = name ?? (id ? names.get(id) : undefined)
        client.setContext('job', {
          ...(resolved ? { name: resolved } : {}),
          ...(id ? { id } : {}),
        })
        client.setTag('queue_failure', 'true')
        if (id)
          names.delete(id)
      })
    })
    .catch(() => {
      // No queue in this process. Expected in a web-only or CLI process.
    })
}

function fields(payload: unknown): { id?: string, name?: string } {
  if (!payload || typeof payload !== 'object')
    return {}
  const record = payload as Record<string, unknown>
  const id = record.jobId ?? record.id
  const name = record.jobName ?? record.name
  return {
    id: typeof id === 'string' || typeof id === 'number' ? String(id) : undefined,
    name: typeof name === 'string' ? name : undefined,
  }
}

/** Test seam. */
export function __resetQueueSources(): void {
  names.clear()
  attached = false
}
