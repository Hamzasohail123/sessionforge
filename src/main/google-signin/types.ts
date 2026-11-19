// Shared types of the "Sign in with Chrome" hand-off (types only), so WindowManager, preload and the
// renderer can import them without importing feature code.
import type { PaneId } from '../types'

export type SignInKind = 'google-account' | 'oauth'

/** One committed main-frame navigation of a tab (WindowManager → coordinator). */
export interface TabNavigation {
  tabId: string
  sessionId: string
  /** URL the tab now shows (did-navigate or main-frame did-navigate-in-page) */
  url: string
  /** Start URL plus redirect targets of the navigation that committed the current document (≤ 20) */
  chain: string[]
  openerTabId: string | null
}
export interface TabObserver {
  onNavigate(e: TabNavigation): void
  onClosed(tabId: string): void
}

export interface SignInBannerState {
  tabId: string
  sessionId: string
  kind: SignInKind
  rejected: boolean
  status: 'offer' | 'waiting' | 'unavailable'
  /** 'accounts.google.com', or the site's host for OAuth; null when unavailable */
  targetHost: string | null
  /** waiting only */
  browser: string | null
  expiresAt: number | null
  notice: 'expired' | 'failed' | null
}
export interface SignInStateEvent {
  tabId: string
  state: SignInBannerState | null
}

/** What the coordinator needs from WindowManager (WindowManager satisfies it structurally). */
export interface SignInWindowPort {
  getTabState(tabId: string): { sessionId: string; url: string } | null
  getPaneOfTab(tabId: string): PaneId | null
  getLayoutState(): { activePaneId: PaneId }
  navigateTo(tabId: string, url: string): void
  createTab(sessionId: string, url: string, opts: { assign: 'none' }): Promise<{ id: string }>
  assignTab(paneId: PaneId, tabId: string): unknown
  focusPane(paneId: PaneId): unknown
  closeTab(tabId: string): void
  bringToFront(): void
}
/** What the coordinator needs from SessionManager */
export interface SignInSessionPort {
  getSession(id: string): { id: string; name: string; color: string } | undefined
}
/** Same shape as ImportServer.status() */
export interface ImportStatusInput {
  port: number
  listening: boolean
  error?: string
}
