/**
 * @bughq/sdk — the core bughq error-tracking client.
 *
 * Framework-agnostic and SSR-safe. In the browser it captures uncaught errors +
 * unhandled rejections, records a breadcrumb trail (console, fetch/xhr, clicks,
 * navigation), enriches each event with device/page/runtime context, tags, and a
 * session, then POSTs it to the bughq ingest endpoint. In Node/Bun it works as a
 * manual client (auto-instrumentation is a no-op off the browser). The
 * `@bughq/vue`, `@bughq/nuxt`, and `@bughq/stx` packages build framework-aware
 * capture on top of this.
 *
 * Ingest contract: `POST {host}/errors`, with the ingest key in the JSON BODY
 * as `key` — not an `X-BugHQ-Key` header, which would force a CORS preflight
 * the ingest does not allow and which sendBeacon cannot set at all. See send().
 * JSON body `{ key, project, type, message, stack, level, url, browser, os,
 * framework, release, environment, timestamp, user, extra, tags, contexts,
 * breadcrumbs, sdk, session, fingerprint }`. The ingest key is public (it ships
 * in client code) — a revocable identifier, not a secret.
 */

export const SDK_NAME = 'bughq.javascript'
export const SDK_VERSION = '0.2.0'

export type Level = 'fatal' | 'error' | 'warning' | 'info' | 'debug'

export interface BugHQUser {
  id?: string | number
  email?: string
  username?: string
  ip_address?: string
  [key: string]: unknown
}

/** A single step in the trail leading up to an event. */
export interface Breadcrumb {
  /** ISO timestamp of when the crumb was recorded. */
  timestamp?: string
  /** Coarse kind: `navigation` | `http` | `ui` | `console` | `error` | `default`. */
  type?: string
  /** Fine-grained source, e.g. `console`, `fetch`, `xhr`, `ui.click`, `navigation`. */
  category?: string
  level?: Level
  message?: string
  data?: Record<string, unknown>
}

/** Identifies the SDK that produced an event. */
export interface SdkInfo {
  name: string
  version: string
}

/** The event payload POSTed to `/errors` (matches the ingest contract). */
export interface BugHQEvent {
  /** Optional: the ingest key alone identifies the project (globally unique). */
  project?: string
  type: string
  message: string
  stack?: string
  level: Level
  url?: string
  browser?: string
  os?: string
  framework?: string
  release?: string
  environment: string
  /** ISO time the event occurred (client clock). */
  timestamp?: string
  user?: BugHQUser | null
  /** Arbitrary structured data (merged scope extras + per-call extra). */
  extra?: Record<string, unknown> | null
  /** Indexable key/value labels. */
  tags?: Record<string, string>
  /** Named structured context blocks (device, page, runtime, custom). */
  contexts?: Record<string, Record<string, unknown>>
  /** The breadcrumb trail (oldest first). */
  breadcrumbs?: Breadcrumb[]
  sdk?: SdkInfo
  /** Per-tab session `{ id, startedAt }`. */
  session?: { id: string, startedAt: string }
  /** Optional grouping override; when set the server groups on these parts. */
  fingerprint?: string[]
}

/** Toggle set for the browser auto-instrumentation breadcrumbs. */
export interface AutoInstrumentOptions {
  console?: boolean
  fetch?: boolean
  xhr?: boolean
  dom?: boolean
  navigation?: boolean
}

export interface BugHQConfig {
  /** Project id (from your bughq dashboard). Or provide `dsn`. */
  project?: string
  /** Public ingest key. Or provide `dsn`. */
  key?: string
  /** Ingest host. Defaults to https://bughq.org; self-hosters override it. */
  host?: string
  /** A DSN encoding host+key+project: `https://<key>@<host>/<project>`. */
  dsn?: string
  /** Release/version tag attached to every event. */
  release?: string
  /** Environment name. Default `production`. */
  environment?: string
  /** Framework tag (set automatically by the framework plugins). */
  framework?: string
  /** SDK name reported in `event.sdk` (framework plugins override this). */
  sdkName?: string
  /** Set false to disable capture entirely (e.g. in dev). Default true. */
  enabled?: boolean
  /** Fraction of events to send, 0..1. Default 1. */
  sampleRate?: number
  /** Drop repeats of the same error within this window (ms). Default 5000. */
  dedupeMs?: number
  /** Max breadcrumbs retained per event. Default 30. */
  maxBreadcrumbs?: number
  /** Install `window.onerror` / `unhandledrejection` handlers. Default true. */
  captureUnhandled?: boolean
  /**
   * Promote `console.error` to an ISSUE, not just a breadcrumb. Default false.
   *
   * The case this exists for is a failure your code catches and logs: a Stripe
   * confirmCardPayment that RESOLVES with an error, an API call swallowed to
   * show a friendly message. Nothing throws, no promise rejects, so no other
   * capture path can see it.
   *
   * Separate from `autoInstrument.console`, deliberately. That flag answers
   * "what becomes a breadcrumb"; conflating them would mean anyone who already
   * set `autoInstrument: true` silently starts creating billable issues.
   *
   * Only `console.error`. warn/log/info are not reachable by widening this —
   * they are the bulk of console traffic and would bury the signal.
   */
  captureConsole?: boolean
  /**
   * Only capture when the first argument is a string. Default true.
   *
   * `console.error(err)` with no label is usually a rethrow of something the
   * SDK has already captured by other means, and it has no stable text to group
   * on. Requiring a developer-authored label is what keeps the fingerprint
   * vocabulary finite.
   */
  requireLabel?: boolean
  /**
   * Capture console errors originating in third-party scripts. Default false.
   *
   * Stripe.js, analytics and chat widgets log constantly and you can fix none
   * of it. Judged by whether the top non-SDK frame is same-origin.
   */
  vendors?: boolean

