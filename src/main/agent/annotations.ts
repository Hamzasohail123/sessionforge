// MCP tool annotations shared by tools.ts and the editor approval presets. Pure (no electron import).
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
/** Read-only tools: editors may auto-run them under the "read-only tools" preset. */
export const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false }
/** Everything else. openWorldHint keeps Codex's default `auto` mode prompting for these. */
export const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
