import { addBreadcrumb, captureException, init } from '@bughq/sdk'
// eslint-disable-next-line import/no-unresolved -- resolved by Nuxt at build time
import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { bughqEnabled } from '../shared'

/**
 * Client plugin: initializes the SDK (installs window error handlers + browser
 * breadcrumb instrumentation) and captures Vue/component errors through Nuxt's
 * `vue:error` hook, plus route changes as navigation breadcrumbs.
 */
export default defineNuxtPlugin({
  name: 'bughq',
  enforce: 'pre',
  setup(nuxtApp: any) {
    const config = (useRuntimeConfig().public as any).bughq ?? {}
    if (!bughqEnabled(config))
      return

    init({ ...config, framework: 'nuxt', sdkName: config.sdkName ?? 'bughq.nuxt' })

    nuxtApp.hook('vue:error', (err: unknown, _instance: unknown, info: string) => {
      captureException(err, { lifecycle: info })
    })

    nuxtApp.hook('app:error', (err: unknown) => {
      captureException(err, { lifecycle: 'app:error' })
    })

    // Route transitions -> navigation breadcrumbs (best-effort; router present on client).
    const router = nuxtApp.$router
    if (router && typeof router.afterEach === 'function') {
      router.afterEach((to: any) => {
        addBreadcrumb({ type: 'navigation', category: 'nuxt-router', message: to?.fullPath ?? to?.path, data: { name: to?.name } })
      })
    }
  },
})