  /**
   * Send a once-a-day check-in so bughq can distinguish "this app is healthy"
   * from "the SDK never loaded". Default true. Carries no URL, user or session,
   * is never metered, and never creates an issue. Set false to disable, or
   * sample it yourself on very high-traffic sites — it is one unbilled request
   * per browser per day.
   */
  heartbeat?: boolean
  /**
   * Browser breadcrumb auto-instrumentation. **Default: all OFF.**
   *
   * Opt-in since d0865bb, because every channel patches a host global
   * (console, fetch, XMLHttpRequest, history, a document click listener).
   * Pass `true` for all of them, or an object to pick channels. Error capture
   * is independent and works with all of this off.
   */
  autoInstrument?: boolean | AutoInstrumentOptions
  /** Drop events whose type/message matches any of these. */
  ignoreErrors?: Array<string | RegExp>
  /** Drop events whose url/stack matches any of these. */
  denyUrls?: Array<string | RegExp>
  /** Only send events whose url/stack matches one of these (when set). */
  allowUrls?: Array<string | RegExp>
  /** Retry a failed/5xx send this many times (exponential backoff). Default 2. */
  maxRetries?: number
  /** Explicit User-Agent header (server-side clients; browsers set it). */
  userAgent?: string
  /** Send `contexts.device` / `contexts.page` automatically. Default true. */
  sendDefaultContext?: boolean
  /** Log SDK diagnostics to the console. */
  debug?: boolean
  /** Initial tags applied to every event. */
  initialTags?: Record<string, string>
  /** Inspect/mutate a breadcrumb before it's recorded; return null to drop it. */
  beforeBreadcrumb?: (crumb: Breadcrumb) => Breadcrumb | null | void
  /** Inspect/mutate an event before send; return null to drop it. */
  beforeSend?: (event: BugHQEvent) => BugHQEvent | null | void
}

// Fixed production ingest endpoint — errors POST to `${DEFAULT_HOST}/errors`.
// Self-hosters point elsewhere via `host` or a DSN; everyone else needs only a key.
const DEFAULT_HOST = 'https://bughq.org'

interface Resolved {
  project: string
  key: string
  host: string
  release?: string
  environment: string
  framework?: string
  sdkName: string
  enabled: boolean
  sampleRate: number
  dedupeMs: number
  maxBreadcrumbs: number
  captureUnhandled: boolean
  captureConsole: boolean
  requireLabel: boolean
  vendors: boolean
  heartbeat: boolean
  autoInstrument: Required<AutoInstrumentOptions>
  ignoreErrors: Array<string | RegExp>
  denyUrls: Array<string | RegExp>
  allowUrls: Array<string | RegExp>
  maxRetries: number
  userAgent?: string
  sendDefaultContext: boolean
  debug: boolean
  beforeBreadcrumb?: (crumb: Breadcrumb) => Breadcrumb | null | void
  beforeSend?: (event: BugHQEvent) => BugHQEvent | null | void
}

/** Parse a DSN of the form `https://<key>@<host>/<project>`. */
export function parseDsn(dsn: string): { host: string, key: string, project: string } | null {
  try {
    const u = new URL(dsn)
    const key = u.username || u.password || ''
    const project = u.pathname.replace(/^\/+/, '').split('/')[0] || ''
    if (!project)
      return null
    return { host: `${u.protocol}//${u.host}`, key, project }
  }
  catch {
    return null
  }
}

function resolveAutoInstrument(value: boolean | AutoInstrumentOptions | undefined): Required<AutoInstrumentOptions> {
  // Auto-instrumentation monkey-patches HOST globals — window.fetch,
  // XMLHttpRequest, console.*, history, and a document click listener — to
  // record breadcrumbs. That's invasive (it can reroute/duplicate the app's own
  // fetch and console), so it's strictly OPT-IN: `undefined` or `false` patches
  // NOTHING. Error capture (window error/unhandledrejection + framework hooks
  // like vue:error) is independent of this and still works with it all off.
  // Pass `true` for everything, or an object to enable specific channels.
  if (value === true)
    return { console: true, fetch: true, xhr: true, dom: true, navigation: true }
  if (value && typeof value === 'object') {
    return {
      console: value.console === true,
      fetch: value.fetch === true,
      xhr: value.xhr === true,
      dom: value.dom === true,
      navigation: value.navigation === true,
    }
  }
  // undefined or false → touch no host globals.
  return { console: false, fetch: false, xhr: false, dom: false, navigation: false }
}

function resolveConfig(config: BugHQConfig): Resolved {
  let project = config.project
  let key = config.key
  let host = config.host
  if (config.dsn) {
    const d = parseDsn(config.dsn)
    if (d) {
      host = host ?? d.host
      key = key ?? d.key
      project = project ?? d.project
    }
  }
  return {
    project: project ?? '',
    key: key ?? '',
    host: (host ?? DEFAULT_HOST).replace(/\/+$/, ''),
    release: config.release,
    environment: config.environment ?? 'production',
    framework: config.framework,
    sdkName: config.sdkName ?? SDK_NAME,
    enabled: config.enabled !== false,
    sampleRate: config.sampleRate ?? 1,
    dedupeMs: config.dedupeMs ?? 5000,
    maxBreadcrumbs: config.maxBreadcrumbs ?? 30,
    captureUnhandled: config.captureUnhandled !== false,
    // Opt-IN: this is the only flag here that can create billable issues.
    captureConsole: config.captureConsole === true,
    requireLabel: config.requireLabel !== false,
    vendors: config.vendors === true,
    heartbeat: config.heartbeat !== false,
    autoInstrument: resolveAutoInstrument(config.autoInstrument),
    ignoreErrors: config.ignoreErrors ?? [],
    denyUrls: config.denyUrls ?? [],
    allowUrls: config.allowUrls ?? [],
    maxRetries: config.maxRetries ?? 2,
    userAgent: config.userAgent,
    sendDefaultContext: config.sendDefaultContext !== false,
    debug: !!config.debug,
    beforeBreadcrumb: config.beforeBreadcrumb,
    beforeSend: config.beforeSend,
  }
}

/** Best-effort browser + OS from a UA string (bughq groups on type/message). */
export function parseUserAgent(ua: string): { browser?: string, os?: string } {
  if (!ua)
    return {}
  let browser: string | undefined
  const browsers: Array<[RegExp, string]> = [
    [/Edg\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+)[^S]{0,32}Safari/, 'Safari'],
  ]
  for (const [re, name] of browsers) {
    const m = ua.match(re)
    if (m) {
      browser = `${name} ${m[1]}`
      break
    }
  }
  let os: string | undefined
  if (/Windows NT 10/.test(ua))
    os = 'Windows 10'
  else if (/Windows/.test(ua))
    os = 'Windows'
  else if (/Mac OS X/.test(ua))
    os = 'macOS'
  else if (/Android/.test(ua))
    os = 'Android'
  else if (/iPhone|iPad|iPod|iOS/.test(ua))
    os = 'iOS'
  else if (/Linux/.test(ua))
    os = 'Linux'
  return { browser, os }
}

function errorType(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown, constructor?: { name?: unknown } }
    if (e.name)
      return String(e.name)
    if (e.constructor && e.constructor.name)
      return String(e.constructor.name)
  }
  return 'Error'
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err)
    return String((err as { message: unknown }).message)
  return String(err)
}

