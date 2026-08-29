# @bughq/stacks

bughq error tracking for [Stacks](https://stacksjs.org) apps, installed as a log transport.

```bash
bun add @bughq/stacks
```

```ts
// config/logging.ts
import { bughqTransport } from '@bughq/stacks'
import { storagePath } from '@stacksjs/path'

export default {
  logsPath: storagePath('logs/stacks.log'),
  deploymentsPath: storagePath('logs/deployments.log'),
  transports: [bughqTransport()],
} satisfies LoggingConfig
```

Set `BUGHQ_KEY` in `.env` and you are done. The ingest key alone identifies the
project — it is public and revocable.

## What you get

Records at or above `eventLevel` (default `error`) become **issues**; everything
below becomes a **breadcrumb** on the same trace, so an issue arrives with the
trail that led to it. Both come from log calls the framework already makes:

- **Unhandled request errors** — the router reports them through `report()`.
- **Failed jobs** — the queue already logs them with the live `Error` attached.
- **Anything your app logs** with `log.error(...)`.

Because `LogRecord.args` carries the call *before* formatting, an `Error` is
still an `Error` with its stack when the transport sees it. Nothing is parsed
out of a rendered string.

## Manual capture

```ts
import { bughq } from '@bughq/stacks'

try { await work() }
catch (err) { bughq.captureException(err, { job: 'nightly' }); throw err }
```

`setUser`, `setTag`, `setContext`, `addBreadcrumb`, `flush` and `getClient` are
all on the same object.

## Configuration

Every field falls back to a `BUGHQ_*` environment variable.

```ts
bughqTransport({
  key: process.env.BUGHQ_KEY,     // or dsn / project
  environment: 'production',
  eventLevel: 'error',            // issue/breadcrumb line
  breadcrumbs: { logs: true, maxBreadcrumbs: 30 },
  capture: {
    user: true,
    queueFailures: true,
    unhandled: false,             // see below
  },
})
```

For a config file, make one and pass it in — explicit beats magic, and Stacks'
config loader only imports a hardcoded list of sections, so a `config/bughq.ts`
could never load itself:

```ts
// config/bughq.ts
import { defineBugHQ } from '@bughq/stacks'
export default defineBugHQ({ eventLevel: 'error' })

// config/logging.ts
import bughq from './bughq'
transports: [bughqTransport(bughq)]
```

## Processes without a config file

Queue workers, CLI commands, and the compiled-binary path (where
`SKIP_CONFIG_LOADING` means `config/logging.ts` is never read) need an explicit
attach:

```ts
import { install } from '@bughq/stacks'
install({ capture: { unhandled: true } })
```

`capture.unhandled` installs `uncaughtException` / `unhandledRejection`
handlers that **flush and then re-raise**. They are off by default because the
built server entry already installs its own, and because a handler that merely
reports would suppress the runtime's terminate-on-fault — turning a crash into a
worker that keeps polling with a dead pool while the supervisor sees a healthy
process.

## Known blind spots

Honest list, so a silent gap is never a surprise:

- **Inline-closure route handlers** have no `try/catch` wrapper in the router,
  so a throw inside one is not reported. Action and string handlers are fine.
- **`handleError()` / `ErrorHandler.handle()` bypass logging entirely** — they
  import no logger and write via `console.error` + `fs.appendFile`, so nothing
  reaches any transport.
- **4xx responses carry no stack**, by design: `report()` demotes them to
  `debug`, which makes them breadcrumbs rather than issues.
- **`SKIP_CONFIG_LOADING`** in the compiled-binary path means `config/logging.ts`
  is never read. Use `install()` there.
- **Never set a top-level `logging.level`.** `LogLevel` includes `'warning'` but
  the config validator accepts only `[trace, debug, info, warn, error, fatal]`;
  the type-legal value is either a boot throw or a silently swallowed rejection
  that leaves `transports()` empty forever. Per-transport severity lives on
  `eventLevel` here, which the validator never inspects.
- **SQL breadcrumbs are not implemented yet.** Statement text is not reliably
  available from the query hooks; shipping them blind would be a silent
  misfeature.

Requires `@stacksjs/logging >= 0.72.76` — the version that introduced
`LogTransport` and `registerTransport`.

## License

MIT
