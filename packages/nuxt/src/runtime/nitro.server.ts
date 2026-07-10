import { BugHQClient } from '@bughq/sdk'
// eslint-disable-next-line import/no-unresolved -- resolved by Nuxt/Nitro at build time
import { defineNitroPlugin, useRuntimeConfig } from '#imports'
import { bughqEnabled } from '../shared'

/**
 * Nitro server plugin: reports SSR / server-side errors. A dedicated
 * BugHQClient is used with an explicit User-Agent (the ingest server reads UA
 * from the header for non-browser clients).
 */
export default defineNitroPlugin((nitroApp: any) => {
  const config = (useRuntimeConfig().public as any).bughq ?? {}
  if (!bughqEnabled(config))
    return

  const client = new BugHQClient({
    ...config,
    framework: 'nuxt-server',
    sdkName: config.sdkName ? `${config.sdkName}.server` : 'bughq.nuxt.server',
    userAgent: 'bughq-nuxt (+server)',
    // Server has no window/DOM to instrument; skip browser breadcrumb hooks.
    autoInstrument: false,
  })

  nitroApp.hooks.hook('error', (error: unknown, ctx: any) => {
    const event = ctx?.event
    const req = event?.node?.req
    client.captureException(error, {
      side: 'server',
      method: req?.method,
      path: req?.url,
    })
  })
})