function errorStack(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'stack' in err && (err as { stack?: unknown }).stack)
    return String((err as { stack: unknown }).stack)
  return undefined
}

function matchesAny(value: string, patterns: Array<string | RegExp>): boolean {
  for (const p of patterns) {
    if (typeof p === 'string') {
      if (value.includes(p))
        return true
    }
    else if (p.test(value)) {
      return true
    }
  }
  return false
}

// --- SSR-safe global accessors (never throw when window/navigator absent) ---
function root(): any {
  return typeof globalThis !== 'undefined' ? (globalThis as any) : {}
}
function safeWindow(): any {
  const g = root()
  return g.window && typeof g.window.addEventListener === 'function' ? g.window : null
}
function safeDocument(): any {
  const g = root()
  return g.document && typeof g.document.addEventListener === 'function' ? g.document : null
}
function safeUA(): string {
  const g = root()
  return g.navigator && g.navigator.userAgent ? String(g.navigator.userAgent) : ''
}
function safeUrl(): string | undefined {
  const g = root()
  return g.location && g.location.href ? String(g.location.href) : undefined
}
function safeFetch(): typeof fetch | null {
  const g = root()
  return typeof g.fetch === 'function' ? g.fetch.bind(g) : null
}
function nowIso(): string {
  try {
    return new Date().toISOString()
  }
  catch {
    return ''
  }
}
function uuid(): string {
  const g = root()
  try {
    if (g.crypto && typeof g.crypto.randomUUID === 'function')
      return g.crypto.randomUUID()
  }
  catch {
    // fall through to manual generation
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** A concise CSS-ish selector for a clicked element (for ui.click breadcrumbs). */
function describeElement(el: any): string {
  if (!el || !el.tagName)
    return ''
  let out = String(el.tagName).toLowerCase()
  if (el.id)
    out += `#${el.id}`
  const cls = typeof el.className === 'string' ? el.className.trim() : ''
  if (cls)
    out += `.${cls.split(/\s+/).slice(0, 3).join('.')}`
  return out
}

/** Last heartbeat per key, for runtimes with no localStorage (server SDKs). */
const heartbeatSent = new Map<string, number>()

export class BugHQClient {
  readonly config: Resolved
  readonly session: { id: string, startedAt: string }
  private user: BugHQUser | null = null
  private tags: Record<string, string> = {}
  private extras: Record<string, unknown> = {}
  private contexts: Record<string, Record<string, unknown>> = {}
  private level: Level | null = null
  private fingerprint: string[] | null = null
  private breadcrumbs: Breadcrumb[] = []
  private lastSeen = new Map<string, number>()
  private detach: Array<() => void> = []
  /** Guards against the breadcrumb path re-entering patched console methods. */
  private inConsole = false
  /** Per-fingerprint backoff state for console capture. */
  private readonly groups = new Map<string, { last: number, n: number, suppressed: number }>()
  /** In-flight sends, so flush() can mean something. */
  private readonly inFlight = new Set<Promise<unknown>>()
  /** Unpatched console methods, kept before patching, for the SDK's own logging. */
  private rawConsole: { warn?: (...a: unknown[]) => void, info?: (...a: unknown[]) => void, error?: (...a: unknown[]) => void } = {}
  // Snapshot of `fetch` taken before we instrument it, so the SDK's own sends
  // never re-enter our fetch breadcrumb wrapper (and never recurse).
  private nativeFetch: typeof fetch | null

  constructor(config: BugHQConfig) {
    this.config = resolveConfig(config)
    this.session = { id: uuid(), startedAt: nowIso() }
    this.nativeFetch = safeFetch()
    if (config.initialTags)
      this.tags = { ...config.initialTags }

    // The key is all that's required: it's globally unique, so the ingest
    // resolves the project from it alone (Flare-style). `project` is optional.
    if (!this.config.key) {
      if (this.config.debug)
        console.warn('[bughq] missing key — capture disabled')
      this.config.enabled = false
    }
    if (this.config.enabled) {
      if (this.config.captureUnhandled)
        this.installGlobalHandlers()
      this.installAutoInstrumentation()
      this.sendHeartbeat()
    }
  }

  /**
   * Tell bughq a client loaded, at most once per browser per day.
   *
   * Without this, an empty dashboard is unfalsifiable: a project with no issues
   * looks exactly the same whether the app is healthy or the SDK never ran —
   * wrong key, blocked by CORS, a build shipped without the env var. All of
   * those read as "nothing is broken", which is the most expensive thing an
   * error tracker can get wrong, because the whole product is the claim that
   * silence is meaningful.
   *
   * Deliberately minimal: no URL, no user, no session, no breadcrumbs. Which
   * SDK, which version, which environment, which release. The server does not
   * meter it against the plan's event allowance and answers 204 whatever
   * happens, so this can never create an issue or confirm whether a key is
   * valid.
   *
   * Every failure path is silent. A heartbeat that broke an app's boot, or
   * logged noise into a customer's console, would be worse than no heartbeat.
   */
  private sendHeartbeat(): void {
    if (this.config.heartbeat === false)
      return
    const g = root()
    if (!g?.fetch)
      return
    try {
      // One per browser per day. localStorage rather than a cookie: this is not
      // sent anywhere, it only suppresses a repeat, and a cookie would ride on
      // every request to the customer's own origin for no reason.
      const stamp = `bughq.hb.${this.config.key}`
      // localStorage where it exists, an in-process map where it does not. A
      // server SDK has no localStorage, and without the fallback the throttle
      // silently never applied — every init() would have sent one.
      const stored = Number(g.localStorage?.getItem?.(stamp) ?? 0)
      const last = stored || heartbeatSent.get(stamp) || 0
      if (last && Date.now() - last < 86_400_000)
        return
      heartbeatSent.set(stamp, Date.now())
      try {
        g.localStorage?.setItem?.(stamp, String(Date.now()))
      }
      catch { /* storage disabled or full; the in-process map still throttles */ }

      g.fetch(`${this.config.host}/sdk/hello`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: this.config.key,
          sdk: { name: this.config.sdkName, version: SDK_VERSION },
          environment: this.config.environment,
          release: this.config.release,
        }),
        keepalive: true,
      }).catch(() => {})
    }
    catch {
      // localStorage can throw outright in private mode or with storage
      // disabled. Losing a heartbeat is not worth a single broken page.
    }
  }

  // --- Scope --------------------------------------------------------------

  setUser(user: BugHQUser | null): void {
    this.user = user
  }

  setTag(key: string, value: string): void {
    this.tags[key] = String(value)
  }

  setTags(tags: Record<string, string>): void {
    for (const [k, v] of Object.entries(tags))
      this.tags[k] = String(v)
  }

  /** Set (or clear, with `null`) a named context block, e.g. `setContext('order', {...})`. */
  setContext(name: string, context: Record<string, unknown> | null): void {
    if (context === null)
      delete this.contexts[name]
    else
      this.contexts[name] = context
  }

  setExtra(key: string, value: unknown): void {
    this.extras[key] = value
  }

  setExtras(extras: Record<string, unknown>): void {
    this.extras = { ...this.extras, ...extras }
  }

  setLevel(level: Level | null): void {
    this.level = level
  }

  /**
   * Report a failure your code handled, grouped by OPERATION rather than by
   * message text.
   *
   * For the failures that log nothing at all, or that log something too varied
   * to group on. `op` is a name you choose and keep stable — 'checkout.confirm',
   * 'cart.load' — so the issue stays one issue however the message changes.
   */
  reportFailure(op: string, error?: unknown, context?: Record<string, unknown>): void {
    const slug = String(op).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 64) || 'unknown'
    const err = error instanceof Error ? error : undefined
    const outcome = this.outcomeOf(error)
    const detail = err ? `${err.name}: ${scrubValue(String(err.message)).slice(0, 200)}` : scrubValue(String(error ?? '')).slice(0, 200)
    this.dispatch(
      { type: 'OperationFailed', message: `${slug} failed (${outcome})${detail ? `: ${detail}` : ''}`, stack: err?.stack, level: 'error' },
      context ? { context } : undefined,
      ['bughq.op', slug, outcome],
    )
  }

  /** Classify a failure into a small, finite vocabulary for the fingerprint. */
  private outcomeOf(error: unknown): string {
    const any = error as any
    const status = Number(any?.status ?? any?.statusCode ?? any?.response?.status ?? 0)
    if (status >= 500)
      return 'server'
    if (status === 401 || status === 403)
      return 'auth'
    if (status === 422 || status === 400)
      return 'validation'
    if (status === 429)
      return 'throttle'
    if (status >= 400)
      return 'client'
    const msg = String(any?.message ?? '').toLowerCase()
    if (msg.includes('timeout') || msg.includes('timed out'))
      return 'timeout'
    if (msg.includes('network') || msg.includes('failed to fetch'))
      return 'network'
    return 'exception'
  }

  setFingerprint(fingerprint: string[] | null): void {
    this.fingerprint = fingerprint
  }

  setRelease(release: string): void {
    this.config.release = release
  }

  setEnvironment(environment: string): void {
    this.config.environment = environment
  }

  // --- Breadcrumbs --------------------------------------------------------

  addBreadcrumb(crumb: Breadcrumb): void {
    let c: Breadcrumb = { timestamp: nowIso(), type: 'default', ...crumb }
    if (this.config.beforeBreadcrumb) {
      const r = this.config.beforeBreadcrumb(c)
      if (r === null)
        return
      if (r)
        c = r
    }
    this.breadcrumbs.push(c)
    const overflow = this.breadcrumbs.length - this.config.maxBreadcrumbs
    if (overflow > 0)
      this.breadcrumbs.splice(0, overflow)
  }

  clearBreadcrumbs(): void {
    this.breadcrumbs = []
  }

  // --- Capture ------------------------------------------------------------

  captureMessage(message: string, level: Level = 'info', extra?: Record<string, unknown>): void {
    this.dispatch({ type: 'Message', message, level }, extra)
  }

  captureException(err: unknown, extra?: Record<string, unknown>): void {
    this.dispatch({ type: errorType(err), message: errorMessage(err), stack: errorStack(err), level: 'error' }, extra)
  }

  /**
   * Ergonomic one-call reporting. Pass an Error (or anything thrown) to capture
   * an exception, or a string to capture an error-level message.
   */
  report(error: unknown, extra?: Record<string, unknown>): void {
    if (typeof error === 'string')
      this.captureMessage(error, 'error', extra)
    else
      this.captureException(error, extra)
  }

  /**
   * `fingerprint` is a per-call override. The SDK only had `setFingerprint`,
   * which is sticky client scope — it would have pinned EVERY subsequent event
   * to one console error's group.
   */
  private dispatch(base: { type: string, message: string, stack?: string, level: Level }, extra?: Record<string, unknown>, fingerprint?: string[]): void {
    if (!this.config.enabled)
      return
    if (this.config.sampleRate < 1 && Math.random() > this.config.sampleRate)
      return

    // Filtering: ignoreErrors (type/message), deny/allow urls (url + stack).
    const signature = `${base.type}: ${base.message}`
    if (this.config.ignoreErrors.length && (matchesAny(signature, this.config.ignoreErrors) || matchesAny(base.message, this.config.ignoreErrors)))
      return
    const url = safeUrl()
    const locus = `${url || ''}\n${base.stack || ''}`
    if (this.config.denyUrls.length && matchesAny(locus, this.config.denyUrls))
      return
    if (this.config.allowUrls.length && !matchesAny(locus, this.config.allowUrls))
      return

    const dedupeKey = `${base.type}|${base.message}|${(base.stack || '').split('\n')[1] || ''}`
    const now = Date.now()
    const seen = this.lastSeen.get(dedupeKey)
    if (seen && now - seen < this.config.dedupeMs)
      return
    this.lastSeen.set(dedupeKey, now)

    const { browser, os } = parseUserAgent(safeUA())
    const mergedExtra = { ...this.extras, ...(extra || {}) }
    const contexts = this.buildContexts()

    let event: BugHQEvent = {
      // Omitted when empty — the key resolves the project server-side.
      project: this.config.project || undefined,
      type: base.type,
      message: base.message,
      stack: base.stack,
      level: this.level ?? base.level,
      url,
      browser,
      os,
      framework: this.config.framework,
      release: this.config.release,
      environment: this.config.environment,
      timestamp: nowIso(),
      user: this.user,
      extra: Object.keys(mergedExtra).length ? mergedExtra : null,
      tags: Object.keys(this.tags).length ? { ...this.tags } : undefined,
      contexts: Object.keys(contexts).length ? contexts : undefined,
      breadcrumbs: this.breadcrumbs.length ? this.breadcrumbs.slice() : undefined,
      sdk: { name: this.config.sdkName, version: SDK_VERSION },
      session: this.session,
      fingerprint: fingerprint ?? this.fingerprint ?? undefined,
    }

    if (this.config.beforeSend) {
      const result = this.config.beforeSend(event)
      if (result === null)
        return
      if (result)
        event = result
    }

    // Record this error as a breadcrumb so a subsequent event shows the chain.
    this.addBreadcrumb({ type: 'error', category: 'exception', level: event.level, message: `${base.type}: ${base.message}` })

    this.send(event)
  }

  /** Auto contexts (device/page/runtime) merged under any user-set contexts. */
  private buildContexts(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {}
    if (this.config.sendDefaultContext) {
      const device = this.deviceContext()
      if (Object.keys(device).length)
        out.device = device
      const page = this.pageContext()
      if (Object.keys(page).length)
        out.page = page
    }
    out.runtime = this.runtimeContext()
    for (const [name, ctx] of Object.entries(this.contexts))
      out[name] = ctx
    return out
  }

  private deviceContext(): Record<string, unknown> {
    const g = root()
    const ctx: Record<string, unknown> = {}
    const nav = g.navigator
    if (nav) {
      if (nav.language)
        ctx.language = nav.language
      if (typeof nav.onLine === 'boolean')
        ctx.online = nav.onLine
      if (nav.hardwareConcurrency)
        ctx.cpuCores = nav.hardwareConcurrency
      if ((nav as any).deviceMemory)
        ctx.memoryGb = (nav as any).deviceMemory
    }
    const scr = g.screen
    if (scr && scr.width)
      ctx.screen = `${scr.width}x${scr.height}`
    if (g.devicePixelRatio)
      ctx.pixelRatio = g.devicePixelRatio
    if (g.innerWidth)
      ctx.viewport = `${g.innerWidth}x${g.innerHeight}`
    try {
      ctx.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    }
    catch {
      // Intl unavailable — skip
    }
    return ctx
  }

  private pageContext(): Record<string, unknown> {
    const g = root()
    const ctx: Record<string, unknown> = {}
    if (g.location && g.location.href) {
      ctx.url = g.location.href
      if (g.location.pathname)
        ctx.route = g.location.pathname
    }
    const doc = g.document
    if (doc) {
      if (doc.title)
        ctx.title = doc.title
      if (doc.referrer)
        ctx.referrer = doc.referrer
    }
    return ctx
  }

  private runtimeContext(): Record<string, unknown> {
    const ctx: Record<string, unknown> = { sdk: this.config.sdkName, sdkVersion: SDK_VERSION }
    if (this.config.framework)
      ctx.framework = this.config.framework
    ctx.name = safeWindow() ? 'browser' : 'node'
    return ctx
  }

  // --- Transport ----------------------------------------------------------

  private send(event: BugHQEvent): void {
    // The ingest key travels in the BODY (`key`), not an `X-BugHQ-Key` header.
    // A custom header forces a CORS preflight, and the ingest's allowed headers
    // (framework-fixed to Content-Type/Authorization) don't include it, so a
    // browser cross-origin send would be blocked. sendBeacon can't set headers
    // either. The server accepts `body.key` (X-BugHQ-Key ?? body.key), so this
    // works for browser, beacon, and server transports alike.
    const payload = { ...event, key: this.config.key }
    let body: string
    try {
      body = JSON.stringify(payload)
    }
    catch {
      // Circular or unserializable payload — drop the rich fields and retry once.
      body = JSON.stringify({ ...payload, extra: null, contexts: undefined, breadcrumbs: undefined })
    }
    this.transport(body, 0, event.type)
  }

  private transport(body: string, attempt: number, label: string): void {
    const url = `${this.config.host}/errors`
    // Key is in the body (see send()) — no custom header means the only preflight
    // header is Content-Type, which the ingest's CORS allows.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    // Browsers forbid setting User-Agent (silently dropped); Node/Bun honor it,
    // and the server reads UA from this header for server-side clients.
    if (this.config.userAgent)
      headers['User-Agent'] = this.config.userAgent

    const doFetch = this.nativeFetch || safeFetch()
    if (!doFetch) {
      // No fetch (very old/SSR): last-ditch sendBeacon in the browser.
      const w = safeWindow()
      if (w && w.navigator && typeof w.navigator.sendBeacon === 'function') {
        try {
          w.navigator.sendBeacon(url, body)
        }
        catch {
          // give up silently
        }
      }
      else if (this.config.debug) {
        (this.rawConsole.warn ?? console.warn)('[bughq] no transport available — event dropped')
      }
      return
    }

    try {
      // Tracked so flush() can wait for it. Removed in both branches, or a
      // long-lived page would accumulate one settled promise per event.
      const pending = doFetch(url, { method: 'POST', keepalive: true, headers, body }).then(
        (r: any) => {
          if (r && typeof r.status === 'number' && r.status >= 500)
            this.retry(body, attempt, label)
          else if (this.config.debug)
            (this.rawConsole.info ?? console.info)('[bughq] sent', label, r && r.status)
        },
        () => this.retry(body, attempt, label),
      )
      this.inFlight.add(pending)
      pending.finally(() => this.inFlight.delete(pending))
    }
    catch {
      this.retry(body, attempt, label)
    }
  }

  private retry(body: string, attempt: number, label: string): void {
    if (attempt >= this.config.maxRetries)
      return
    const g = root()
    if (typeof g.setTimeout !== 'function') {
      this.transport(body, attempt + 1, label)
      return
    }
    const delay = 500 * 2 ** attempt
    g.setTimeout(() => this.transport(body, attempt + 1, label), delay)
  }

  /** Resolves when in-flight sends settle. Sends are fire-and-forget, so this is a courtesy no-op. */
  /**
   * Resolve once every in-flight send has settled.
   *
   * This returned `Promise.resolve(true)` immediately while being exported as
   * public API, so anything that awaited it — a route guard, a pagehide handler,
   * a test — was told the queue was empty when it was not. It now tracks real
   * requests. `true` means everything settled; `false` means the timeout won,
   * so a caller can decide whether to block a navigation.
   */
  async flush(timeoutMs = 2000): Promise<boolean> {
    if (this.inFlight.size === 0)
      return true
    const settled = Promise.allSettled([...this.inFlight]).then(() => true)
    const timedOut = new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeoutMs))
    return Promise.race([settled, timedOut])
  }

  // --- Instrumentation ----------------------------------------------------

  private installGlobalHandlers(): void {
    const w = safeWindow()
    if (!w)
      return
    const onError = (ev: any) => this.captureException(ev && ev.error ? ev.error : (ev && ev.message ? ev : ev))
    const onRejection = (ev: any) => this.captureException(ev && 'reason' in ev ? ev.reason : ev)
    w.addEventListener('error', onError)
    w.addEventListener('unhandledrejection', onRejection)
    this.detach.push(() => {
      w.removeEventListener('error', onError)
      w.removeEventListener('unhandledrejection', onRejection)
    })
  }

  private installAutoInstrumentation(): void {
    const opt = this.config.autoInstrument
    // Console first, and OUTSIDE the window guard. It is the one channel that
    // exists in every runtime — Node, Bun, a worker, a test — while fetch, XHR,
    // history and document clicks genuinely need a browser. Gating console on
    // `window` meant a server SDK could ask for console capture and silently
    // get none, which is also why this was invisible under test.
    if (opt.console)
      this.instrumentConsole()

    const w = safeWindow()
    if (!w)
      return
    if (opt.fetch)
      this.instrumentFetch(w)
    if (opt.xhr)
      this.instrumentXhr()
    if (opt.dom)
      this.instrumentDomClicks()
    if (opt.navigation)
      this.instrumentNavigation(w)
  }

  private instrumentConsole(): void {
    const g = root()
    const c = g.console
    if (!c)
      return
    // Keep unpatched references before patching, and use them for the SDK's own
    // logging. Otherwise `debug: true` makes the SDK feed itself: console.info
    // on every successful send becomes a breadcrumb, so a quiet app accumulates
    // one crumb per event and evicts the ones that mattered. The re-entrancy
    // guard below closes the same loop for anything the breadcrumb path itself
    // logs.
    this.rawConsole = { warn: c.warn?.bind(c), info: c.info?.bind(c), error: c.error?.bind(c) }
    const levels: Array<[string, Level]> = [['log', 'info'], ['info', 'info'], ['warn', 'warning'], ['error', 'error']]
    for (const [method, level] of levels) {
      const original = c[method]
      if (typeof original !== 'function')
        continue
      c[method] = (...args: unknown[]) => {
        // Anything the breadcrumb path logs would otherwise re-enter here.
        if (this.inConsole)
          return original.apply(c, args)
        this.inConsole = true
        try {
          // One scrub pass feeds both channels, so a secret cannot be masked in
          // the issue and left intact in the breadcrumb beside it.
          const text = consoleArgs(args)
          this.addBreadcrumb({ type: 'console', category: `console.${method}`, level, message: text })
          if (method === 'error' && this.config.captureConsole)
            this.captureConsoleError(args, text)
        }
        catch {
          // never let a breadcrumb break console
        }
        finally {
          // Released in `finally`, not after the try: an early return or a
          // throw would otherwise leave it set and silently disable console
          // capture for the rest of the session.
          this.inConsole = false
        }
        return original.apply(c, args)
      }
      this.detach.push(() => { c[method] = original })
    }
  }

  /**
   * Turn one console.error into an issue, if it passes every gate.
   *
   * The gates exist because the failure mode here is not "we miss one" but "we
   * mint ten thousand". Each is cheap and each removes a whole class:
   *
   *   requireLabel  — a bare console.error(err) has no stable text to group on
   *                   and is usually a rethrow of something already captured.
   *   vendors       — Stripe.js and analytics log constantly and you cannot fix
   *                   any of it. Judged by the top non-SDK frame's origin.
   *   backoff       — the same call site firing in a render loop is one issue,
   *                   not one event per frame.
   */
  private captureConsoleError(args: unknown[], text: string): void {
    const label = args[0]
    if (this.config.requireLabel && typeof label !== 'string')
      return
    const stack = new Error('bughq.console').stack ?? ''
    if (!this.config.vendors && !this.isSameOriginStack(stack))
      return

    // The fingerprint is the SHAPE of the call, never its text. Fixed arity
    // with '-' for absent slots: the server drops empty parts, so ''
    // would shift every later part left and collide across shapes.
    const err = args.find(a => a instanceof Error) as Error | undefined
    const skeleton = skeletonize(typeof label === 'string' ? scrubValue(label) : 'console.error')
    const parts = [
      'bughq.console',
      'error',
      skeleton || '-',
      err?.name || '-',
      this.routeOf(err) || '-',
      this.statusOf(err) || '-',
    ]
    const key = parts.join('|')
    const suppressed = this.backoff(key)
    if (suppressed < 0)
      return

    this.dispatch(
      { type: 'ConsoleError', message: text, stack, level: 'error' },
      suppressed > 0 ? { console: { suppressed } } : undefined,
      parts,
    )
  }

  /** True when the first frame outside the SDK belongs to this origin. */
  private isSameOriginStack(stack: string): boolean {
    const origin = root()?.location?.origin
    if (!origin)
      return true
    for (const line of stack.split('\n').slice(1)) {
      const m = line.match(/https?:\/\/[^\s):]+/)
      if (!m)
        continue
      if (m[0].includes('/bughq') || m[0].includes('@bughq'))
        continue
      return m[0].startsWith(origin)
    }
    // No frame carried a URL — same-origin inline code, or a stack the engine
    // did not populate. Capturing is the safer default: missing a real error
    // costs more than one vendor row.
    return true
  }

  private routeOf(err: unknown): string {
    const any = err as any
    const raw = any?.request ?? any?.url ?? any?.config?.url
      ?? String(any?.message ?? '').match(/https?:\/\/[^\s'"`]+/)?.[0]
    if (!raw)
      return ''
    const method = String(any?.method ?? any?.config?.method ?? '').toUpperCase()
    return `${method ? `${method} ` : ''}${maskUrl(String(raw))}`
  }

  private statusOf(err: unknown): string {
    const any = err as any
    const n = any?.status ?? any?.statusCode ?? any?.response?.status
      ?? String(any?.message ?? '').match(/\b([1-5]\d{2})\b/)?.[1]
    return n ? String(n) : ''
  }

  /**
   * Per-group exponential backoff. Returns how many were suppressed since the
   * last emission, or -1 to drop this one.
   *
   * A flat rate limit is the wrong shape: a broken component logs on every
   * render, so what matters is that the same GROUP goes quiet quickly while a
   * new group is still immediate. This allows roughly nine emissions in the
   * first hour, then two an hour forever.
   */
  private backoff(key: string): number {
    const now = Date.now()
    const st = this.groups.get(key)
    if (!st) {
      this.groups.set(key, { last: now, n: 1, suppressed: 0 })
      return 0
    }
    const wait = Math.min(10_000 * 2 ** (st.n - 1), 1_800_000)
    if (now - st.last < wait) {
      st.suppressed++
      return -1
    }
    const carried = st.suppressed
    st.last = now
    st.n++
    st.suppressed = 0
    return carried
  }

  private instrumentFetch(w: any): void {
    const original = w.fetch
    if (typeof original !== 'function')
      return
    const host = this.config.host
    const self = this
    w.fetch = function (this: any, ...args: any[]) {
      const input = args[0]
      const method = (args[1] && args[1].method) || (input && input.method) || 'GET'
      const reqUrl = typeof input === 'string' ? input : (input && input.url) || String(input)
      const started = Date.now()
      const p = original.apply(this, args)
      // Skip breadcrumbs for our own ingest traffic.
      if (typeof reqUrl === 'string' && reqUrl.indexOf(host) === 0)
        return p
      if (p && typeof p.then === 'function') {
        p.then(
          (res: any) => self.addBreadcrumb({ type: 'http', category: 'fetch', level: res && res.status >= 400 ? 'warning' : 'info', data: { method: String(method).toUpperCase(), url: maskUrl(reqUrl), status: res && res.status, durationMs: Date.now() - started } }),
          () => self.addBreadcrumb({ type: 'http', category: 'fetch', level: 'error', data: { method: String(method).toUpperCase(), url: maskUrl(reqUrl), error: true, durationMs: Date.now() - started } }),
        )
      }
      return p
    }
    this.detach.push(() => { w.fetch = original })
  }

  private instrumentXhr(): void {
    const g = root()
    const XHR = g.XMLHttpRequest
    if (typeof XHR !== 'function' || !XHR.prototype)
      return
    const proto = XHR.prototype
    const origOpen = proto.open
    const origSend = proto.send
    const self = this
    const host = this.config.host
    proto.open = function (this: any, method: string, url: string) {
      this.__bughq = { method, url, started: 0 }
      return origOpen.apply(this, arguments as any)
    }
    proto.send = function (this: any) {
      const meta = this.__bughq
      if (meta) {
        meta.started = Date.now()
        this.addEventListener('loadend', () => {
          try {
            if (typeof meta.url === 'string' && meta.url.indexOf(host) === 0)
              return
            self.addBreadcrumb({ type: 'http', category: 'xhr', level: this.status >= 400 ? 'warning' : 'info', data: { method: String(meta.method).toUpperCase(), url: maskUrl(meta.url), status: this.status, durationMs: Date.now() - meta.started } })
          }
          catch {
            // ignore
          }
        })
      }
      return origSend.apply(this, arguments as any)
    }
    this.detach.push(() => {
      proto.open = origOpen
      proto.send = origSend
    })
  }

  private instrumentDomClicks(): void {
    const doc = safeDocument()
    if (!doc)
      return
    const handler = (ev: any) => {
      try {
        const target = ev && ev.target
        const selector = describeElement(target)
        if (!selector)
          return
        const text = target && typeof target.textContent === 'string' ? target.textContent.trim().slice(0, 60) : ''
        this.addBreadcrumb({ type: 'ui', category: 'ui.click', message: selector, data: text ? { text } : undefined })
      }
      catch {
        // ignore
      }
    }
    doc.addEventListener('click', handler, true)
    this.detach.push(() => doc.removeEventListener('click', handler, true))
  }

  private instrumentNavigation(w: any): void {
    const g = root()
    const history = g.history
    const record = (to: string | undefined, kind: string) => this.addBreadcrumb({ type: 'navigation', category: 'navigation', message: kind, data: { to: to || safeUrl() } })
    let restoreHistory = () => {}
    if (history && typeof history.pushState === 'function') {
      const origPush = history.pushState
      const origReplace = history.replaceState
      history.pushState = function (this: any, _state: any, _title: any, url?: any) {
        record(url != null ? String(url) : undefined, 'pushState')
        return origPush.apply(this, arguments as any)
      }
      history.replaceState = function (this: any, _state: any, _title: any, url?: any) {
        record(url != null ? String(url) : undefined, 'replaceState')
        return origReplace.apply(this, arguments as any)
      }
      restoreHistory = () => {
        history.pushState = origPush
        history.replaceState = origReplace
      }
    }
    const onPop = () => record(safeUrl(), 'popstate')
    const onHash = () => record(safeUrl(), 'hashchange')
    w.addEventListener('popstate', onPop)
    w.addEventListener('hashchange', onHash)
    this.detach.push(() => {
      restoreHistory()
      w.removeEventListener('popstate', onPop)
      w.removeEventListener('hashchange', onHash)
    })
  }

  /** Remove installed handlers and restore patched globals. */
  close(): void {
    this.detach.forEach((fn) => {
      try {
        fn()
      }
      catch {
        // ignore teardown errors
      }
    })
    this.detach = []
  }
}

/** JSON.stringify that never throws (used for console breadcrumbs). */
/**
 * A URL reduced to what is diagnostic, with what is sensitive removed.
 *
 * Breadcrumbs recorded the raw request URL, so a query string went to bughq
 * verbatim — and query strings in a real app carry tokens, emails, order
 * contents and session ids. The path is what tells you which call failed; the
 * query almost never is.
 *
 * Also templates numeric and id-shaped path segments, so /api/orders/8823 and
 * /api/orders/9110 read as one route rather than two unrelated breadcrumbs.
 */
export function maskUrl(raw: string): string {
  try {
    const u = new URL(raw, typeof root()?.location?.href === 'string' ? root().location.href : 'http://x')
    const path = u.pathname
      .split('/')
      .map((seg) => {
        if (!seg)
          return seg
        if (/^\d+$/.test(seg))
          return '{n}'
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg))
          return '{uuid}'
        // Mixed letters-and-digits of any length is an id in practice
        // (ord_a8f3kd, pi_3Nx…, SKU-AB12) and never a route name.
        if (seg.length >= 4 && /[a-z]/i.test(seg) && /\d/.test(seg))
          return '{id}'
        return seg
      })
      .join('/')
    // Origin kept only when it is not the page's own — a third-party host is
    // diagnostic, your own is noise on every row.
    const sameOrigin = typeof root()?.location?.origin === 'string' && u.origin === root().location.origin
    return (sameOrigin ? '' : u.origin) + path + (u.search ? '?…' : '')
  }
  catch {
    // Not parseable as a URL. Return the part before any query rather than the
    // whole thing, so a malformed URL cannot leak what a valid one would not.
    return String(raw).split('?')[0].slice(0, 200)
  }
}

