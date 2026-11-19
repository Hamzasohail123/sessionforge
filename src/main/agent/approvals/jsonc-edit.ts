// Minimal, scanner-based JSONC edits (design-verdict finding 1). jsonc-parser is used only to parse,
// find nodes and scan tokens; its modify()/format() are never called, because they corrupt one-line
// arrays, drop adjacent comments and reformat lines they touch. Every edit here removes or inserts
// whole tokens; comments are never inside an edit range. Pure.
import { createScanner, findNodeAtLocation, parseTree, visit, type JSONPath, type Node, type ParseError } from 'jsonc-parser'
// jsonc-parser's SyntaxKind is an ambient const enum, which isolatedModules cannot read
const K = {
  OpenBrace: 1,
  CloseBrace: 2,
  OpenBracket: 3,
  CloseBracket: 4,
  Comma: 5,
  LineComment: 12,
  BlockComment: 13,
  LineBreak: 14,
  Trivia: 15,
  EOF: 17
} as const
const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false }
export const BOM = '\uFEFF'
interface Token {
  kind: number
  start: number
  end: number
}
type Range = [number, number]
export function stripBom(text: string): { bom: boolean; body: string } {
  return text.startsWith(BOM) ? { bom: true, body: text.slice(1) } : { bom: false, body: text }
}
export function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}
/** Indent of the first indented line (2 spaces when nothing is indented). */
export function detectIndentUnit(text: string): string {
  const m = /\n([ \t]+)\S/.exec(text)
  return m ? m[1] : '  '
}
export function parseJsonc(text: string): { root: Node | undefined; errors: ParseError[] } {
  const errors: ParseError[] = []
  const root = parseTree(text, errors, PARSE_OPTIONS)
  return { root, errors }
}
/** Every comment in the text, in order (the post-check requires before and after to match). */
export function comments(text: string): string[] {
  const list: string[] = []
  visit(text, { onComment: (offset, length) => list.push(text.substr(offset, length)) }, PARSE_OPTIONS)
  return list
}
function tokens(text: string): Token[] {
  const s = createScanner(text, false)
  const out: Token[] = []
  for (let kind = s.scan(); kind !== K.EOF; kind = s.scan()) {
    out.push({ kind, start: s.getTokenOffset(), end: s.getTokenOffset() + s.getTokenLength() })
  }
  return out
}
const isTrivia = (k: number) => k === K.Trivia || k === K.LineBreak || k === K.LineComment || k === K.BlockComment
const isWs = (c: string | undefined) => c === ' ' || c === '\t'
function lineStart(text: string, pos: number): number {
  const i = text.lastIndexOf('\n', pos - 1)
  return i + 1
}
/** Position of the line break that ends the line holding pos (text.length at EOF). */
function lineEnd(text: string, pos: number): number {
  const i = text.indexOf('\n', pos)
  if (i === -1) return text.length
  return i > 0 && text[i - 1] === '\r' ? i - 1 : i
}
function lineIndent(text: string, pos: number): string {
  const ls = lineStart(text, pos)
  let i = ls
  while (isWs(text[i])) i++
  return text.slice(ls, i)
}
function apply(text: string, ranges: Range[]): string {
  const sorted = [...ranges].sort((a, b) => b[0] - a[0])
  let out = text
  for (const [a, b] of sorted) out = out.slice(0, a) + out.slice(b)
  return out
}
function insertAt(text: string, inserts: Array<[number, string]>): string {
  const sorted = [...inserts].sort((a, b) => b[0] - a[0])
  let out = text
  for (const [pos, s] of sorted) out = out.slice(0, pos) + s + out.slice(pos)
  return out
}
/** Whitespace-only text between a and b (no line break, no comment). */
const onlyWs = (text: string, a: number, b: number) => /^[ \t]*$/.test(text.slice(a, b))
/**
 * Removal ranges for one child (array element or object property) of a container: the child's own
 * token range plus one separating comma (the one after it; for the last child, the one before it).
 * Whitespace between them is removed too, but never a comment or line break. When the child's line
 * is left holding only whitespace, the whole line goes.
 */
