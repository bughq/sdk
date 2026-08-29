/**
 * Structural mirrors of the Stacks logging contract.
 *
 * Declared here rather than imported from `@stacksjs/types` on purpose: this
 * package must not drag the framework's dependency tree into the bughq SDK
 * monorepo, and TypeScript is structural — a transport built against these
 * types satisfies `LogTransport` in the host app regardless.
 *
 * Mirrors @stacksjs/types/dist/logging.d.ts:11-56 (stacks 0.72.76).
 */

/** The severities the framework logs at. Note it has no `fatal`. */
export type StacksLogLevel = 'debug' | 'info' | 'success' | 'warning' | 'error'

/** Request-scoped fields carried alongside a log line. */
export interface LogContext {
  requestId?: string
  userId?: string | number
  [key: string]: unknown
}

/**
 * One log call, as a transport sees it.
 *
 * `args` is the call BEFORE formatting, which is the half that matters here:
 * an `Error` is still an `Error` there, with its stack. `message` is the
 * rendered line with the stack already flattened into it — never parse it.
 */
export interface LogRecord {
  level: StacksLogLevel
  message: string
  args: unknown[]
  context?: LogContext
  timestamp: string
}

/** A destination for log records, alongside the console and the log file. */
export interface LogTransport {
  name: string
  level?: StacksLogLevel
  log: (record: LogRecord) => void
  flush?: () => Promise<void>
}