/**
 * Remove secrets from a string before it can become an issue title.
 *
 * This is a blocker for console capture, not a nicety. `issueTitle` on the
 * server builds `issues.title` from the message, and that title is handed to
 * the alert dispatcher — so it leaves the system by SMTP and webhook. Anything
 * unscrubbed here is emailed.
 *
 * Replacements are shape-preserving markers rather than a blanket [scrubbed],
 * so a message stays diagnosable after it has been cleaned.
 */
export function scrubValue(input: string): string {
  let out = String(input)
  // JWTs before the generic opaque-token rule, which would otherwise eat them
  // and lose the fact that it was a token at all.
  out = out.replace(/\b(?:eyJ[\w-]{10,}\.){2}[\w-]{10,}\b/g, '[jwt]')
  out = out.replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g, '[key]')
  out = out.replace(/\bBearer\s+[\w.\-+/=]{8,}/gi, 'Bearer [token]')
  out = out.replace(/([?&](?:token|key|secret|password|signature|sig|auth|access_token|api_key)=)[^&\s]*/gi, '$1[redacted]')
  out = out.replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[email]')
  // Card numbers, Luhn-checked. Without the check this pattern eats order
  // totals, phone numbers and timestamps — anything 13-19 digits long.
  out = out.replace(/\b(?:\d[ -]*?){13,19}\b/g, m => (luhn(m.replace(/\D/g, '')) ? '[card]' : m))
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]')
  // Opaque high-entropy tokens LAST, so the specific rules above win.
  out = out.replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]')
  return out
}

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19)
    return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (d < 0 || d > 9)
      return false
    if (double) {
      d *= 2
      if (d > 9)
        d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

/**
 * Render console arguments for a message, by TYPE rather than by serializing.
 *
 * This is the single biggest privacy win and it needs no regex: objects and
 * arrays become type tokens instead of being flattened. The trailing argument
 * to a console.error in a real app is routinely the whole cart, order, user or
 * payment method, and serializing it puts every field into the message, the
 * issue title, and therefore the alert email.
 */
export function consoleArgs(args: unknown[]): string {
  return args.map((a) => {
    if (typeof a === 'string')
      return scrubValue(a).slice(0, 200)
    if (a === null)
      return 'null'
    if (a === undefined)
      return 'undefined'
    if (typeof a === 'number' || typeof a === 'boolean')
      return String(a)
    if (typeof a === 'function')
      return '[Function]'
    if (typeof a === 'symbol')
      return '[Symbol]'
    if (a instanceof Error)
      return `${a.name}: ${scrubValue(String(a.message)).slice(0, 200)}`
    if (Array.isArray(a))
      return `[Array(${a.length})]`
    return '[Object]'
  }).join(' ').slice(0, 300)
}

/**
 * Reduce a label to its shape, so the fingerprint groups by the call rather
 * than by the values that happened to be interpolated into it.
 *
 * Stronger than the server's normalizeMessage, which masks only hex, UUIDs,
 * bare decimals and matched quotes. The load-bearing addition is the
 * letters-and-digits rule, which is what catches ord_a8f3kd, SKU-AB12 and
 * pi_3Nx… — the id shapes that would otherwise mint one issue per order.
 *
 * It also mangles v1, utf-8 and sha256. That is harmless: it mangles them
 * identically every time, and a skeleton is only ever hashed, never displayed.
 */
export function skeletonize(input: string): string {
  let out = String(input)
  out = out.replace(/https?:\/\/[^\s'"`)]+/g, u => maskUrl(u))
  out = out.replace(/(['"`]).*?\1/g, '$1…$1')
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '{uuid}')
  out = out.replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '{email}')
  // Tokens of 4+ chars containing BOTH a letter and a digit — ord_a8f3kd,
  // SKU-AB12, pi_3Nx… — are ids in practice and never route names.
  //
  // Matched first, tested after. The lookahead form of this
  // (?=[^\s]*[A-Za-z])(?=[^\s]*\d) nests unlimited quantifiers and backtracks
  // catastrophically on a long token, which matters because this runs on every
  // console.error in a customer's app. A single linear match plus two cheap
  // tests on the captured string is the same rule without the hazard.
  out = out.replace(/\b[A-Za-z0-9_-]{4,}\b/g, (tok) => {
    return /[A-Za-z]/.test(tok) && /\d/.test(tok) ? '{id}' : tok
  })
  out = out.replace(/\b\d+\b/g, '{n}')
  return out.replace(/\s+/g, ' ').trim().slice(0, 80)
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string')
    return value
  if (value instanceof Error)
    return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}

let defaultClient: BugHQClient | null = null

/** Initialize the default client (installs global handlers in the browser). */
export function init(config: BugHQConfig): BugHQClient {
  defaultClient = new BugHQClient(config)
  return defaultClient
}

export function getClient(): BugHQClient | null {
  return defaultClient
}

export function captureException(err: unknown, extra?: Record<string, unknown>): void {
  defaultClient?.captureException(err, extra)
}

export function captureMessage(message: string, level?: Level, extra?: Record<string, unknown>): void {
  defaultClient?.captureMessage(message, level, extra)
}

/**
 * Ergonomic one-call reporting for the default client: `report(err)` captures
 * an exception, `report('something broke')` captures an error-level message.
 * The friendly entry point — `import { report } from '@bughq/sdk'`.
 */
export function report(error: unknown, extra?: Record<string, unknown>): void {
  defaultClient?.report(error, extra)
}

export function addBreadcrumb(crumb: Breadcrumb): void {
  defaultClient?.addBreadcrumb(crumb)
}

export function setUser(user: BugHQUser | null): void {
  defaultClient?.setUser(user)
}

export function setTag(key: string, value: string): void {
  defaultClient?.setTag(key, value)
}

export function setTags(tags: Record<string, string>): void {
  defaultClient?.setTags(tags)
}

export function setContext(name: string, context: Record<string, unknown> | null): void {
  defaultClient?.setContext(name, context)
}

export function setExtra(key: string, value: unknown): void {
  defaultClient?.setExtra(key, value)
}

export function setExtras(extras: Record<string, unknown>): void {
  defaultClient?.setExtras(extras)
}

export function setLevel(level: Level | null): void {
  defaultClient?.setLevel(level)
}

export function reportFailure(op: string, error?: unknown, context?: Record<string, unknown>): void {
  defaultClient?.reportFailure(op, error, context)
}

export function setFingerprint(fingerprint: string[] | null): void {
  defaultClient?.setFingerprint(fingerprint)
}

export function flush(): Promise<boolean> {
  return defaultClient ? defaultClient.flush() : Promise.resolve(true)
}

export function close(): void {
  defaultClient?.close()
  defaultClient = null
}

/** The `bughq` object the marketing page advertises: `bughq.init({ dsn })`. */
export const bughq = {
  init,
  report,
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  setTag,
  setTags,
  setContext,
  setExtra,
  setExtras,
  setLevel,
  setFingerprint,
  flush,
  close,
  getClient,
}
export default bughq