function removalRanges(text: string, toks: Token[], node: Node): Range[] {
  const start = node.offset
  const end = node.offset + node.length
  const ti = toks.findIndex((t) => t.start >= end)
  let next = ti
  while (next !== -1 && next < toks.length && isTrivia(toks[next].kind)) next++
  const firstTok = toks.findIndex((t) => t.start >= start)
  let prev = firstTok - 1
  while (prev >= 0 && isTrivia(toks[prev].kind)) prev--
  const ranges: Range[] = [[start, end]]
  if (next !== -1 && next < toks.length && toks[next].kind === K.Comma) {
    const c = toks[next]
    if (onlyWs(text, end, c.start)) ranges[0] = [start, c.end]
    else ranges.push([c.start, c.end])
    // Swallow spaces after the comma when another token follows on the same line
    const e = ranges[ranges.length - 1][1]
    let j = e
    while (isWs(text[j])) j++
    const after = toks.find((t) => t.start >= j)
    if (j > e && after && after.start === j && !isTrivia(after.kind)) ranges[ranges.length - 1][1] = j
  } else if (prev >= 0 && toks[prev].kind === K.Comma) {
    const c = toks[prev]
    if (onlyWs(text, c.end, start)) ranges[0] = [c.start, end]
    else ranges.push([c.start, c.end])
  }
  // Whole-line removal: the child's line has nothing left but whitespace
  const ls = lineStart(text, start)
  const le = lineEnd(text, end)
  const childOnLine = ranges.filter(([a, b]) => a >= ls && b <= le)
  let rest = ''
  let cursor = ls
  for (const [a, b] of [...childOnLine].sort((x, y) => x[0] - y[0])) {
    rest += text.slice(cursor, a)
    cursor = b
  }
  rest += text.slice(cursor, le)
  if (/^[ \t]*$/.test(rest) && ls > 0) {
    // Remove from the previous line break so the following line keeps its own break
    const brk = text[ls - 2] === '\r' ? ls - 2 : ls - 1
    const others = ranges.filter((r) => !childOnLine.includes(r))
    return [...others, [brk, le]]
  }
  // Trailing spaces left at the end of a line (e.g. `"a", "s:x",` → `"a", `)
  const first = ranges[0]
  if (first[1] === le || onlyWs(text, first[1], le)) {
    let s = first[0]
    while (s > ls && isWs(text[s - 1])) s--
    if (s > ls) first[0] = s
  }
  return ranges
}
function nodeAt(text: string, path: JSONPath): { root: Node; node: Node | undefined } {
  const { root, errors } = parseJsonc(text)
  if (!root || errors.length) throw new Error('JSONC parse error')
  return { root, node: path.length ? findNodeAtLocation(root, path) : root }
}
/** Remove array elements by index (highest first). */
export function removeArrayElements(text: string, path: JSONPath, indices: number[]): string {
  let out = text
  for (const i of [...new Set(indices)].sort((a, b) => b - a)) {
    const { node } = nodeAt(out, path)
    if (!node || node.type !== 'array' || !node.children?.[i]) throw new Error('No such array element')
    out = apply(out, removalRanges(out, tokens(out), node.children[i]))
  }
  return out
}
/** Remove the property at path (key, colon, value and one adjacent comma). */
export function removeProperty(text: string, path: JSONPath): string {
  const { node } = nodeAt(text, path)
  const prop = node?.parent
  if (!prop || prop.type !== 'property') throw new Error('No such property')
  return apply(text, removalRanges(text, tokens(text), prop))
}
/** Render a value for insertion: JSON with the file's indent unit, continuation lines indented. */
function render(value: unknown, baseIndent: string, unit: string, eol: string): string {
  return JSON.stringify(value, null, unit).split('\n').join(eol + baseIndent)
}
/**
 * Append items to a container node (array or object). itemTexts are already rendered. Multi-line
 * containers get one item per line at the indent of the last child's line; one-line containers get
 * `, item`. An empty container with only whitespace inside is filled one item per line.
 */
function appendToContainer(text: string, container: Node, itemTexts: (indent: string) => string[], unit: string, eol: string): string {
  const toks = tokens(text)
  const open = container.offset
  const close = container.offset + container.length - 1
  const children = container.children ?? []
  if (children.length === 0) {
    const baseIndent = lineIndent(text, open)
    const childIndent = baseIndent + unit
    const items = itemTexts(childIndent)
    if (/^\s*$/.test(text.slice(open + 1, close))) {
      const inner = eol + items.map((t) => childIndent + t).join(',' + eol) + eol + baseIndent
      return text.slice(0, open + 1) + inner + text.slice(close)
    }
    // Comments inside an empty container stay where they are
    return insertAt(text, [[open + 1, items.join(', ')]])
  }
  const last = children[children.length - 1]
  const lastEnd = last.offset + last.length
  const multiLine = text.slice(open, children[0].offset).includes('\n')
  let ni = toks.findIndex((t) => t.start >= lastEnd)
  while (ni !== -1 && ni < toks.length && isTrivia(toks[ni].kind)) ni++
  const trailingComma = ni !== -1 && ni < toks.length && toks[ni].kind === K.Comma ? toks[ni] : null
  if (!multiLine) {
    const items = itemTexts('')
    if (trailingComma) return insertAt(text, [[trailingComma.end, ' ' + items.join(', ') + ',']])
    return insertAt(text, [[lastEnd, items.map((t) => ', ' + t).join('')]])
  }
  const indent = lineIndent(text, last.offset)
  const items = itemTexts(indent)
  // New lines go after any comment that ends the last child's line, so that comment keeps its place
  const anchor = trailingComma ? trailingComma.end : lastEnd
  let pos = anchor
  for (const t of toks) {
    if (t.start < anchor) continue
    if (t.kind === K.Trivia) continue
    if (t.kind === K.LineComment || (t.kind === K.BlockComment && !text.slice(t.start, t.end).includes('\n'))) {
      pos = t.end
      continue
    }
    break
  }
  if (trailingComma) {
    return insertAt(text, [[pos, items.map((t) => eol + indent + t + ',').join('')]])
  }
  const lines = items.map((t, i) => eol + indent + t + (i < items.length - 1 ? ',' : '')).join('')
  if (pos === lastEnd) return insertAt(text, [[lastEnd, ',' + lines]])
  return insertAt(text, [
    [lastEnd, ','],
    [pos, lines]
  ])
}
/** Append values to the array at path. */
export function appendArrayElements(text: string, path: JSONPath, values: unknown[], eol: string): string {
  if (values.length === 0) return text
  const { node } = nodeAt(text, path)
  if (!node || node.type !== 'array') throw new Error('Not an array')
  const unit = detectIndentUnit(text)
  return appendToContainer(text, node, (ind) => values.map((v) => render(v, ind, unit, eol)), unit, eol)
}
/** Create a property that does not exist yet, as the last property of its parent object. */
export function insertProperty(text: string, path: JSONPath, value: unknown, eol: string): string {
  const parentPath = path.slice(0, -1)
  const key = String(path[path.length - 1])
  const { node } = nodeAt(text, parentPath)
  if (!node || node.type !== 'object') throw new Error('Parent is not an object')
  const unit = detectIndentUnit(text)
  return appendToContainer(text, node, (ind) => [`${JSON.stringify(key)}: ${render(value, ind, unit, eol)}`], unit, eol)
}
