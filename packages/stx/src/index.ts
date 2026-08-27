/**
 * @bughq/stx — bughq error tracking for Stacks / stx apps.
 *
 * - Server capture: `import { init, captureException } from '@bughq/stx'`
 *   (re-exported from ./server) — captures Bun/server errors.
 * - Client capture: drop the tracking snippet into your layout. Use
 *   `clientSnippet()` to render it from an stx `<script server>` block, or copy
 *   the `resources/BugHQ.stx` partial shipped with this package.
 */
export * from './server'
export { default } from './server'

export interface SnippetOptions {
  /**
   * The ingest key. This alone identifies the project — it is the only
   * required field.
   */
  key: string
  /**
   * Optional project id (`slug-abc123`). Almost nobody needs this: the ingest
   * resolves the project from `key`. Supplying a WRONG id is worse than
   * supplying none, because the server looks the project up by id and answers
   * `404 unknown project` without ever consulting the key — and the browser
   * loader neither retries a 404 nor surfaces it, so every event is lost in
   * silence. Leave it unset unless you have a reason.
   */
  project?: string
  /** Host that serves the loader. Defaults to https://bughq.org; self-hosters override it. */
  host?: string
}

/** Escape a value for interpolation into a double-quoted HTML attribute. */
function attr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Build the client `<script>` tag that loads bughq's browser autoloader.
 * Render it raw in an stx layout, e.g.:
 *
 * ```stx
 * <script server>
 * import { clientSnippet } from '@bughq/stx'
 * const bughqTag = clientSnippet({ key: 'pk_...' })
 * </script>
 * {!! bughqTag !!}
 * ```
 */
export function clientSnippet(options: SnippetOptions): string {
  // Fixed production ingest endpoint. Self-hosters override `host`.
  const host = (options.host ?? 'https://bughq.org').replace(/\/+$/, '')
  // `/api/sdk.js`, never a bare `/sdk.js`. The public origin routes `/api/*`
  // and non-GET to the ingest server and EVERY other GET to the web app, so a
  // bare `GET /sdk.js` reaches the page handler, finds no page, and answers a
  // 404 HTML document — which the browser refuses to execute. bughq registers
  // the loader at both paths, so `/api/sdk.js` is also correct for a
  // self-hoster pointing `host` straight at the ingest server. There is no
  // configuration in which the bare path is the right one.
  const project = options.project ? ` data-project="${attr(options.project)}"` : ''
  return `<script src="${host}/api/sdk.js"${project} data-key="${attr(options.key)}"></script>`
}
