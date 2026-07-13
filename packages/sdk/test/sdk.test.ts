import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { BugHQClient, captureException, close, init, parseDsn, parseUserAgent, report, SDK_NAME } from '../src/index'

// Capture outgoing requests by stubbing global fetch.
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
afterEach(() => restoreFetch())

const cfg = { project: 'demo', key: 'k_123', host: 'http://localhost:3108', dedupeMs: 0 }

function lastBody(): any {
  return JSON.parse(calls[calls.length - 1].options.body)
}

describe('parseDsn', () => {
  test('parses key@host/project', () => {
    expect(parseDsn('https://abc123@bughq.org/acme-web-9f2c')).toEqual({
      host: 'https://bughq.org',
      key: 'abc123',
      project: 'acme-web-9f2c',
    })
  })
  test('returns null without a project', () => {
    expect(parseDsn('https://abc@bughq.org/')).toBeNull()
    expect(parseDsn('not a url')).toBeNull()
  })
})

describe('parseUserAgent', () => {
  test('extracts Chrome on macOS', () => {
    const r = parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36')
    expect(r.browser).toBe('Chrome 126')
    expect(r.os).toBe('macOS')
  })
  test('empty ua -> {}', () => {
    expect(parseUserAgent('')).toEqual({})
  })
})

describe('BugHQClient', () => {
  test('captureException POSTs the correct contract', async () => {
    const c = new BugHQClient(cfg)
    c.captureException(new TypeError('boom at x'))
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://localhost:3108/errors')
    expect(calls[0].options.method).toBe('POST')
    expect(calls[0].options.headers['X-BugHQ-Key']).toBe('k_123')
    const body = JSON.parse(calls[0].options.body)
    expect(body.project).toBe('demo')
    expect(body.type).toBe('TypeError')
    expect(body.message).toBe('boom at x')
    expect(body.level).toBe('error')
    expect(typeof body.stack).toBe('string')
  })

  test('report(error) captures an exception', async () => {
    const c = new BugHQClient(cfg)
    c.report(new TypeError('kaboom'))
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    const body = lastBody()
    expect(body.type).toBe('TypeError')
    expect(body.message).toBe('kaboom')
    expect(body.level).toBe('error')
  })

  test('report(string) captures an error-level message', async () => {
    const c = new BugHQClient(cfg)
    c.report('checkout failed', { orderId: 42 })
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    const body = lastBody()
    expect(body.type).toBe('Message')
    expect(body.message).toBe('checkout failed')
    expect(body.level).toBe('error')
    expect(body.extra.orderId).toBe(42)
  })

  test('dedupes the same error (same site) within the window', () => {
    const c = new BugHQClient({ ...cfg, dedupeMs: 10000 })
    const err = new Error('same') // one error → identical type|message|top-frame
    c.captureException(err)
    c.captureException(err)
    expect(calls).toHaveLength(1)
  })

  test('beforeSend can drop an event', () => {
    const c = new BugHQClient({ ...cfg, beforeSend: () => null })
    c.captureException(new Error('nope'))
    expect(calls).toHaveLength(0)
  })

  test('beforeSend can mutate an event', () => {
    const c = new BugHQClient({ ...cfg, beforeSend: (e) => ({ ...e, message: 'redacted' }) })
    c.captureException(new Error('secret'))
    expect(JSON.parse(calls[0].options.body).message).toBe('redacted')
  })

  test('missing project/key disables capture', () => {
    const c = new BugHQClient({ key: 'k' } as any)
    c.captureException(new Error('x'))
    expect(calls).toHaveLength(0)
  })

  test('sets framework/release/environment on the payload', () => {
    const c = new BugHQClient({ ...cfg, framework: 'vue', release: '1.2.3', environment: 'staging' })
    c.captureException(new Error('e'))
    const body = JSON.parse(calls[0].options.body)
    expect(body.framework).toBe('vue')
    expect(body.release).toBe('1.2.3')
    expect(body.environment).toBe('staging')
  })

  test('captureMessage sends a Message event with a level', () => {
    const c = new BugHQClient(cfg)
    c.captureMessage('hello', 'warning')
    const body = JSON.parse(calls[0].options.body)
    expect(body.type).toBe('Message')
    expect(body.message).toBe('hello')
    expect(body.level).toBe('warning')
  })

  test('init() returns a client and does not throw without a window', () => {
    expect(() => init(cfg)).not.toThrow()
  })
})

