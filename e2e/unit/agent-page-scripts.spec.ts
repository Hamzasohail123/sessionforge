import { test, expect } from '@playwright/test'
import {
  FocusResult,
  PrepareResult,
  ProbeResult,
  SelectResult,
  SnapshotResult,
  ValueResult,
  prepareActionScript,
  snapshotScript
} from '../../src/main/agent/page-scripts'

test('good fixtures parse', () => {
  expect(PrepareResult.safeParse({ ok: true, x: 1, y: 2, isPassword: false, editable: true }).success).toBe(true)
  expect(PrepareResult.safeParse({ ok: false, code: 'obscured', pageText: 'div ""' }).success).toBe(true)
  expect(SnapshotResult.safeParse({ title: 't', url: 'u', lines: ['- a'], next: 3, truncated: 0, visited: 5 }).success).toBe(true)
  expect(SelectResult.safeParse({ ok: true, selected: ['b'] }).success).toBe(true)
  expect(FocusResult.safeParse({ ok: true }).success).toBe(true)
  expect(ProbeResult.safeParse(true).success).toBe(true)
  expect(ValueResult.safeParse({ value: 'x', isPassword: false }).success).toBe(true)
})

test('bad results are rejected', () => {
  for (const x of [Infinity, NaN, 1e6, -1e6])
    expect(PrepareResult.safeParse({ ok: true, x, y: 0, isPassword: false, editable: false }).success, String(x)).toBe(false)
  expect(PrepareResult.safeParse({ ok: false, code: 'boom' }).success).toBe(false)
  expect(PrepareResult.safeParse({ ok: false, code: 'obscured', pageText: 'x'.repeat(2001) }).success).toBe(false)
  const snap = { title: 't', url: 'u', next: 1, truncated: 0, visited: 0 }
  expect(SnapshotResult.safeParse({ ...snap, lines: Array(1501).fill('a') }).success).toBe(false)
  expect(SnapshotResult.safeParse({ ...snap, lines: ['x'.repeat(401)] }).success).toBe(false)
  expect(PrepareResult.safeParse('{"ok":true}').success).toBe(false)
  expect(ProbeResult.safeParse('true').success).toBe(false)
})

test('arguments are embedded as JSON literals', () => {
  const s = prepareActionScript({ selector: '"]); alert(1); ("' }, { force: false, needEditable: false })
  expect(s).toContain(JSON.stringify({ selector: '"]); alert(1); ("' }))
  expect(() => new Function(s)).not.toThrow()
  expect(() => new Function(snapshotScript({ base: 1, interactiveOnly: false, maxChars: 1000 }))).not.toThrow()
})
