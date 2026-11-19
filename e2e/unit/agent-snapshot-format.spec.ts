import { test, expect } from '@playwright/test'
import { formatSnapshot, TRUNCATION_HINT } from '../../src/main/agent/snapshot-format'

test('header, lines and no truncation note when it fits', () => {
  const t = formatSnapshot({ title: 'Billing', url: 'http://h/x', lines: ['- button "Go" [ref=e1]'], truncated: 0 }, 20_000)
  const lines = t.split('\n')
  expect(lines[0]).toBe('Page: "Billing" http://h/x')
  expect(lines[1]).toContain('Refs: use ref values')
  expect(lines[2]).toBe('- button "Go" [ref=e1]')
  expect(t).not.toContain('truncated')
})

test('char cap and truncation note', () => {
  const many = Array.from({ length: 100 }, (_, i) => `- text "line ${i}"`)
  const t = formatSnapshot({ title: 'T', url: 'http://h/', lines: many, truncated: 5 }, 600)
  expect(t.length).toBeLessThan(800)
  expect(t).toMatch(/… truncated: \d+ more elements not shown\./)
  expect(t).toContain(TRUNCATION_HINT)
  const n = Number(/truncated: (\d+)/.exec(t)![1])
  expect(n).toBeGreaterThan(5)
})