describe('enrichment', () => {
  test('rides along sdk metadata, a session, and runtime context', () => {
    const c = new BugHQClient(cfg)
    c.captureException(new Error('e'))
    const body = lastBody()
    expect(body.sdk.name).toBe(SDK_NAME)
    expect(typeof body.sdk.version).toBe('string')
    expect(typeof body.session.id).toBe('string')
    expect(body.contexts.runtime.sdk).toBe(SDK_NAME)
    expect(typeof body.timestamp).toBe('string')
  })

  test('framework plugins can override the sdk name', () => {
    const c = new BugHQClient({ ...cfg, sdkName: 'bughq.vue', framework: 'vue' })
    c.captureException(new Error('e'))
    const body = lastBody()
    expect(body.sdk.name).toBe('bughq.vue')
    expect(body.contexts.runtime.framework).toBe('vue')
  })

  test('attaches recorded breadcrumbs (oldest first)', () => {
    const c = new BugHQClient(cfg)
    c.addBreadcrumb({ category: 'test', message: 'step 1' })
    c.addBreadcrumb({ category: 'test', message: 'step 2' })
    c.captureException(new Error('e'))
    const body = lastBody()
    expect(Array.isArray(body.breadcrumbs)).toBe(true)
    expect(body.breadcrumbs.map((b: any) => b.message)).toEqual(['step 1', 'step 2'])
  })

  test('maxBreadcrumbs caps the ring buffer, evicting oldest', () => {
    const c = new BugHQClient({ ...cfg, maxBreadcrumbs: 2 })
    c.addBreadcrumb({ message: 'a' })
    c.addBreadcrumb({ message: 'b' })
    c.addBreadcrumb({ message: 'c' })
    c.captureException(new Error('e'))
    expect(lastBody().breadcrumbs.map((b: any) => b.message)).toEqual(['b', 'c'])
  })

  test('beforeBreadcrumb can drop breadcrumbs', () => {
    const c = new BugHQClient({ ...cfg, beforeBreadcrumb: b => (b.category === 'secret' ? null : b) })
    c.addBreadcrumb({ category: 'secret', message: 'x' })
    c.addBreadcrumb({ category: 'ok', message: 'y' })
    c.captureException(new Error('e'))
    const msgs = lastBody().breadcrumbs.map((b: any) => b.message)
    expect(msgs).toContain('y')
    expect(msgs).not.toContain('x')
  })

  test('tags, user, and named contexts ride along', () => {
    const c = new BugHQClient({ ...cfg, initialTags: { region: 'us' } })
    c.setTag('plan', 'pro')
    c.setUser({ id: 7, email: 'a@b.co' })
    c.setContext('order', { id: 'ord_1', total: 42 })
    c.captureException(new Error('e'))
    const body = lastBody()
    expect(body.tags.plan).toBe('pro')
    expect(body.tags.region).toBe('us')
    expect(body.user.id).toBe(7)
    expect(body.contexts.order.id).toBe('ord_1')
  })

  test('setLevel overrides the event level', () => {
    const c = new BugHQClient(cfg)
    c.setLevel('fatal')
    c.captureException(new Error('e'))
    expect(lastBody().level).toBe('fatal')
  })

  test('setFingerprint sends a grouping override', () => {
    const c = new BugHQClient(cfg)
    c.setFingerprint(['checkout', 'timeout'])
    c.captureException(new Error('e'))
    expect(lastBody().fingerprint).toEqual(['checkout', 'timeout'])
  })
})

describe('filtering', () => {
  test('ignoreErrors drops matching events (string + regexp)', () => {
    const c = new BugHQClient({ ...cfg, ignoreErrors: ['ResizeObserver', /chunk/i] })
    c.captureException(new Error('ResizeObserver loop limit exceeded'))
    c.captureException(new Error('Loading CHUNK 3 failed'))
    expect(calls).toHaveLength(0)
  })

  test('ignoreErrors lets through non-matching events', () => {
    const c = new BugHQClient({ ...cfg, ignoreErrors: ['ResizeObserver'] })
    c.captureException(new Error('real bug'))
    expect(calls).toHaveLength(1)
  })

  test('allowUrls restricts by locus (url + stack)', () => {
    const c = new BugHQClient({ ...cfg, allowUrls: ['this-will-not-match-anything-xyz'] })
    c.captureException(new Error('e'))
    expect(calls).toHaveLength(0)
  })

  test('denyUrls drops events whose stack matches', () => {
    const c = new BugHQClient({ ...cfg, denyUrls: [/sdk\.test/] })
    c.captureException(new Error('from the test file'))
    expect(calls).toHaveLength(0)
  })
})

describe('top-level report (default client)', () => {
  afterEach(() => close())

  test('routes through the initialized default client', async () => {
    init(cfg)
    report(new Error('top-level boom'))
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    expect(lastBody().message).toBe('top-level boom')
  })

  test('no-ops before init / after close', async () => {
    close()
    report(new Error('ignored'))
    captureException(new Error('also ignored'))
    await Promise.resolve()
    expect(calls).toHaveLength(0)
  })
})
