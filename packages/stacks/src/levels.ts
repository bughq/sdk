import type { Level } from '@bughq/sdk'
import type { StacksLogLevel } from './types'

/**
 * Ordering for the "is this an issue or a breadcrumb?" comparison.
 *
 * `success` ranks with `info` because it is an outcome rather than a severity —
 * the framework's own doc comment says so. `fatal` is included because bughq
 * has it even though Stacks cannot emit it.
 */
const RANK: Record<string, number> = {
  debug: 10,
  info: 20,
  success: 20,
  warning: 30,
  error: 40,
  fatal: 50,
}

export function rank(level: string): number {
  return RANK[level] ?? RANK.info
}

/**
 * Stacks severity to bughq severity.
 *
 * `fatal` is unreachable from a LogRecord — Stacks' LogLevel tops out at
 * `error`. It is reached instead by `setLevel('fatal')` around a capture, which
 * works because `dispatch` reads `level: this.level ?? base.level`.
 */
export function toBugHQLevel(level: StacksLogLevel): Level {
  switch (level) {
    case 'error': return 'error'
    case 'warning': return 'warning'
    case 'debug': return 'debug'
    case 'success':
    case 'info':
    default: return 'info'
  }
}
