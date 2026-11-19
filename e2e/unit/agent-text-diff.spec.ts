import { test, expect } from '@playwright/test'
import { diffHunks, MAX_DIFF_LINES } from '../../src/main/agent/text-diff'
const lines = (n: number, f = (i: number) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n'
test('two lines of context around a change, gaps marked', () => {
  const before = lines(20)
  const after = before.replace('line 10\n', 'line 10\nadded\n').replace('line 19\n', '')
  const d = diffHunks(before, after)
  expect(d.map((x) => x.kind + x.text)).toEqual([
    ' line 9',
    ' line 10',
    '+added',
    ' line 11',
    ' line 12',
    '…',
    ' line 17',
    ' line 18',
    '-line 19',
    ' line 20'
  ])
  expect(d.find((x) => x.kind === '+')?.line).toBe(11)
  expect(d.find((x) => x.kind === '-')?.line).toBe(19)
})
test('identical text has no diff; a new file is all additions', () => {
  expect(diffHunks('a\nb\n', 'a\nb\n')).toEqual([])
  expect(diffHunks('', '{\n}\n').map((x) => x.kind)).toEqual(['+', '+'])
})
test('output is capped with a final marker', () => {
  const d = diffHunks('', lines(500))
  expect(d).toHaveLength(MAX_DIFF_LINES + 1)
  expect(d[d.length - 1].kind).toBe('…')
})
test('large files use the prefix/suffix fallback', () => {
  const before = lines(5000)
  const after = before.replace('line 2500\n', 'changed\n')
  const d = diffHunks(before, after)
  expect(d.map((x) => x.kind + x.text)).toEqual([' line 2498', ' line 2499', '-line 2500', '+changed', ' line 2501', ' line 2502'])
})
test('CRLF line endings are compared without the CR', () => {
  expect(diffHunks('a\r\nb\r\n', 'a\r\nc\r\n').map((x) => x.kind + x.text)).toEqual([' a', '-b', '+c'])
})
