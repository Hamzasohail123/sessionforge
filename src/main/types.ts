export type EnvTag = 'local' | 'staging' | 'production' | 'custom'

export interface Session {
  id: string
  partition: string
  name: string
  color: string
  icon?: string
  env: EnvTag
  urlGuards?: string[]
  workspaceId?: string
  createdAt: number
  updatedAt: number
}

export interface Tab {
  id: string
  sessionId: string
  url: string
  title?: string
  favicon?: string
  order: number
  lastActiveAt: number
}

export type LayoutMode = 'single' | 'columns' | 'rows' | 'grid'
export type PaneId = 'pane-1' | 'pane-2' | 'pane-3' | 'pane-4'
export interface Pane {
  paneId: PaneId
  tabId: string | null
}
export interface Layout {
  windowId: string
  mode: LayoutMode
  panes: Pane[]
  activePaneId: PaneId
}
/** Sent to the renderer: each pane resolved with its session for the pane header. */
export interface LayoutState extends Omit<Layout, 'panes'> {
  panes: Array<Pane & { sessionId: string | null }>
}
/** Payload of the main → renderer 'session:imported' event. */
export interface SessionImportedEvent {
  sessionId: string
  tabId: string
  paneId: PaneId | null
  name: string
  /** 'signin': a "Sign in with Chrome" login went into an existing session */
  kind?: 'import' | 'signin'
}
export interface PaneRect {
  paneId: PaneId
  x: number
  y: number
  width: number
  height: number
}
export interface TabState {
  id: string
  sessionId: string
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}
export type ShortcutAction =
  | 'commandPalette'
  | 'reload'
  | 'hardReload'
  | 'back'
  | 'forward'
  | 'stop'
  | 'devtools'
  | 'devtoolsConsole'
  | 'devtoolsInspect'
  | 'viewSource'
  | 'newTab'
  | 'closeTab'
  | 'reopenClosed'
  | 'nextTab'
  | 'prevTab'
  | 'focusAddressBar'
  | 'focusPane1'
  | 'focusPane2'
  | 'focusPane3'
  | 'focusPane4'
  | 'openSettings'
/** Settings → General, Chrome Import and About (app:getInfo). */
export interface AppInfo {
  version: string
  userDataPath: string
  platform: string
  license: string
  importServer: { port: number; listening: boolean; error?: string }
  /** Folder to load unpacked in Chrome; null when it could not be prepared */
  extensionPath: string | null
  extensionError?: string
}
export const DOC_IDS = ['readme', 'security', 'privacy', 'license', 'chromeExtension'] as const
export type DocId = (typeof DOC_IDS)[number]
/** How the first-run tour ended (stored as onboardingTour.status) */
export const TOUR_OUTCOMES = ['completed', 'skipped'] as const
export type TourOutcome = (typeof TOUR_OUTCOMES)[number]
/** tour:getState */
export interface TourState {
  autoStart: boolean
}
/** Payload of the main → renderer 'shortcut' event. tabId/sessionId are resolved by main from the active pane after any focus change. */
export interface ShortcutEvent {
  action: ShortcutAction
  tabId: string | null
  sessionId: string | null
}

export interface CreateSessionInput {
  name: string
  color: string
  icon?: string
  env: EnvTag
  urlGuards?: string[]
}

/** No env: a session's environment can't change after it is created (it decides the agent production cap). */
export interface UpdateSessionInput {
  id: string
  name?: string
  color?: string
  icon?: string
  urlGuards?: string[]
}

/** session:close → the toast's "Reopen" targets entryId */
export interface CloseSessionResult {
  entryId: string
  name: string
}

/** closed:reopenLast / closed:reopen; null when there was nothing to reopen */
export interface ReopenResult {
  kind: 'tab' | 'session'
  sessionId: string
  sessionName: string
  /** The tab shown in the focused pane */
  tabId: string | null
}

/** A release newer than the running app; url is a vetted release page */
export interface AvailableUpdate {
  version: string
  url: string
}
/** update:getState / update:state */
export interface UpdateState {
  enabled: boolean
  currentVersion: string
  /** Newest version GitHub reported (cached), whether or not it is newer */
  latestVersion: string | null
  /** Set only when checks are on, an endpoint exists and latest is strictly newer */
  available: AvailableUpdate | null
  /** available, unless the user hid that version with "Later" */
  notice: AvailableUpdate | null
  dismissedVersion: string | null
  lastCheckedAt: number | null
  checking: boolean
}
/** update:checkNow */
export interface UpdateCheckResult {
  outcome: 'up-to-date' | 'available' | 'failed' | 'disabled'
  version?: string
  state: UpdateState
}
export interface PlaywrightStorageState {
  cookies: Array<{
    name: string
    value: string
    domain: string
    path: string
    expires: number
    httpOnly: boolean
    secure: boolean
    sameSite: 'Strict' | 'Lax' | 'None'
  }>
  origins: Array<{
    origin: string
    localStorage: Array<{ name: string; value: string }>
  }>
}
