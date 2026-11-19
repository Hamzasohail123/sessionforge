// Line-level diff for the editor-approval preview (design §2.6). Pure.
import type { DiffLine } from './types'
export const MAX_DIFF_LINES = 200
const LCS_LIMIT = 4000
type Op = { kind: ' ' | '+' | '-'; text: string; a: number; b: number }
function splitLines(s: string): string[] {
  if (s === '') return []
  const lines = s.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
}
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length
  const m = b.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push({ kind: ' ', text: a[i], a: i++, b: j++ })
    // Removals before additions when both keep the LCS length
    else if (i < n && (j === m || dp[i + 1][j] >= dp[i][j + 1])) ops.push({ kind: '-', text: a[i], a: i++, b: j })
    else ops.push({ kind: '+', text: b[j], a: i, b: j++ })
  }
  return ops
}
/** Large inputs: one hunk between the common prefix and suffix. */
function prefixSuffixOps(a: string[], b: string[]): Op[] {
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  const ops: Op[] = []
  for (let i = 0; i < p; i++) ops.push({ kind: ' ', text: a[i], a: i, b: i })
  for (let i = p; i < a.length - s; i++) ops.push({ kind: '-', text: a[i], a: i, b: p })
  for (let j = p; j < b.length - s; j++) ops.push({ kind: '+', text: b[j], a: a.length - s, b: j })
  for (let k = s; k > 0; k--) ops.push({ kind: ' ', text: a[a.length - k], a: a.length - k, b: b.length - k })
  return ops
}
/**
 * Changed lines with `context` lines around each change. Gaps between hunks become a '…' line, and the
 * output stops at MAX_DIFF_LINES with a final '…'. Line numbers are 1-based (before for ' '/'-', after for '+').
 */
export function diffHunks(before: string, after: string, context = 2): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  const ops = a.length > LCS_LIMIT || b.length > LCS_LIMIT ? prefixSuffixOps(a, b) : lcsOps(a, b)
  const keep = new Array<boolean>(ops.length).fill(false)
  ops.forEach((op, i) => {
    if (op.kind === ' ') return
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true
  })
  const out: DiffLine[] = []
  let gap = false
  for (let i = 0; i < ops.length; i++) {
    if (!keep[i]) {
      gap = out.length > 0
      continue
    }
    if (gap) out.push({ kind: '…', text: '', line: 0 })
    gap = false
    const op = ops[i]
    out.push({ kind: op.kind, text: op.text, line: op.kind === '+' ? op.b + 1 : op.a + 1 })
    if (out.length >= MAX_DIFF_LINES) {
      if (i < ops.length - 1) out.push({ kind: '…', text: '', line: 0 })
      break
    }
  }
  return out
}
