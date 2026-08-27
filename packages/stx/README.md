# @bughq/stx

[bughq](https://bughq.org) error tracking for **Stacks / stx** apps — client and
server.

## Install

```sh
bun add @bughq/stx
```

## Server errors (Bun)

Report server-side errors from your Stacks app. Call `init` once at boot; then
`captureException` from your error pipeline (e.g. `config/errors.ts` or any
try/catch). Process handlers catch anything uncaught as a safety net.

```ts
import { init, captureException } from '@bughq/stx'

init({
  key: 'your-public-ingest-key',
  environment: 'production',
  // captureUnhandled: true (default) — also reports uncaughtException / unhandledRejection
})

try { await work() }
catch (err) { captureException(err, { job: 'nightly' }); throw err }
```

## Client errors (browser)

Drop the tracking snippet into a layout. Either render it from a `<script server>`
block:

```stx
<script server>
import { clientSnippet } from '@bughq/stx'
const bughqTag = clientSnippet({ key: 'your-public-ingest-key' })
</script>
{!! bughqTag !!}
```

…or copy the ready-made partial shipped at `@bughq/stx/BugHQ.stx` into your
`resources/` and include it. It reads `BUGHQ_KEY` from env — that is the only
variable it needs — plus the optional `BUGHQ_HOST` and `BUGHQ_PROJECT`.

The ingest key is public (safe in client code) and identifies the project on its
own. A `project` id is optional everywhere in this package; set it only if you
have a reason, and only to a real id, because the ingest resolves an id ahead of
the key and answers `404 unknown project` for one that doesn't match.

For richer client capture you can also use [`@bughq/sdk`](../sdk) directly.
