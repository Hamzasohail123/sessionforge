// Merge a preset into an editor's permission file text (design §2.3). Only SessionForge ("owned")
// entries are added or removed; a post-condition check refuses anything else. Pure.
import { isDeepStrictEqual } from 'util'
import { getNodeValue } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import type { ApprovalPreset, EditorId } from '../types'
import {
  appendArrayElements,
  BOM,
  comments,
  detectEol,
  insertProperty,
  parseJsonc,
  removeArrayElements,
  removeProperty,
  stripBom
} from './jsonc-edit'
import { claudeOwned, CODEX_KEY, codexTarget, cursorOwned, jsoncTarget } from './presets'
export type MergeResult =
  | { ok: true; after: string; changed: boolean; warnings: string[]; notes: string[]; requiresAck: boolean }
  | { ok: false; reason: string }
export const SAFE_REASON = 'Could not edit safely; copy the text instead'
export const ADD_SERVER_REASON = 'Add the SessionForge server first (step 2)'
export const CURSOR_REPLACES_WARNING =
  'Cursor uses this file instead of the MCP allowlist in Cursor Settings. Tools you allowed there (for example Figma or Notion) will ask again unless you add them to this file.'
export const CURSOR_KEY_REMOVED_NOTE = 'Removes mcpAllowlist, so the MCP allowlist in Cursor Settings applies again.'
const refuse = (reason: string): MergeResult => ({ ok: false, reason })
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
/** The key whose type is wrong, or null. Shared with detection (design-verdict finding 9). */
export function jsoncShapeError(editor: 'cursor' | 'claude', root: unknown): string | null {
  if (!isObj(root)) return 'root'
  if (editor === 'cursor') {
    return root.mcpAllowlist === undefined || Array.isArray(root.mcpAllowlist) ? null : 'mcpAllowlist'
  }
  if (root.permissions === undefined) return null
  if (!isObj(root.permissions)) return 'permissions'
  const p = root.permissions
  for (const k of ['allow', 'ask', 'deny']) if (p[k] !== undefined && !Array.isArray(p[k])) return `permissions.${k}`
  return null
}
/** The owned list (Cursor mcpAllowlist, Claude permissions.allow), undefined when absent. */
export function jsoncList(editor: 'cursor' | 'claude', root: Obj): unknown[] | undefined {
  if (editor === 'cursor') return root.mcpAllowlist as unknown[] | undefined
  return (root.permissions as Obj | undefined)?.allow as unknown[] | undefined
}
/** Parse JSONC text; blank text is {}. */
export function readJsonc(
  editor: 'cursor' | 'claude',
  text: string | null
): { ok: true; value: Obj; blank: boolean } | { ok: false; reason: string } {
  const body = text === null ? '' : stripBom(text).body
  if (body.trim() === '') return { ok: true, value: {}, blank: true }
  const { root, errors } = parseJsonc(body)
  if (!root || errors.length) return { ok: false, reason: `Can't parse the file (line ${lineOf(body, errors[0]?.offset ?? 0)})` }
  const value = getNodeValue(root) as unknown
  const bad = jsoncShapeError(editor, value)
  if (bad) return { ok: false, reason: `Unexpected shape at ${bad}` }
  return { ok: true, value: value as Obj, blank: false }
}
function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length
}
const sameList = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i])
function mergeJsonc(editor: 'cursor' | 'claude', text: string | null, preset: ApprovalPreset, readOnlyTools: string[]): MergeResult {
  const owned = editor === 'cursor' ? cursorOwned : claudeOwned
  const path = editor === 'cursor' ? ['mcpAllowlist'] : ['permissions', 'allow']
  const read = readJsonc(editor, text)
  if (!read.ok) return refuse(`${read.reason}; fix it or copy the text instead`)
  const B = read.value
  const list = jsoncList(editor, B)
  const target = jsoncTarget(editor, preset, readOnlyTools)
  const requiresAck = editor === 'cursor' && preset !== 'ask' && list === undefined
  const warnings: string[] = []
  const notes: string[] = []
  if (editor === 'cursor' && preset !== 'ask' && (requiresAck || list !== undefined)) warnings.push(CURSOR_REPLACES_WARNING)
  const currentOwned = (list ?? []).filter(owned)
  if (sameList(currentOwned, target) && (list !== undefined || target.length === 0)) {
    return { ok: true, after: text ?? '', changed: false, warnings, notes, requiresAck }
  }
  const { bom, body } = text === null ? { bom: false, body: '' } : stripBom(text)
  const eol = detectEol(body)
  let after: string
  let keyRemoved = false
  try {
    if (read.blank) {
      const obj = editor === 'cursor' ? { mcpAllowlist: target } : { permissions: { allow: target } }
      after = JSON.stringify(obj, null, 2) + eol
    } else if (list === undefined) {
      if (editor === 'cursor') after = insertProperty(body, ['mcpAllowlist'], target, eol)
      else if (B.permissions === undefined) after = insertProperty(body, ['permissions'], { allow: target }, eol)
      else after = insertProperty(body, ['permissions', 'allow'], target, eol)
    } else {
      const idx = list.flatMap((e, i) => (owned(e) ? [i] : []))
      if (editor === 'cursor' && preset === 'ask' && idx.length > 0 && idx.length === list.length) {
        after = removeProperty(body, ['mcpAllowlist'])
        keyRemoved = true
        notes.push(CURSOR_KEY_REMOVED_NOTE)
      } else {
        after = appendArrayElements(removeArrayElements(body, path, idx), path, target, eol)
      }
    }
  } catch {
    return refuse(SAFE_REASON)
  }
  if (!postCheckJsonc(editor, body, after, B, target, keyRemoved, owned)) return refuse(SAFE_REASON)
  return { ok: true, after: (bom ? BOM : '') + after, changed: true, warnings, notes, requiresAck }
}
function postCheckJsonc(
  editor: 'cursor' | 'claude',
  before: string,
  after: string,
  B: Obj,
  target: string[],
  keyRemoved: boolean,
  owned: (e: unknown) => boolean
): boolean {
  const { root, errors } = parseJsonc(after)
  if (!root || errors.length) return false
  const A = getNodeValue(root) as unknown
  if (jsoncShapeError(editor, A)) return false
  const aList = jsoncList(editor, A as Obj)
  if (!sameList((aList ?? []).filter(owned), target)) return false
  const strip = (o: Obj): Obj => {
    const c = JSON.parse(JSON.stringify(o)) as Obj
    const l = jsoncList(editor, c)
    if (l) {
      const kept = l.filter((e) => !owned(e))
      if (editor === 'cursor') c.mcpAllowlist = kept
      else (c.permissions as Obj).allow = kept
    }
    return c
  }
  const b = strip(B)
  const a = strip(A as Obj)
  if (editor === 'cursor') {
    if (Array.isArray(a.mcpAllowlist) && a.mcpAllowlist.length === 0 && B.mcpAllowlist === undefined) delete a.mcpAllowlist
    if (keyRemoved) delete b.mcpAllowlist
  } else {
    const ap = a.permissions as Obj | undefined
    const bp = B.permissions as Obj | undefined
    if (ap && Array.isArray(ap.allow) && ap.allow.length === 0 && bp?.allow === undefined) delete ap.allow
    if (ap && Object.keys(ap).length === 0 && bp === undefined) delete a.permissions
  }
  if (!isDeepStrictEqual(b, a)) return false
  return isDeepStrictEqual(comments(before), comments(after))
}
// ---------------------------------------------------------------- Codex (TOML, line edits)
const HEADER_RE = /^\s*\[\s*mcp_servers\s*\.\s*("sessionforge"|'sessionforge'|sessionforge)\s*\]\s*(#.*)?$/
const KEY_RE = new RegExp(`^\\s*${CODEX_KEY}\\s*=`)
const TABLE_RE = /^\s*\[/
export function parseCodex(text: string): { ok: true; value: Obj } | { ok: false; reason: string } {
  try {
    return { ok: true, value: parseToml(stripBom(text).body) as Obj }
  } catch (e) {
    const line = (e as { line?: number }).line
    return { ok: false, reason: `Can't parse config.toml${line ? ` (line ${line})` : ''}` }
  }
}
export function codexServer(root: Obj): Obj | undefined {
  const servers = root.mcp_servers
  if (!isObj(servers)) return undefined
  const s = servers.sessionforge
  return isObj(s) ? s : undefined
}
/** Per-tool approval_mode entries win over the server default: the state is Custom. */
export function codexPerToolModes(server: Obj): string[] {
  const tools = server.tools
  if (!isObj(tools)) return []
  return Object.entries(tools).flatMap(([name, t]) => (isObj(t) && t.approval_mode !== undefined ? [name] : []))
}
function unbalanced(line: string): boolean {
  const count = (s: string) => line.split(s).length - 1
  return count('"""') % 2 === 1 || count("'''") % 2 === 1 || count('[') > count(']')
}
function mergeCodex(text: string | null, preset: ApprovalPreset): MergeResult {
  if (text === null) return refuse(ADD_SERVER_REASON)
  const parsed = parseCodex(text)
  if (!parsed.ok) return refuse(`${parsed.reason}; fix it or copy the text instead`)
  const server = codexServer(parsed.value)
  if (!server) return refuse(ADD_SERVER_REASON)
  const perTool = codexPerToolModes(server)
  if (perTool.length) {
    return refuse(`Per-tool approval_mode is set for ${perTool.join(', ')}; edit [mcp_servers.sessionforge.tools] by hand`)
  }
  const target = codexTarget(preset)
  const result = (after: string, changed: boolean): MergeResult => ({
    ok: true,
    after,
    changed,
    warnings: [],
    notes: [],
    requiresAck: false
  })
  if (server[CODEX_KEY] === target) return result(text, false)
  const { bom, body } = stripBom(text)
  const cr = detectEol(body) === '\r\n' ? '\r' : ''
  // Split on \n only: a \r stays at the end of its line, so untouched lines keep their exact bytes
  const lines = body.split('\n')
  const header = lines.findIndex((l) => HEADER_RE.test(l))
  if (header === -1) return refuse('The SessionForge server is not a [mcp_servers.sessionforge] table; copy the text instead')
  let end = header + 1
  while (end < lines.length && !TABLE_RE.test(lines[end])) end++
  const out: string[] = lines.slice(0, header + 1)
  if (target !== undefined) out.push(`${CODEX_KEY} = "${target}"${cr}`)
  for (let i = header + 1; i < end; i++) {
    const l = lines[i]
    if (KEY_RE.test(l)) {
      if (l.includes('#') || unbalanced(l)) return refuse(SAFE_REASON)
      continue
    }
    out.push(l)
  }
  out.push(...lines.slice(end))
  const after = out.join('\n')
  // Post-check: only the owned key differs, and it has the target value
  const a = parseCodex(after)
  const b = parseCodex(body)
  if (!a.ok || !b.ok) return refuse(SAFE_REASON)
  const as = codexServer(a.value)
  const bs = codexServer(b.value)
  if (!as || !bs || as[CODEX_KEY] !== target) return refuse(SAFE_REASON)
  delete as[CODEX_KEY]
  delete bs[CODEX_KEY]
  if (!isDeepStrictEqual(a.value, b.value)) return refuse(SAFE_REASON)
  return result((bom ? BOM : '') + after, true)
}
export function merge(editor: EditorId, text: string | null, preset: ApprovalPreset, readOnlyTools: string[]): MergeResult {
  return editor === 'codex' ? mergeCodex(text, preset) : mergeJsonc(editor, text, preset, readOnlyTools)
}
