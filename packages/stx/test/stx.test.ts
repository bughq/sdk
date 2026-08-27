import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { captureException, clientSnippet, close, init } from '../src/index'

let calls: Array<{ url: string, options: any }>
let restoreFetch: () => void

beforeEach(() => {
  calls = []
  const original = (globalThis as any).fetch
  ;(globalThis as any).fetch = mock((url: string, options: any) => {
    calls.push({ url, options })
    return Promise.resolve({ status: 201 })
  })
  restoreFetch = () => { (globalThis as any).fetch = original }
})
afterEach(() => { close(); restoreFetch() })

test('clientSnippet builds the tracking script tag from a key alone', () => {
  expect(clientSnippet({ key: 'pk_1', host: 'http://localhost:3108/' }))
    .toBe('<script src="http://localhost:3108/api/sdk.js" data-key="pk_1"></script>')
})

test('clientSnippet defaults to the hosted loader', () => {
  expect(clientSnippet({ key: 'pk_1' }))
    .toBe('<script src="https://bughq.org/api/sdk.js" data-key="pk_1"></script>')
})

// The loader is served at `/api/sdk.js` and NOT at a bare `/sdk.js` on the
// public origin: `/api/*` is routed to the ingest server, every other GET to
// the web app, so the bare path answers a 404 HTML document that the browser
// refuses to execute. The previous assertion pinned `/sdk.js` against a
// direct-to-ingest host — the one topology where it resolves — so it stayed
// green while every hosted install captured nothing at all.
test('clientSnippet never emits a bare /sdk.js', () => {
  for (const tag of [clientSnippet({ key: 'k' }), clientSnippet({ key: 'k', project: 'acme-9f2c1a' })]) {
    expect(tag).toContain('/api/sdk.js')
    expect(tag).not.toMatch(/[^i]\/sdk\.js/)
  }
})

test('clientSnippet includes data-project only when one is supplied', () => {
  expect(clientSnippet({ key: 'pk_1' })).not.toContain('data-project')
  expect(clientSnippet({ key: 'pk_1', project: 'acme-9f2c1a' }))
    .toBe('<script src="https://bughq.org/api/sdk.js" data-project="acme-9f2c1a" data-key="pk_1"></script>')
})

test('clientSnippet escapes attribute values', () => {
  const tag = clientSnippet({ key: '"><script>alert(1)</script>' })
  expect(tag).not.toContain('<script>alert(1)')
  expect(tag).toContain('&quot;&gt;&lt;script&gt;')
})

// resources/BugHQ.stx is copy-pasted by users and never imported, so nothing
// else would catch a regression in it. These assertions are deliberately about
// the two things that were wrong at 0.2.0: the gate and the path.
test('the BugHQ.stx partial gates on the key alone and uses /api/sdk.js', async () => {
  const partial = await Bun.file(new URL('../resources/BugHQ.stx', import.meta.url)).text()
  // Drop the server block and the stx comments: what matters is the markup
  // that actually renders, not prose that happens to quote the broken path.
  const body = partial.split('</script>').slice(1).join('</script>').replace(/\{\{--[\s\S]*?--\}\}/g, '')
  expect(body).toContain('@if (key)')
  expect(body).not.toContain('project && key')
  expect(body).toContain('/api/sdk.js')
  expect(body).not.toMatch(/[^i]\/sdk\.js/)
})

test('server init + captureException POSTs with a User-Agent header', () => {
  init({ project: 'demo', key: 'k', heartbeat: false, host: 'http://localhost:3108', captureUnhandled: false, dedupeMs: 0 })
  captureException(new RangeError('server boom'))
  expect(calls).toHaveLength(1)
  const opts = calls[0].options
  // Key in the body, not a header — see the note in packages/sdk/test/sdk.test.ts.
  expect(opts.headers['X-BugHQ-Key']).toBeUndefined()
  expect(opts.headers['User-Agent']).toContain('@bughq/stx')
  const body = JSON.parse(opts.body)
  expect(body.key).toBe('k')
  expect(body.type).toBe('RangeError')
  expect(body.framework).toBe('stacks')
})

test('captureUnhandled:false does not add a process listener', () => {
  const before = process.listenerCount('unhandledRejection')
  init({ project: 'demo', key: 'k', heartbeat: false, host: 'http://x', captureUnhandled: false })
  expect(process.listenerCount('unhandledRejection')).toBe(before)
})

test('captureUnhandled (default) installs and close() removes handlers', () => {
  const before = process.listenerCount('unhandledRejection')
  init({ project: 'demo', key: 'k', heartbeat: false, host: 'http://x' })
  expect(process.listenerCount('unhandledRejection')).toBe(before + 1)
  close()
  expect(process.listenerCount('unhandledRejection')).toBe(before)
})
