import { expect, test } from 'bun:test'
import { bughqEnabled } from '../src/shared'

test('bughqEnabled requires a key or a dsn, and nothing else', () => {
  // The regression this file exists for: `{ key }` alone MUST enable the
  // module. It used to return false, which made both runtime plugins return
  // before init() and captured nothing at all — silently, since nothing had
  // loaded to warn. The bughq dashboard prints exactly this config.
  expect(bughqEnabled({ key: 'k' })).toBe(true)

  expect(bughqEnabled({ dsn: 'https://k@bughq.org/p' })).toBe(true)
  expect(bughqEnabled({ project: 'p', key: 'k' })).toBe(true)
  expect(bughqEnabled({ project: 'p', dsn: 'https://k@bughq.org/p' })).toBe(true)

  // A project with no credential still cannot report.
  expect(bughqEnabled({ project: 'p' })).toBe(false)
  expect(bughqEnabled({})).toBe(false)
  expect(bughqEnabled(null)).toBe(false)
  expect(bughqEnabled(undefined)).toBe(false)
})
