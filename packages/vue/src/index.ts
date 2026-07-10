/**
 * @bughq/vue — Vue 3 plugin for bughq error tracking.
 *
 * Installs the @bughq/sdk client and chains Vue's own `app.config.errorHandler`
 * (preserving any existing handler) so component errors are captured with their
 * component name + lifecycle hook, on top of the SDK's window-level capture.
 *
 * ```ts
 * import { createApp } from 'vue'
 * import BugHQ from '@bughq/vue'
 * createApp(App).use(BugHQ, { project: 'acme-web', key: 'pk_...' }).mount('#app')
 * ```
 */
import type { App, Plugin } from 'vue'
import type { Breadcrumb, BugHQClient, BugHQConfig, BugHQUser } from '@bughq/sdk'
import { addBreadcrumb, captureException, captureMessage, getClient, init, setContext, setTag, setUser } from '@bughq/sdk'
import { inject } from 'vue'

export * from '@bughq/sdk'

export interface BugHQVueOptions extends BugHQConfig {
  /** Capture Vue component errors via app.config.errorHandler. Default true. */
  attachErrorHandler?: boolean
  /** Re-log captured errors to the console. Default false. */
  logErrors?: boolean
}

export interface BugHQVue {
  client: BugHQClient
  captureException: (err: unknown, extra?: Record<string, unknown>) => void
  captureMessage: BugHQClient['captureMessage']
  addBreadcrumb: (crumb: Breadcrumb) => void
  setUser: (user: BugHQUser | null) => void
  setTag: (key: string, value: string) => void
  setContext: (name: string, context: Record<string, unknown> | null) => void
}

const INJECTION_KEY = '__bughq__'

function makeApi(client: BugHQClient): BugHQVue {
  return {
    client,
    captureException: (err, extra) => client.captureException(err, extra),
    captureMessage: (message, level, extra) => client.captureMessage(message, level, extra),
    addBreadcrumb: crumb => client.addBreadcrumb(crumb),
    setUser: user => client.setUser(user),
    setTag: (key, value) => client.setTag(key, value),
    setContext: (name, context) => client.setContext(name, context),
  }
}

/** Create the plugin from options: `app.use(createBugHQ({ dsn }))`. */
export function createBugHQ(options: BugHQVueOptions): Plugin {
  return {
    install(app: App) {
      const client = init({
        ...options,
        framework: options.framework ?? 'vue',
        sdkName: options.sdkName ?? 'bughq.vue',
      })

      // Record component mount/route intent as a breadcrumb where a router is
      // present, so the trail leading to a component error has navigation context.
      const router = (app.config.globalProperties as any)?.$router
      if (router && typeof router.afterEach === 'function') {
        router.afterEach((to: any) => {
          client.addBreadcrumb({ type: 'navigation', category: 'vue-router', message: to?.fullPath ?? to?.path, data: { name: to?.name } })
        })
      }

      if (options.attachErrorHandler !== false) {
        const previous = app.config.errorHandler
        app.config.errorHandler = (err, instance, info) => {
          try {
            const opts = (instance as any)?.$options ?? {}
            client.captureException(err, { lifecycle: info, component: opts.name ?? opts.__name })
          }
          catch {
            // reporting must never break the app
          }
          if (options.logErrors)
            console.error(err)
          if (typeof previous === 'function')
            previous(err, instance, info)
        }
      }

      // Vue's warn handler is dev-only, but surfacing warnings as breadcrumbs
      // helps explain the state an error was thrown from.
      const previousWarn = app.config.warnHandler
      app.config.warnHandler = (msg, instance, trace) => {
        try {
          client.addBreadcrumb({ type: 'default', category: 'vue.warn', level: 'warning', message: String(msg) })
        }
        catch {
          // ignore
        }
        if (typeof previousWarn === 'function')
          previousWarn(msg, instance, trace)
      }

      const api = makeApi(client)
      app.provide(INJECTION_KEY, api)
      app.config.globalProperties.$bughq = api
    },
  }
}

/** Default export for `app.use(BugHQ, { project, key })`. */
const plugin: Plugin = {
  install(app: App, options?: BugHQVueOptions) {
    (createBugHQ(options ?? {}) as { install: (app: App) => void }).install(app)
  },
}
export default plugin

/** Manual capture inside components: `const { captureException } = useBugHQ()`. */
export function useBugHQ(): BugHQVue {
  const api = inject<BugHQVue | null>(INJECTION_KEY, null)
  if (api)
    return api
  // Plugin not installed on this app — fall back to the module-level client.
  return {
    client: getClient() as BugHQClient,
    captureException,
    captureMessage,
    addBreadcrumb,
    setUser,
    setTag,
    setContext,
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $bughq: BugHQVue
  }
}
