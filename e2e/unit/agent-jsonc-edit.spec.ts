import { test, expect } from '@playwright/test'
import { parse } from 'jsonc-parser'
import {
  appendArrayElements,
  comments,
  insertProperty,
  removeArrayElements,
  removeProperty
} from '../../src/main/agent/approvals/jsonc-edit'
/** The edit stays inside [start, end) of before: everything outside is byte-identical. */
function outsideUnchanged(before: string, after: string, start: number, end: number): void {
  expect(after.slice(0, start)).toBe(before.slice(0, start))
  expect(after.slice(after.length - (before.length - end))).toBe(before.slice(end))
}
const span = (text: string, open: string, close: string, from = 0) => {
  const s = text.indexOf(open, from)
  return [s, text.indexOf(close, s) + close.length] as const
}
test('one-line array: removing the last element keeps valid JSON (reviewer case 1)', () => {
  const t = '{"permissions": {"allow": ["Bash(ls)", "mcp__sessionforge__*"]}}'
  const out = removeArrayElements(t, ['permissions', 'allow'], [1])
  expect(out).toBe('{"permissions": {"allow": ["Bash(ls)"]}}')
  const [s, e] = span(t, '[', ']')
  outsideUnchanged(t, out, s, e)
})
test('compact array without spaces (reviewer case 2)', () => {
  expect(removeArrayElements('{"a":[1,2]}', ['a'], [1])).toBe('{"a":[1]}')
  expect(removeArrayElements('{"a":[1,2]}', ['a'], [0])).toBe('{"a":[2]}')
  expect(removeArrayElements('{"a":[1, 2, 3]}', ['a'], [1])).toBe('{"a":[1, 3]}')
  expect(removeArrayElements('{"a":[1]}', ['a'], [0])).toBe('{"a":[]}')
})
test('multi-line removal keeps the comment of the previous element (reviewer case 3)', () => {
  const t = '{\n  "mcpAllowlist": [\n    "figma:*", // keep\n    "sessionforge:snapshot"\n  ]\n}\n'
  const out = removeArrayElements(t, ['mcpAllowlist'], [1])
  expect(out).toBe('{\n  "mcpAllowlist": [\n    "figma:*" // keep\n  ]\n}\n')
  expect(comments(out)).toEqual(['// keep'])
})
test('multi-line removal of a first element drops its whole line', () => {
  const t = '{\n  "a": [\n    "x",\n    "y"\n  ]\n}'
  expect(removeArrayElements(t, ['a'], [0])).toBe('{\n  "a": [\n    "y"\n  ]\n}')
  expect(removeArrayElements(t, ['a'], [0, 1])).toBe('{\n  "a": [\n  ]\n}')
})
test('removing a property keeps comments and does not reformat siblings (reviewer case 4)', () => {
  const t =
    '{\n  // why\n  "mcpAllowlist": ["sessionforge:*"], // trailing\n  "terminalAllowlist": ["ls", "git status"]\n}\n'
  const out = removeProperty(t, ['mcpAllowlist'])
  expect(comments(out)).toEqual(comments(t))
  expect(out).toContain('  "terminalAllowlist": ["ls", "git status"]\n}')
  expect(parse(out)).toEqual({ terminalAllowlist: ['ls', 'git status'] })
})
test('removing the last property removes the comma before it', () => {
  expect(removeProperty('{"a": 1, "b": 2}', ['b'])).toBe('{"a": 1}')
  expect(removeProperty('{"a": 1}', ['a'])).toBe('{}')
})
test('inserting a property keeps the trailing comment in place (reviewer case 5)', () => {
  const t = '{\n  "terminalAllowlist": ["ls"] // c\n}\n'
  const out = insertProperty(t, ['mcpAllowlist'], ['sessionforge:*'], '\n')
  expect(out).toBe('{\n  "terminalAllowlist": ["ls"], // c\n  "mcpAllowlist": [\n    "sessionforge:*"\n  ]\n}\n')
  expect(comments(out)).toEqual(['// c'])
})
test('insert into an empty object and an empty nested object', () => {
  expect(insertProperty('{}', ['mcpAllowlist'], ['a'], '\n')).toBe('{\n  "mcpAllowlist": [\n    "a"\n  ]\n}')
  expect(parse(insertProperty('{"permissions": {}}', ['permissions', 'allow'], ['x'], '\n'))).toEqual({
    permissions: { allow: ['x'] }
  })
})
test('append keeps the array style: one-line, multi-line, trailing comma, empty', () => {
  expect(appendArrayElements('{"a": ["x"]}', ['a'], ['y', 'z'], '\n')).toBe('{"a": ["x", "y", "z"]}')
  expect(appendArrayElements('{"a": ["x",]}', ['a'], ['y'], '\n')).toBe('{"a": ["x", "y",]}')
  expect(appendArrayElements('{\n  "a": [\n    "x"\n  ]\n}', ['a'], ['y'], '\n')).toBe('{\n  "a": [\n    "x",\n    "y"\n  ]\n}')
  expect(appendArrayElements('{\n  "a": [\n    "x",\n  ]\n}', ['a'], ['y'], '\n')).toBe('{\n  "a": [\n    "x",\n    "y",\n  ]\n}')
  expect(appendArrayElements('{\n  "a": []\n}', ['a'], ['y'], '\n')).toBe('{\n  "a": [\n    "y"\n  ]\n}')
  // CRLF and tabs follow the file
  expect(appendArrayElements('{\r\n\t"a": [\r\n\t\t"x"\r\n\t]\r\n}', ['a'], ['y'], '\r\n')).toBe(
    '{\r\n\t"a": [\r\n\t\t"x",\r\n\t\t"y"\r\n\t]\r\n}'
  )
})
test('a one-line env block next to the edit is untouched', () => {
  const t = '{\n  "env": {"ANTHROPIC_API_KEY": "sk-x"},\n  "permissions": {"allow": ["mcp__sessionforge__*"]}\n}'
  const out = appendArrayElements(removeArrayElements(t, ['permissions', 'allow'], [0]), ['permissions', 'allow'], ['mcp__sessionforge__snapshot'], '\n')
  expect(out).toContain('  "env": {"ANTHROPIC_API_KEY": "sk-x"},\n')
  expect(parse(out)).toEqual({ env: { ANTHROPIC_API_KEY: 'sk-x' }, permissions: { allow: ['mcp__sessionforge__snapshot'] } })
  const [s, e] = span(t, '"allow": [', ']')
  outsideUnchanged(t, out, s, e)
})
test('block comments between tokens are never removed', () => {
  const t = '{"a": ["x", /* note */ "sessionforge:y"]}'
  const out = removeArrayElements(t, ['a'], [1])
  expect(comments(out)).toEqual(['/* note */'])
  expect(parse(out)).toEqual({ a: ['x'] })
})
