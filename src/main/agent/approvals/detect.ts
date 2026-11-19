// Read-only state detection per editor (design §2.5 and design-verdict findings 4, 8, 9). Pure.
import type { ApprovalState, EditorId } from '../types'
import { claudeOwned, CODEX_KEY, cursorOwned, SERVER } from './presets'
import { codexPerToolModes, codexServer, jsoncList, parseCodex, readJsonc } from './merge'
export interface Detected {
  state: ApprovalState
  notes: string[]
}
/** `*` → `.*`, everything else literal, anchored. */
export function globToRegExp(glob: string): RegExp {
  return new RegExp('^' + glob.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
}
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x))
function detectCursor(text: string | null, readOnlyTools: string[]): Detected {
  const projectNote = 'Project .cursor/permissions.json files can add entries'
  const read = readJsonc('cursor', text)
  if (!read.ok) return { state: 'unreadable', notes: [read.reason] }
  const list = jsoncList('cursor', read.value)
  if (list === undefined) return { state: 'default', notes: ["Cursor Settings' MCP allowlist decides", projectNote] }
  const owned = new Set<string>()
  for (const e of list) {
    if (typeof e !== 'string') continue
    if (cursorOwned(e)) {
      owned.add(e.toLowerCase())
      continue
    }
    const i = e.indexOf(':')
    if (i === -1) continue
    const server = e.slice(0, i).toLowerCase()
    // A foreign glob such as *:snapshot or session*:* also covers SessionForge tools
    if (server.includes('*') && globToRegExp(server).test(SERVER)) {
      return { state: 'custom', notes: [`Another entry also matches SessionForge: ${e}`, projectNote] }
    }
  }
  if (owned.size === 0) return { state: 'ask', notes: [projectNote] }
  if (owned.has(`${SERVER}:*`)) return { state: 'all', notes: [projectNote] }
  if (sameSet(owned, new Set(readOnlyTools.map((t) => `${SERVER}:${t}`)))) return { state: 'readOnly', notes: [projectNote] }
  return { state: 'custom', notes: [projectNote] }
}
/** An ask/deny rule that covers SessionForge tools (design-verdict finding 4). */
export function claudeRuleMatches(rule: string): boolean {
  const bare = rule.replace(/\(.*\)$/, '')
  if (claudeOwned(bare)) return true
  return bare.includes('*') && globToRegExp(bare).test(`mcp__${SERVER}__snapshot`)
}
function detectClaude(text: string | null, readOnlyTools: string[]): Detected {
  const read = readJsonc('claude', text)
  if (!read.ok) return { state: 'unreadable', notes: [read.reason] }
  const perms = (read.value.permissions ?? {}) as Record<string, unknown>
  const notes: string[] = []
  if (perms.defaultMode === 'bypassPermissions') notes.push('bypassPermissions is on: Claude Code runs every tool')
  for (const k of ['deny', 'ask']) {
    const rules = (perms[k] ?? []) as unknown[]
    const hit = rules.find((r): r is string => typeof r === 'string' && claudeRuleMatches(r))
    if (hit) return { state: 'custom', notes: [`An ask/deny rule overrides this: ${hit}`, ...notes] }
  }
  const owned = new Set((jsoncList('claude', read.value) ?? []).filter(claudeOwned) as string[])
  // No allow rule: Claude Code's own default is to ask
  if (owned.size === 0) return { state: 'ask', notes: ['Claude Code asks unless another settings file allows it', ...notes] }
  if (owned.has(`mcp__${SERVER}`) || owned.has(`mcp__${SERVER}__*`)) return { state: 'all', notes }
  if (sameSet(owned, new Set(readOnlyTools.map((t) => `mcp__${SERVER}__${t}`)))) return { state: 'readOnly', notes }
  return { state: 'custom', notes }
}
function detectCodex(text: string | null): Detected {
  if (text === null) return { state: 'missing', notes: ['No config.toml yet'] }
  const parsed = parseCodex(text)
  if (!parsed.ok) return { state: 'unreadable', notes: [parsed.reason] }
  const notes: string[] = []
  if (parsed.value.approval_policy === 'never') notes.push('approval_policy = never denies tools that need approval')
  const server = codexServer(parsed.value)
  if (!server) return { state: 'missing', notes }
  const perTool = codexPerToolModes(server)
  if (perTool.length) return { state: 'custom', notes: [`Per-tool approval_mode for ${perTool.join(', ')}`, ...notes] }
  const mode = server[CODEX_KEY]
  if (mode === 'prompt') return { state: 'ask', notes }
  if (mode === 'approve') return { state: 'all', notes }
  if (mode === undefined || mode === 'auto') {
    return { state: 'readOnly', notes: ['Codex default: read-only tools run, others ask', ...notes] }
  }
  if (mode === 'writes') return { state: 'readOnly', notes: ['writes is set; Apply Read-only switches to the Codex default', ...notes] }
  return { state: 'unreadable', notes: [`Codex won't start: unknown ${CODEX_KEY}`, ...notes] }
}
export function detect(editor: EditorId, text: string | null, readOnlyTools: string[]): Detected {
  switch (editor) {
    case 'cursor':
      return detectCursor(text, readOnlyTools)
    case 'claude':
      return detectClaude(text, readOnlyTools)
    case 'codex':
      return detectCodex(text)
  }
}
