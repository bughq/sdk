# bughq SDKs

Official JavaScript / TypeScript SDKs for [bughq](https://bughq.org) error
tracking. Add error tracking to any app in one line, with framework-aware
capture (Vue component errors, Nuxt SSR, Stacks server errors) on top of window
error + unhandled-rejection handling.

## Packages

| Package | For | Install |
|---|---|---|
| [`@bughq/sdk`](./packages/sdk) | Any JS/TS app (core) | `bun add @bughq/sdk` |
| [`@bughq/vue`](./packages/vue) | Vue 3 | `bun add @bughq/vue` |
| [`@bughq/nuxt`](./packages/nuxt) | Nuxt 3/4 | `bun add @bughq/nuxt` |
| [`@bughq/stx`](./packages/stx) | Stacks / stx (client + server) | `bun add @bughq/stx` |

## Quick start

```ts
import { bughq } from '@bughq/sdk'

bughq.init({
  project: 'acme-web-9f2c1a',
  key: 'your-public-ingest-key', // safe to ship: a revocable identifier, not a secret
  release: '1.4.0',
  environment: 'production',
})
```

Vue:

```ts
import BugHQ from '@bughq/vue'
app.use(BugHQ, { project: 'acme-web', key: 'pk_...' })
```

Nuxt:

```ts
export default defineNuxtConfig({
  modules: ['@bughq/nuxt'],
  bughq: { project: 'acme-web', key: 'pk_...' },
})
```

You can also pass a single `dsn: 'https://<key>@<host>/<project>'`. See each
package's README for details.

## Develop

```sh
bun install
bun run build     # builds all packages (sdk first)
bun test          # runs all package tests
```

## Release

```sh
bun run publish:packages   # builds, then publishes each package to npm
```

CI publishes on a `v*` tag (needs an `NPM_TOKEN` secret). See `.github/workflows`.

## License

MIT
