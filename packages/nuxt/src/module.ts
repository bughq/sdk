/**
 * @bughq/nuxt — Nuxt module for bughq error tracking.
 *
 * Reads options from `nuxt.config` under the `bughq` key, exposes them to the
 * runtime via `runtimeConfig.public.bughq` (the ingest key is public by design),
 * and registers a client plugin (captures Vue/component errors + window errors)
 * and a Nitro server plugin (captures SSR/server errors).
 *
 * ```ts
 * export default defineNuxtConfig({
 *   modules: ['@bughq/nuxt'],
 *   bughq: { project: 'acme-web', key: 'pk_...' },
 * })
 * ```
 */
import type { BugHQConfig } from '@bughq/sdk'
import { addImports, addPlugin, addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit'

export type ModuleOptions = BugHQConfig

// Manual-capture helpers surfaced as Nuxt auto-imports, so any component,
// composable, or server route can call `report(err)` / `captureException(err)`
// without importing from '@bughq/sdk' first.
const AUTO_IMPORTS = ['report', 'captureException', 'captureMessage', 'addBreadcrumb', 'setUser', 'setTag', 'setContext'] as const

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@bughq/nuxt',
    configKey: 'bughq',
    compatibility: { nuxt: '>=3.0.0' },
  },
  defaults: {
    // Fixed production ingest endpoint. Self-hosters override `host`.
    host: 'https://bughq.org',
    environment: 'production',
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    // The ingest key is public, so exposing config to the client is intentional.
    const publicConfig = nuxt.options.runtimeConfig.public as Record<string, unknown>
    publicConfig.bughq = Object.assign({}, publicConfig.bughq as Record<string, unknown> | undefined, options)

    addPlugin({ src: resolve('./runtime/plugin.client'), mode: 'client' })
    addServerPlugin(resolve('./runtime/nitro.server'))

    // `report(err)` and friends become available everywhere with no import line.
    addImports(AUTO_IMPORTS.map(name => ({ name, as: name, from: '@bughq/sdk' })))
  },
})
