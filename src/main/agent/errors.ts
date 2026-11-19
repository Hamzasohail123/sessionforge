// Tool errors (design §19). Pure.
import { wrapUntrusted } from './untrusted'

export type AgentErrorCode =
  | 'invalid_arguments'
  | 'bridge_off'
  | 'rate_limited'
  | 'busy'
  | 'unknown_session'
  | 'ambiguous_session'
  | 'permission_denied'
  | 'production_read_only'
  | 'stopped'
  | 'grant_changed'
  | 'url_guarded'
  | 'no_tab'
  | 'not_loaded'
  | 'not_visible'
  | 'ui_busy'
  | 'pane_not_in_layout'
  | 'no_pane_available'
  | 'stale_ref'
  | 'not_found'
  | 'obscured'
  | 'disabled'
  | 'not_visible_element'
  | 'not_editable'
  | 'not_a_select'
  | 'option_not_found'
  | 'invalid_key'
  | 'page_unresponsive'
  | 'page_error'
  | 'timeout'
  | 'too_large'
  | 'internal'

/**
 * message and hint hold only text SessionForge builds (codes, refs, numbers, session names, URLs the
 * agent sent). Anything read from a page goes into pageText, which is wrapped as untrusted.
 */
export class AgentError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string,
    public readonly hint?: string,
    public readonly pageText?: string
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

export interface ToolTextResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export function errorText(err: AgentError): string {
  let text = `ERROR ${err.code}: ${err.message}`
  if (err.hint) text += `\nHint: ${err.hint}`
  if (err.pageText) text += '\n' + wrapUntrusted('error details', err.pageText)
  return text
}

export function toToolResult(err: AgentError): ToolTextResult {
  return { content: [{ type: 'text', text: errorText(err) }], isError: true }
}

export const INTERNAL_ERROR = new AgentError('internal', 'Something went wrong in SessionForge; see its log.')
