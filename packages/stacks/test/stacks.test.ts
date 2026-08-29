import type { LogRecord } from '../src/types'
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { bughqTransport, close } from '../src/index'
import { __setRouterBridge } from '../src/router'
import { resetScopes } from '../src/scope'

let calls: Array<{ url: string, options: any }>
let restoreFetch: () => void
let trace: string | undefined
let user: unknown

function record(level: LogRecord['level'], message: string, args: unknown[] = [], at = '2026-08-28T10:00:00.000Z'): LogRecord {
  return { level, message, args: args.length ? args : [message], timestamp: at }
}

function bodies() {
  return calls.map(c => JSON.parse(c.options.body))
}

beforeEach(() => {
  calls = []
  trace = undefined
  user = undefined
  const original = (globalThis as any).fetch
  ;(globalThis as any).fetch = mock((url: string, options: any) => {
    calls.push({ url, options })
    return Promise.resolve({ status: 201 })
  })
  restoreFetch = () => { (globalThis as any).fetch = original }
  __setRouterBridge(() => trace, () => ({ _authenticatedUser: user }))
})

afterEach(() => { close(); resetScopes(); restoreFetch() })

function transport(options = {}) {
  return bughqTransport({ key: 'k', host: 'http://localhost:3108', heartbeat: false, dedupeMs: 0, ...options })
}

test('it is a LogTransport named bughq, with no level filter', () => {
  const t = transport()
  expect(t.name).toBe('bughq')
  expect(typeof t.log).toBe('function')
  // No `level`: the transport must see records BELOW the event threshold,
  // because those are the breadcrumbs.
  expect(t.level).toBeUndefined()
})

test('an error record becomes an event carrying the live Error', () => {
  const t = transport()
  t.log(record('error', 'boom', ['boom', new RangeError('inner')]))
  expect(calls).toHaveLength(1)
  const body = bodies()[0]
  expect(body.type).toBe('RangeError')
  expect(body.framework).toBe('stacks')
  expect(body.sdk.name).toBe('bughq.stacks')
})

test('it scans args for the Error rather than indexing args[0]', () => {
  // report() calls log.error(label, error, context) — the Error is at args[1].
  const t = transport()
  t.log(record('error', '[server] uncaughtException', ['[server] uncaughtException', new TypeError('nope'), {}]))
  expect(bodies()[0].type).toBe('TypeError')
})

test('a record below eventLevel becomes a breadcrumb, not an event', () => {
  const t = transport()
  t.log(record('info', 'just so you know'))
  expect(calls).toHaveLength(0)

  t.log(record('error', 'boom', ['boom', new Error('x')]))
  expect(calls).toHaveLength(1)
  const crumbs = bodies()[0].breadcrumbs
  expect(crumbs.map((c: any) => c.message)).toContain('just so you know')
})

test('breadcrumbs replay oldest-first by timestamp, not arrival order', () => {
  // log.debug dispatches synchronously while log.error awaits init, so arrival
  // order is not chronological.
  const t = transport()
  t.log(record('debug', 'second', ['second'], '2026-08-28T10:00:02.000Z'))
  t.log(record('debug', 'first', ['first'], '2026-08-28T10:00:01.000Z'))
  t.log(record('error', 'boom', ['boom', new Error('x')]))

  const messages = bodies()[0].breadcrumbs.map((c: any) => c.message)
  expect(messages.indexOf('first')).toBeLessThan(messages.indexOf('second'))
})

test('scopes are isolated by trace — one request cannot see another crumbs', () => {
  const t = transport()
  trace = 'req-a'
  t.log(record('info', 'crumb-for-a'))
  trace = 'req-b'
  t.log(record('info', 'crumb-for-b'))
  t.log(record('error', 'boom-b', ['boom-b', new Error('b')]))

  const crumbs = bodies()[0].breadcrumbs.map((c: any) => c.message)
  expect(crumbs).toContain('crumb-for-b')
  expect(crumbs).not.toContain('crumb-for-a')
})

// Guards the atomicity argument: the scope swap is safe only while the SDK
// stays synchronous from dispatch to serialization. If someone awaits inside
// beforeSend, concurrent requests cross-contaminate and this fails loudly.
test('two traces captured in the same tick keep their own user', () => {
  const t = transport()

  trace = 'req-1'
  user = { id: 1, email: 'one@example.test' }
  t.log(record('error', 'one', ['one', new Error('1')]))

  trace = 'req-2'
  user = { id: 2, email: 'two@example.test' }
  t.log(record('error', 'two', ['two', new Error('2')]))

  const [first, second] = bodies()
  expect(first.user.email).toBe('one@example.test')
  expect(second.user.email).toBe('two@example.test')
})

test('identity does not leak into work outside any request', () => {
  const t = transport()
  trace = 'req-1'
  user = { id: 7, email: 'seven@example.test' }
  t.log(record('error', 'in-request', ['in-request', new Error('a')]))

  trace = undefined
  user = undefined
  t.log(record('error', 'out-of-request', ['out-of-request', new Error('b')]))

  // Explicitly null rather than absent: an unset user must CLEAR the previous
  // one, which is the whole point. Absent would be indistinguishable from
  // "we never got round to setting it".
  expect(bodies()[1].user ?? null).toBeNull()
  expect(JSON.stringify(bodies()[1])).not.toContain('seven@example.test')
})

test('the same record delivered twice reports once', () => {
  // registerTransport has no dedupe, so a transport declared in config AND
  // self-registered is in the registry twice and is handed the same record.
  const t = transport()
  const r = record('error', 'boom', ['boom', new Error('x')])
  t.log(r)
  t.log(r)
  expect(calls).toHaveLength(1)
})

test('disabled means no client traffic at all', () => {
  const t = transport({ enabled: false })
  t.log(record('error', 'boom', ['boom', new Error('x')]))
  expect(calls).toHaveLength(0)
})

test('eventLevel is configurable and moves the issue/breadcrumb line', () => {
  const t = transport({ eventLevel: 'warning' })
  t.log(record('warning', 'careful'))
  expect(calls).toHaveLength(1)
  expect(bodies()[0].level).toBe('warning')
})

test('flush resolves through to the client', async () => {
  const t = transport()
  await expect(t.flush!()).resolves.toBeUndefined()
})

test('the factory is idempotent — one client, one transport', () => {
  expect(transport()).toBe(transport())
})
