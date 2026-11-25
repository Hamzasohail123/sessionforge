import type { AgentTab, SettingsTab } from '../../store'

export type TourStepId =
  | 'welcome'
  | 'split-view'
  | 'settings'
  | 'general'
  | 'sessions'
  | 'mcp'
  | 'mcp-connect'
  | 'shortcuts'
  | 'about'
export type TourView = { kind: 'unchanged' } | { kind: 'closed' } | { kind: 'settings'; tab: SettingsTab; agentTab?: AgentTab }
export interface TourStep {
  id: TourStepId
  title: string
  body: string
  /** A data-testid; null only for 'welcome' */
  anchor: string | null
  view: TourView
  /** Preferred card side, passed to placeTourCard */
  placement: 'right' | 'bottom'
}

/** Welcome first, then the numbered steps. The Chrome Import tab is left out on purpose. */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to SessionForge',
    body: 'A one-minute tour of split view, Settings and the MCP server.',
    anchor: null,
    view: { kind: 'unchanged' },
    placement: 'bottom'
  },
  {
    id: 'split-view',
    title: 'Split view',
    body: "Show up to four sessions side by side: one pane, two columns, two rows or a 2×2 grid. Each pane keeps its own session's logins.",
    anchor: 'layout-switcher',
    view: { kind: 'closed' },
    placement: 'bottom'
  },
  {
    id: 'settings',
    title: 'Settings',
    body: 'Everything else lives in Settings. Open it with this gear or Cmd/Ctrl+,.',
    anchor: 'open-settings',
    view: { kind: 'closed' },
    placement: 'bottom'
  },
  {
    id: 'general',
    title: 'General',
    body: 'The app version and the data folder. Sessions, cookies and the MCP token stay on this computer.',
    anchor: 'settings-nav-general',
    view: { kind: 'settings', tab: 'general' },
    placement: 'right'
  },
  {
    id: 'sessions',
    title: 'Sessions',
    body: 'Each session with its environment (local, staging, production, custom) and how much access AI agents get: Hidden, Read or Control.',
    anchor: 'settings-nav-sessions',
    view: { kind: 'settings', tab: 'sessions' },
    placement: 'right'
  },
  {
    id: 'mcp',
    title: 'MCP server',
    body: "Lets Claude Code, Cursor and Codex use the sessions you allow. It's off until you turn it on here and listens only on 127.0.0.1.",
    anchor: 'agent-enable',
    view: { kind: 'settings', tab: 'agent', agentTab: 'overview' },
    placement: 'bottom'
  },
  {
    id: 'mcp-connect',
    title: 'Connect your agent',
    body: 'Pick Claude Code, Cursor or Codex, copy the export line and the config snippet, then restart the editor from that shell. Use Access to choose Hidden, Read or Control per session.',
    anchor: 'agent-editor-picker',
    view: { kind: 'settings', tab: 'agent', agentTab: 'editors' },
    placement: 'bottom'
  },
  {
    id: 'shortcuts',
    title: 'Shortcuts',
    body: 'Keyboard shortcuts for tabs, panes and DevTools. They work inside pages too.',
    anchor: 'settings-nav-shortcuts',
    view: { kind: 'settings', tab: 'shortcuts' },
    placement: 'right'
  },
  {
    id: 'about',
    title: 'About & Privacy',
    body: 'Version, license and how your data is handled: local-first, no accounts, no telemetry. Replay this tour from Settings → General.',
    anchor: 'settings-nav-about',
    view: { kind: 'settings', tab: 'about' },
    placement: 'right'
  }
]
