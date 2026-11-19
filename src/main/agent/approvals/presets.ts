// Owned-entry rules, preset targets and copy-paste text per editor (design §2.3, §2.4). Pure.
import type { ApprovalPreset, EditorId } from '../types'
export const SERVER = 'sessionforge'
/** Cursor: a string whose server part (before the first ':') is sessionforge, any case. */
export function cursorOwned(entry: unknown): boolean {
  if (typeof entry !== 'string') return false
  const i = entry.indexOf(':')
  return i !== -1 && entry.slice(0, i).toLowerCase() === SERVER
}
const CLAUDE_OWNED = /^mcp__sessionforge(__.*)?$/
/** Claude Code: mcp__sessionforge (whole server) or mcp__sessionforge__<anything>. */
export function claudeOwned(entry: unknown): boolean {
  return typeof entry === 'string' && CLAUDE_OWNED.test(entry)
}
export const CODEX_KEY = 'default_tools_approval_mode'
/** The owned entries a JSONC preset leaves in the list. */
export function jsoncTarget(editor: 'cursor' | 'claude', preset: ApprovalPreset, readOnlyTools: string[]): string[] {
  const prefix = editor === 'cursor' ? `${SERVER}:` : `mcp__${SERVER}__`
  if (preset === 'ask') return []
  if (preset === 'all') return [`${prefix}*`]
  return readOnlyTools.map((t) => prefix + t)
}
/** Codex: the value of default_tools_approval_mode after the preset (undefined = key absent). */
export function codexTarget(preset: ApprovalPreset): string | undefined {
  return preset === 'ask' ? 'prompt' : preset === 'all' ? 'approve' : undefined
}
function list(entries: string[]): string[] {
  return entries.map((e, i) => JSON.stringify(e) + (i < entries.length - 1 ? ',' : ''))
}
/**
 * Text for the Copy button. It never holds a table header or a whole JSON object, so pasting it into
 * an existing file cannot create a duplicate table or key, and it never holds a token.
 */
export function presetText(editor: EditorId, preset: ApprovalPreset, readOnlyTools: string[], path: string): string {
  switch (editor) {
    case 'cursor':
      if (preset === 'ask') return `// In ${path}, remove every "mcpAllowlist" entry that starts with sessionforge:`
      return [`// Add to "mcpAllowlist" in ${path}`, ...list(jsoncTarget('cursor', preset, readOnlyTools))].join('\n')
    case 'claude':
      if (preset === 'ask') return `// In ${path}, remove every "permissions"."allow" entry that starts with mcp__sessionforge`
      return [`// Add to "permissions"."allow" in ${path}`, ...list(jsoncTarget('claude', preset, readOnlyTools))].join('\n')
    case 'codex':
      if (preset === 'readOnly') {
        return `# Remove ${CODEX_KEY} from [mcp_servers.sessionforge] (Codex default: read-only tools run, others ask)`
      }
      return `# Under your existing [mcp_servers.sessionforge] table\n${CODEX_KEY} = "${codexTarget(preset)}"`
  }
}
