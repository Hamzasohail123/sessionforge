import { create } from 'zustand'
import type { LayoutState, Session, Tab } from '../../main/types'
export const SETTINGS_TABS = ['general', 'sessions', 'agent', 'import', 'shortcuts', 'about'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]
export const AGENT_TABS = ['overview', 'access', 'editors', 'token', 'activity'] as const
export type AgentTab = (typeof AGENT_TABS)[number]
interface SettingsState {
  open: boolean
  tab: SettingsTab
  agentTab: AgentTab
}
interface AppState {
  sessions: Session[]
  tabs: Tab[]
  /** Last layout main sent; main is the only owner of layout state */
  layout: LayoutState | null
  /** Derived from the focused pane in setLayout */
  activeTabId: string | null
  activeSessionId: string | null
  /** Open dialogs/palette/covering toasts; views are hidden while > 0 */
  overlayCount: number
  /** Settings sheet; the last tab is remembered for the app session */
  settings: SettingsState
  /** A session name is being edited in the SessionBar; app shortcuts are ignored meanwhile */
  inlineEditing: boolean
  setSessions: (sessions: Session[]) => void
  setTabs: (tabs: Tab[]) => void
  setLayout: (layout: LayoutState) => void
  pushOverlay: () => void
  popOverlay: () => void
  /** No-op when Settings is already open and no tab is given */
  openSettings: (tab?: SettingsTab, agentTab?: AgentTab) => void
  closeSettings: () => void
  setSettingsTab: (tab: SettingsTab) => void
  setAgentTab: (agentTab: AgentTab) => void
  setInlineEditing: (editing: boolean) => void
}
export const useStore = create<AppState>((set) => ({
  sessions: [],
  tabs: [],
  layout: null,
  activeTabId: null,
  activeSessionId: null,
  overlayCount: 0,
  settings: { open: false, tab: 'agent', agentTab: 'overview' },
  inlineEditing: false,
  setSessions: (sessions) => set({ sessions }),
  setTabs: (tabs) => set({ tabs }),
  setLayout: (layout) => {
    const pane = layout.panes.find((p) => p.paneId === layout.activePaneId)
    set({ layout, activeTabId: pane?.tabId ?? null, activeSessionId: pane?.sessionId ?? null })
  },
  pushOverlay: () => set((s) => ({ overlayCount: s.overlayCount + 1 })),
  popOverlay: () => set((s) => ({ overlayCount: Math.max(0, s.overlayCount - 1) })),
  openSettings: (tab, agentTab) =>
    set((s) => {
      if (s.settings.open && !tab && !agentTab) return s
      return { settings: { open: true, tab: tab ?? s.settings.tab, agentTab: agentTab ?? s.settings.agentTab } }
    }),
  closeSettings: () => set((s) => ({ settings: { ...s.settings, open: false } })),
  setSettingsTab: (tab) => set((s) => ({ settings: { ...s.settings, tab } })),
  setAgentTab: (agentTab) => set((s) => ({ settings: { ...s.settings, agentTab } })),
  setInlineEditing: (inlineEditing) => set({ inlineEditing })
}))
