import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  CloseSessionResult,
  DocId,
  CreateSessionInput,
  LayoutMode,
  LayoutState,
  PaneId,
  PaneRect,
  ReopenResult,
  Session,
  SessionImportedEvent,
  ShortcutEvent,
  Tab,
  TabState,
  TourOutcome,
  TourState,
  UpdateCheckResult,
  UpdateSessionInput,
  UpdateState
} from '../main/types'
import type {
  AgentActivityEntry,
  AgentBridgeStatus,
  AgentGrant,
  AgentPresenceEvent,
  AgentSessionGrant,
  ApprovalApplyInput,
  ApprovalApplyResult,
  ApprovalPick,
  ApprovalPreview,
  EditorApprovalInfo,
  Snippet,
  SnippetKind
} from '../main/agent/types'
import type { SignInBannerState, SignInStateEvent } from '../main/google-signin/types'

function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api = {
  // Sessions
  session: {
    create: (input: CreateSessionInput): Promise<Session> => ipcRenderer.invoke('session:create', input),
    getAll: (): Promise<Session[]> => ipcRenderer.invoke('session:getAll'),
    get: (id: string): Promise<Session | undefined> => ipcRenderer.invoke('session:get', id),
    /** Name and color (the environment can't be changed); undefined for an unknown or closed session */
    update: (input: UpdateSessionInput): Promise<Session | undefined> => ipcRenderer.invoke('session:update', input),
    /** Hide it and close its tabs; logins stay so Cmd/Ctrl+Shift+T can reopen it */
    close: (id: string): Promise<CloseSessionResult> => ipcRenderer.invoke('session:close', id),
    /** Delete permanently: cookies and storage are removed */
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('session:delete', id),
    /** A Chrome-extension import created a session and opened it in a pane */
    onImported: (callback: (data: SessionImportedEvent) => void) => subscribe('session:imported', callback)
  },

  // Recently closed tabs and sessions (Cmd/Ctrl+Shift+T); null when nothing can be reopened
  closed: {
    reopenLast: (): Promise<ReopenResult | null> => ipcRenderer.invoke('closed:reopenLast'),
    reopen: (entryId: string): Promise<ReopenResult | null> => ipcRenderer.invoke('closed:reopen', entryId)
  },
  
  // Split-view layout (main owns it; the renderer renders the last LayoutState it was sent)
  layout: {
    get: (): Promise<LayoutState> => ipcRenderer.invoke('layout:get'),
    setMode: (mode: LayoutMode): Promise<LayoutState> => ipcRenderer.invoke('layout:setMode', mode),
    focusPane: (paneId: PaneId): Promise<LayoutState> => ipcRenderer.invoke('layout:focusPane', paneId),
    assignTab: (paneId: PaneId, tabId: string | null): Promise<LayoutState> =>
      ipcRenderer.invoke('layout:assignTab', paneId, tabId),
    openSession: (paneId: PaneId, sessionId: string): Promise<LayoutState> =>
      ipcRenderer.invoke('layout:openSession', paneId, sessionId),
    setPaneRects: (rects: PaneRect[]): Promise<void> => ipcRenderer.invoke('layout:setPaneRects', rects),
    onUpdate: (callback: (data: LayoutState) => void) => subscribe('layout:updated', callback)
  },

  // Tabs
  tab: {
    create: (sessionId: string, url: string): Promise<Tab> => ipcRenderer.invoke('tab:create', sessionId, url),
    getBySession: (sessionId: string): Promise<Tab[]> => ipcRenderer.invoke('tab:getBySession', sessionId),
    close: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:close', tabId),
    navigate: (tabId: string, url: string): Promise<void> => ipcRenderer.invoke('tab:navigate', tabId, url),
    goBack: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:goBack', tabId),
    goForward: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:goForward', tabId),
    reload: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:reload', tabId),
    reloadIgnoringCache: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:reloadIgnoringCache', tabId),
    stop: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:stop', tabId),
    openDevTools: (tabId: string, panel?: 'elements' | 'console'): Promise<void> =>
      ipcRenderer.invoke('tab:openDevTools', tabId, panel),
    viewSource: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:viewSource', tabId),
    setActive: (tabId: string): Promise<void> => ipcRenderer.invoke('tab:setActive', tabId),
    cycle: (direction: 1 | -1): Promise<void> => ipcRenderer.invoke('tab:cycle', direction),
    getState: (tabId: string): Promise<TabState | null> => ipcRenderer.invoke('tab:getState', tabId),
    onUpdate: (callback: (data: TabState) => void) => subscribe('tab:updated', callback),
    onTabsChanged: (callback: (data: { sessionId: string }) => void) =>
      subscribe('tabs:changed', callback)
  },

  view: {
    setOverlay: (open: boolean) => ipcRenderer.invoke('view:setOverlay', open)
  },

  // Keyboard shortcuts matched in main (page views and the shell); the payload names the target tab
  shortcut: {
    onTriggered: (callback: (data: ShortcutEvent) => void) => subscribe('shortcut', callback)
  },

  // Agent Bridge (MCP server in main). The token never crosses IPC; copy actions run in main.
  agent: {
    getStatus: (): Promise<AgentBridgeStatus> => ipcRenderer.invoke('agent:getStatus'),
    setEnabled: (enabled: boolean): Promise<AgentBridgeStatus> => ipcRenderer.invoke('agent:setEnabled', enabled),
    copyToken: (): Promise<void> => ipcRenderer.invoke('agent:copyToken'),
    copyExportLine: (): Promise<void> => ipcRenderer.invoke('agent:copyExportLine'),
    rotateToken: (): Promise<AgentBridgeStatus> => ipcRenderer.invoke('agent:rotateToken'),
    getGrants: (): Promise<AgentSessionGrant[]> => ipcRenderer.invoke('agent:getGrants'),
    setGrant: (input: { sessionId: string; level: AgentGrant; confirm?: string }): Promise<AgentSessionGrant> =>
      ipcRenderer.invoke('agent:setGrant', input),
    stop: (sessionId: string): Promise<void> => ipcRenderer.invoke('agent:stop', sessionId),
    getSnippets: (): Promise<Record<SnippetKind, Snippet>> => ipcRenderer.invoke('agent:getSnippets'),
    copySnippet: (input: { kind: SnippetKind; inlineToken: boolean }): Promise<void> =>
      ipcRenderer.invoke('agent:copySnippet', input),
    getActivity: (): Promise<AgentActivityEntry[]> => ipcRenderer.invoke('agent:getActivity'),
    clearActivity: (): Promise<void> => ipcRenderer.invoke('agent:clearActivity'),
    // Editor approval presets: only ids (and the previewed hash) cross; main picks the file and validates
    getApprovals: (): Promise<EditorApprovalInfo[]> => ipcRenderer.invoke('agent:getApprovals'),
    previewApproval: (input: ApprovalPick): Promise<ApprovalPreview> => ipcRenderer.invoke('agent:previewApproval', input),
    applyApproval: (input: ApprovalApplyInput): Promise<ApprovalApplyResult> =>
      ipcRenderer.invoke('agent:applyApproval', input),
    copyApprovalText: (input: ApprovalPick): Promise<void> => ipcRenderer.invoke('agent:copyApprovalText', input),
    onStatus: (callback: (data: AgentBridgeStatus) => void) => subscribe('agent:status', callback),
    onGrants: (callback: (data: AgentSessionGrant[]) => void) => subscribe('agent:grants', callback),
    onActivity: (callback: (data: AgentActivityEntry) => void) => subscribe('agent:activity', callback),
    onPresence: (callback: (data: AgentPresenceEvent) => void) => subscribe('agent:presence', callback)
  },

  // "Sign in with Chrome" banner: only a tab id crosses; main owns the URLs and cookie domains
  signin: {
    getState: (tabId: string): Promise<SignInBannerState | null> => ipcRenderer.invoke('signin:getState', tabId),
    start: (tabId: string): Promise<SignInBannerState | null> => ipcRenderer.invoke('signin:start', tabId),
    cancel: (tabId: string): Promise<SignInBannerState | null> => ipcRenderer.invoke('signin:cancel', tabId),
    dismiss: (tabId: string): Promise<void> => ipcRenderer.invoke('signin:dismiss', tabId),
    onState: (callback: (data: SignInStateEvent) => void) => subscribe('signin:state', callback)
  },

  // App info and docs for Settings (no arguments except a fixed doc id)
  app: {
    getInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:getInfo'),
    showUserData: (): Promise<void> => ipcRenderer.invoke('app:showUserData'),
    showExtensionFolder: (): Promise<void> => ipcRenderer.invoke('app:showExtensionFolder'),
    openDoc: (doc: DocId): Promise<void> => ipcRenderer.invoke('app:openDoc', doc),
    /** Opens the SessionForge Import Chrome Web Store page; takes no URL (main owns it) */
    openExtensionStore: (): Promise<void> => ipcRenderer.invoke('app:openExtensionStore')
  },

  // First-run tour: main decides auto-start and stores the outcome
  tour: {
    getState: (): Promise<TourState> => ipcRenderer.invoke('tour:getState'),
    finish: (outcome: TourOutcome): Promise<void> => ipcRenderer.invoke('tour:finish', outcome)
  },

  // New release notice: main checks GitHub and owns the release URL; no URL crosses IPC
  update: {
    /** Current update state (cached latest version, notice, switch) */
    getState: (): Promise<UpdateState> => ipcRenderer.invoke('update:getState'),
    /** Settings → General "Check for updates" switch */
    setEnabled: (enabled: boolean): Promise<UpdateState> => ipcRenderer.invoke('update:setEnabled', enabled),
    /** Settings → General "Check now": asks GitHub now and reports the outcome */
    checkNow: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('update:checkNow'),
    /** "Later": hide the version on offer until a newer one is out */
    dismiss: (): Promise<UpdateState> => ipcRenderer.invoke('update:dismiss'),
    /** Opens the release page in the default browser; takes no URL (main owns it) */
    openRelease: (): Promise<void> => ipcRenderer.invoke('update:openRelease'),
    /** Pushed after every change in main */
    onState: (callback: (data: UpdateState) => void) => subscribe('update:state', callback)
  },
  // Playwright
  playwright: {
    export: (sessionId: string) => ipcRenderer.invoke('playwright:export', sessionId),
    import: () => ipcRenderer.invoke('playwright:import')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
