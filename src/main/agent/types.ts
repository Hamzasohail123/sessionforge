// Agent Bridge types shared by main, preload and the renderer. Pure: no runtime imports.

export type AgentGrant = 'hidden' | 'read' | 'control'
export const AGENT_GRANTS: readonly AgentGrant[] = ['hidden', 'read', 'control']

export type BridgeState = 'off' | 'starting' | 'listening' | 'error'

export interface AgentClientInfo {
  id: string
  name: string
  version: string
  lastSeen: number
}

export interface AgentBridgeStatus {
  enabled: boolean
  state: BridgeState
  port: number
  endpoint: string
  error?: string
  /** Last 4 characters of the token; the token itself never leaves main */
  tokenHint: string
  /** false when the OS keyring is unavailable and the token lives in memory only */
  tokenPersisted: boolean
  /** true when a stored token could not be read and a new one was created this run */
  tokenRegenerated: boolean
  clients: AgentClientInfo[]
  rejected: Record<string, number>
  bridgeScriptPath: string
}

export interface AgentSessionGrant {
  sessionId: string
  stored: AgentGrant
  effective: AgentGrant
  /** Production session with stored control that is capped to read (not confirmed this run) */
  productionCapped: boolean
  /** Production session whose control was confirmed until restart */
  elevated: boolean
}

export type ActivityOutcome = 'ok' | 'error' | 'denied'

export interface AgentActivityEntry {
  id: number
  at: number
  client: string
  tool: string
  sessionId: string | null
  sessionName: string | null
  tabId: string | null
  /** Redacted, serialised, at most 500 characters */
  args: string
  outcome: ActivityOutcome
  code?: string
  durationMs: number
}

export interface AgentPresenceEvent {
  tabId: string
  sessionId: string
  tool: string
  phase: 'start' | 'end'
  control: boolean
  at: number
}

export const SNIPPET_KINDS = [
  'cursorHttp',
  'cursorStdio',
  'codexHttp',
  'codexStdio',
  'claudeHttp',
  'claudeStdio',
  'shellExport'
] as const
export type SnippetKind = (typeof SNIPPET_KINDS)[number]

export interface Snippet {
  title: string
  location: string
  text: string
}
// ---------------------------------------------------------------- editor approval presets
export const EDITOR_IDS = ['cursor', 'codex', 'claude'] as const
export type EditorId = (typeof EDITOR_IDS)[number]
export const APPROVAL_PRESETS = ['ask', 'readOnly', 'all'] as const
export type ApprovalPreset = (typeof APPROVAL_PRESETS)[number]
export type ApprovalState = 'ask' | 'readOnly' | 'all' | 'custom' | 'default' | 'missing' | 'unreadable'
export const APPROVAL_STATE_LABELS: Record<ApprovalState, string> = {
  ask: 'Asks every time',
  readOnly: 'Auto-runs read-only tools',
  all: 'Auto-runs all SessionForge tools',
  custom: 'Custom',
  default: 'Editor default',
  missing: 'SessionForge server not configured',
  unreadable: "Can't read file"
}
export interface ApprovalPick {
  editor: EditorId
  preset: ApprovalPreset
}
export interface ApprovalApplyInput extends ApprovalPick {
  /** sha256 of the file text the preview was made from */
  expectedSha256: string
}
export interface PresetInfo {
  /** Copy-paste text (never contains a token) */
  text: string
  canApply: boolean
  reason?: string
}
export interface EditorApprovalInfo {
  editor: EditorId
  displayPath: string
  exists: boolean
  state: ApprovalState
  notes: string[]
  readOnlyTools: string[]
  presets: Record<ApprovalPreset, PresetInfo>
}
export interface DiffLine {
  kind: ' ' | '+' | '-' | '…'
  text: string
  /** 1-based line number in the before (for ' ' and '-') or after (for '+') text */
  line: number
}
export interface ApprovalPreview {
  displayPath: string
  exists: boolean
  /** Redacted line diff; there is no before/after text */
  diff: DiffLine[]
  sha256: string
  changed: boolean
  warnings: string[]
  notes: string[]
  requiresAck: boolean
  canApply: boolean
  reason?: string
}
export interface ApprovalApplyResult {
  unchanged: boolean
  displayPath: string
  /** File name of the backup, or null when no file existed or nothing changed */
  backupPath: string | null
  state: ApprovalState
}
