import type { AgentTab, SettingsTab } from '../../store'

export type SettingsSearchEntry = {
  id: string
  kind: 'tab' | 'subtab'
  label: string
  heading: string
  subtitle: string
  category: string
  target: { tab: SettingsTab; agentTab?: AgentTab }
  keywords: readonly string[]
}

export const TOP_LEVEL_SETTINGS = {
  general: {
    id: 'general',
    kind: 'tab',
    label: 'General',
    heading: 'General',
    subtitle: 'App version, update checks and where your data lives.',
    category: 'General settings',
    target: { tab: 'general' },
    keywords: ['general', 'tour', 'updates', 'check for updates', 'new version', 'release']
  },
  sessions: {
    id: 'sessions',
    kind: 'tab',
    label: 'Sessions',
    heading: 'Sessions',
    subtitle: 'Your isolated browser sessions and the access agents have to each.',
    category: 'Sessions',
    target: { tab: 'sessions' },
    keywords: ['sessions', 'cookies']
  },
  agent: {
    id: 'agent',
    kind: 'tab',
    label: 'MCP Server',
    heading: 'MCP Server (Agent Bridge)',
    subtitle: 'Connect Cursor, Codex or Claude Code to your logged-in sessions through MCP.',
    category: 'MCP Server',
    target: { tab: 'agent', agentTab: 'overview' },
    keywords: ['MCP', 'Agent Bridge', 'Cursor', 'Codex', 'Claude Code', 'sessions']
  },
  import: {
    id: 'import',
    kind: 'tab',
    label: 'Chrome Import',
    heading: 'Chrome Import',
    subtitle: 'Bring a logged-in Chrome tab into SessionForge.',
    category: 'Chrome Import',
    target: { tab: 'import' },
    keywords: ['Chrome Import', 'cookies', 'sessions']
  },
  shortcuts: {
    id: 'shortcuts',
    kind: 'tab',
    label: 'Shortcuts',
    heading: 'Shortcuts',
    subtitle: 'Keyboard shortcuts for tabs, panes and DevTools.',
    category: 'Shortcuts',
    target: { tab: 'shortcuts' },
    keywords: ['shortcuts']
  },
  about: {
    id: 'about',
    kind: 'tab',
    label: 'About & Privacy',
    heading: 'About & Privacy',
    subtitle: 'Version, license, and how SessionForge handles your data.',
    category: 'Privacy',
    target: { tab: 'about' },
    keywords: ['privacy']
  }
} satisfies Record<SettingsTab, SettingsSearchEntry>

export const MCP_SERVER_SUBTABS = {
  overview: {
    id: 'agent-overview',
    kind: 'subtab',
    label: 'Overview',
    heading: 'MCP Server overview',
    subtitle: 'Review MCP server status and connected clients.',
    category: 'MCP Server · Overview',
    target: { tab: 'agent', agentTab: 'overview' },
    keywords: ['MCP', 'Agent Bridge', 'Cursor', 'Codex', 'Claude Code', 'status']
  },
  access: {
    id: 'agent-access',
    kind: 'subtab',
    label: 'Access',
    heading: 'MCP Server access',
    subtitle: 'Set per-session permissions for MCP clients.',
    category: 'MCP Server · Access',
    target: { tab: 'agent', agentTab: 'access' },
    keywords: ['access', 'permissions', 'approval', 'sessions']
  },
  editors: {
    id: 'agent-editors',
    kind: 'subtab',
    label: 'Editors',
    heading: 'MCP connection setup',
    subtitle: 'Connect Cursor, Codex or Claude Code to the MCP server.',
    category: 'MCP Server · Editors',
    target: { tab: 'agent', agentTab: 'editors' },
    keywords: ['MCP', 'Agent Bridge', 'Cursor', 'Codex', 'Claude Code', 'connection', 'setup']
  },
  token: {
    id: 'agent-token',
    kind: 'subtab',
    label: 'Token',
    heading: 'MCP Server token',
    subtitle: 'Manage the access token used by MCP clients.',
    category: 'MCP Server · Token',
    target: { tab: 'agent', agentTab: 'token' },
    keywords: ['token', 'access']
  },
  activity: {
    id: 'agent-activity',
    kind: 'subtab',
    label: 'Activity',
    heading: 'MCP Server activity',
    subtitle: 'Review MCP server activity and approvals.',
    category: 'MCP Server · Activity',
    target: { tab: 'agent', agentTab: 'activity' },
    keywords: ['activity', 'approval']
  }
} satisfies Record<AgentTab, SettingsSearchEntry>

export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  TOP_LEVEL_SETTINGS.general,
  TOP_LEVEL_SETTINGS.sessions,
  TOP_LEVEL_SETTINGS.agent,
  TOP_LEVEL_SETTINGS.import,
  TOP_LEVEL_SETTINGS.shortcuts,
  TOP_LEVEL_SETTINGS.about,
  MCP_SERVER_SUBTABS.overview,
  MCP_SERVER_SUBTABS.access,
  MCP_SERVER_SUBTABS.editors,
  MCP_SERVER_SUBTABS.token,
  MCP_SERVER_SUBTABS.activity
]

export function filterSettings(query: string): SettingsSearchEntry[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return [...SETTINGS_SEARCH_ENTRIES]

  return SETTINGS_SEARCH_ENTRIES.filter((entry) => {
    const searchable = [entry.label, entry.heading, entry.subtitle, entry.category, ...entry.keywords].join(' ').toLocaleLowerCase()
    return tokens.every((token) => searchable.includes(token))
  })
}
