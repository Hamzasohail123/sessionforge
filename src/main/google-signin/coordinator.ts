// GoogleSignInCoordinator: per-tab sign-in state, the pending requests and the banner broadcast.
// No Electron runtime import: it talks to WindowManager, SessionManager and the browser launcher
// through narrow ports, so its state machine is unit-tested with fakes.
import type { PaneId } from '../types'
import type {
  ImportStatusInput,
  SignInBannerState,
  SignInSessionPort,
  SignInWindowPort,
  TabNavigation,
  TabObserver
} from './types'
import { isSignInHostUrl, matchGoogleSignIn, type SignInMatch } from './match'
import { chooseCompletionTab, handOffBlocker, planHandOff, type HandOffPlan } from './plan'
import {
  PendingSignInStore,
  type PendingSignIn,
  type PendingSummary,
  type RemovedReason
} from './pending-store'
import type { LaunchResult } from './browsers'
import { isHttpUrl } from '../import-payload'

interface TabTrack {
  sessionId: string
  match: SignInMatch | null
  lastSiteUrl: string | null
  openerTabId: string | null
  dismissed: boolean
  notice: 'expired' | 'failed' | null
}

/** What ImportServer uses (import-server.ts imports this type only) */
export interface SignInImportPort {
  listForExtension(): PendingSummary[]
  takeRequest(id: string): PendingSignIn | null
  complete(req: PendingSignIn): Promise<{ tabId: string; paneId: PaneId | null }>
  failed(req: PendingSignIn): void
}

export type BroadcastWindow = {
  isDestroyed(): boolean
  webContents: { send(channel: string, payload: unknown): void; isDestroyed?(): boolean }
}

export interface CoordinatorDeps {
  windows: SignInWindowPort
  sessions: SignInSessionPort
  testOrigins: string[]
  /** openInBrowser in production */
  open: (url: string) => Promise<LaunchResult>
  importStatus: () => ImportStatusInput
  e2e: boolean
  /** Unit specs: timers off, fake clock */
  storeOptions?: { now?: () => number; ttlMs?: number; timers?: boolean }
}

export class GoogleSignInCoordinator implements TabObserver, SignInImportPort {
  readonly pending: PendingSignInStore
  private readonly tracks = new Map<string, TabTrack>()
  private readonly lastSent = new Map<string, string>()
  private window: BroadcastWindow | null = null
  /** Tab whose request is being created, so its 'replaced' notification does not flash the offer state */
  private creatingFor: string | null = null

  constructor(private readonly deps: CoordinatorDeps) {
    this.pending = new PendingSignInStore({
      timers: true,
      ...deps.storeOptions,
      onRemoved: (r, why) => this.onRemoved(r, why)
    })
  }

  init(window: BroadcastWindow): void {
    this.window = window
  }

  dispose(): void {
    this.pending.dispose()
    this.window = null
  }

  // ---------------------------------------------------------------- TabObserver

  onNavigate(e: TabNavigation): void {
    if (!this.deps.windows.getTabState(e.tabId)) return
    let track = this.tracks.get(e.tabId)
    if (!track) {
      track = {
        sessionId: e.sessionId,
        match: null,
        lastSiteUrl: null,
        openerTabId: e.openerTabId,
        dismissed: false,
        notice: null
      }
      this.tracks.set(e.tabId, track)
    }
    const opts = { testOrigins: this.deps.testOrigins }
    track.match = matchGoogleSignIn(e.url, e.chain, opts)
    if (!track.match && isHttpUrl(e.url) && !isSignInHostUrl(e.url, opts)) {
      track.lastSiteUrl = e.url
      track.dismissed = false
      track.notice = null
    }
    this.broadcast(e.tabId)
    // A popup's banner depends on its opener's URL
    for (const [id, t] of this.tracks) if (t.openerTabId === e.tabId && t.match) this.broadcast(id)
  }

  onClosed(tabId: string): void {
    this.tracks.delete(tabId)
    if (this.windowReady()) this.window!.webContents.send('signin:state', { tabId, state: null })
    this.lastSent.delete(tabId)
  }

  // ---------------------------------------------------------------- IPC

  getState(tabId: string): SignInBannerState | null {
    const track = this.tracks.get(tabId)
    if (!track || !track.match || track.dismissed) return null
    const plan = this.planFor(tabId, track, track.match)
    const req = this.pending.forTab(tabId)
    const waiting = plan.ok && !!req && req.browser !== null
    return {
      tabId,
      sessionId: track.sessionId,
      kind: track.match.kind,
      rejected: track.match.rejected,
      status: !plan.ok ? 'unavailable' : waiting ? 'waiting' : 'offer',
      targetHost: plan.ok ? plan.targetHost : null,
      browser: waiting ? req!.browser : null,
      expiresAt: waiting ? req!.expiresAt : null,
      notice: track.notice
    }
  }

  async start(tabId: string): Promise<SignInBannerState | null> {
    const track = this.tracks.get(tabId)
    if (!track || !track.match || track.dismissed) throw new Error('This tab is not on a Google sign-in page.')
    const blocker = handOffBlocker(this.deps.importStatus(), this.deps.e2e)
    if (blocker) throw new Error(blocker)
    const plan = this.planFor(tabId, track, track.match)
    if (!plan.ok) throw new Error("SessionForge can't tell which site started this sign-in.")
    if (!this.deps.sessions.getSession(track.sessionId)) throw new Error('Session not found')

    this.creatingFor = tabId
    let req: PendingSignIn
    try {
      req = this.pending.create({
        sessionId: track.sessionId,
        tabId,
        returnTabId: plan.returnTabId,
        kind: plan.kind,
        chromeUrl: plan.chromeUrl,
        returnUrl: plan.returnUrl,
        targetHost: plan.targetHost,
        cookieDomains: plan.cookieDomains,
        browser: null
      })
    } finally {
      this.creatingFor = null
    }

    let result: LaunchResult
    try {
      result = await this.deps.open(req.chromeUrl)
    } catch (e) {
      this.pending.cancel(req.id)
      const t = this.tracks.get(tabId)
      if (t) t.notice = 'failed'
      this.broadcast(tabId)
      throw e
    }
    req.browser = result.browser
    const t = this.tracks.get(tabId)
    if (t) t.notice = null
    this.broadcast(tabId)
    console.log(`[signin] request ${req.id.slice(0, 8)} for ${req.targetHost} opened in ${result.browser}`)
    return this.getState(tabId)
  }

  cancel(tabId: string): SignInBannerState | null {
    this.pending.cancelForTab(tabId)
    this.broadcast(tabId)
    return this.getState(tabId)
  }

  dismiss(tabId: string): void {
    const track = this.tracks.get(tabId)
    if (track) track.dismissed = true
    this.pending.cancelForTab(tabId)
    this.broadcast(tabId)
  }

  /** The user closed or deleted a session: its waiting requests end now, not at the next /pending. */
  onSessionRemoved(sessionId: string): void {
    for (const r of this.pending.list()) {
      if (r.sessionId !== sessionId) continue
      this.pending.cancel(r.id)
      this.broadcast(r.tabId)
    }
  }

  // ---------------------------------------------------------------- Agent Bridge

  /** On a Google sign-in page, whether or not its banner was dismissed. */
  isGoogleSignInTab(tabId: string): boolean {
    return this.tracks.get(tabId)?.match != null
  }

  // ---------------------------------------------------------------- SignInImportPort

  listForExtension(): PendingSummary[] {
    const out: PendingSummary[] = []
    for (const r of this.pending.list()) {
      const s = this.deps.sessions.getSession(r.sessionId)
      if (!s) {
        this.pending.cancel(r.id)
        this.broadcast(r.tabId)
        continue
      }
      out.push({
        id: r.id,
        sessionName: s.name,
        sessionColor: s.color,
        cookieDomains: [...r.cookieDomains],
        expiresAt: r.expiresAt
      })
    }
    return out
  }

  takeRequest(id: string): PendingSignIn | null {
    return this.pending.take(id, (sid) => !!this.deps.sessions.getSession(sid))
  }

  async complete(req: PendingSignIn): Promise<{ tabId: string; paneId: PaneId | null }> {
    const w = this.deps.windows
    const tabs = new Map<string, { sessionId: string; url: string; onSignInPage: boolean }>()
    for (const id of [req.returnTabId, req.tabId]) {
      const s = w.getTabState(id)
      if (s) tabs.set(id, { sessionId: s.sessionId, url: s.url, onSignInPage: this.tracks.get(id)?.match != null })
    }
    let target = chooseCompletionTab(req, tabs)
    const pane =
      (target ? w.getPaneOfTab(target) : null) ??
      w.getPaneOfTab(req.tabId) ??
      w.getPaneOfTab(req.returnTabId) ??
      w.getLayoutState().activePaneId

    if (target) {
      w.navigateTo(target, req.returnUrl)
      // The tab is leaving the sign-in page; its next navigation recomputes the match
      const t = this.tracks.get(target)
      if (t) t.match = null
    } else {
      target = (await w.createTab(req.sessionId, req.returnUrl, { assign: 'none' })).id
    }
    w.assignTab(pane, target)
    w.focusPane(pane)
    if (req.tabId !== target && w.getTabState(req.tabId) && this.tracks.get(req.tabId)?.match) {
      // The OAuth popup is done
      w.closeTab(req.tabId)
    }
    w.bringToFront()
    const own = this.tracks.get(req.tabId)
    if (own) own.notice = null
    this.broadcast(req.tabId)
    this.broadcast(target)
    return { tabId: target, paneId: pane }
  }

  failed(req: PendingSignIn): void {
    const track = this.tracks.get(req.tabId)
    if (track) track.notice = 'failed'
    this.broadcast(req.tabId)
  }

  // ---------------------------------------------------------------- internals

  private planFor(tabId: string, track: TabTrack, match: SignInMatch): HandOffPlan {
    const openerId = track.openerTabId
    const openerState = openerId ? this.deps.windows.getTabState(openerId) : null
    return planHandOff({
      tabId,
      match,
      lastSiteUrl: track.lastSiteUrl,
      opener:
        openerId && openerState
          ? { tabId: openerId, url: openerState.url, lastSiteUrl: this.tracks.get(openerId)?.lastSiteUrl ?? null }
          : null,
      testOrigins: this.deps.testOrigins
    })
  }

  private onRemoved(r: PendingSignIn, why: RemovedReason): void {
    if (why === 'expired') {
      const track = this.tracks.get(r.tabId)
      if (track) track.notice = 'expired'
      this.broadcast(r.tabId)
      return
    }
    // 'replaced' or 'evicted': that tab's banner goes back to the offer state
    if (r.tabId !== this.creatingFor) this.broadcast(r.tabId)
  }

  private windowReady(): boolean {
    const w = this.window
    return !!w && !w.isDestroyed() && !(w.webContents.isDestroyed?.() ?? false)
  }

  private broadcast(tabId: string): void {
    if (!this.windowReady()) return
    const state = this.getState(tabId)
    const json = JSON.stringify(state)
    if (this.lastSent.get(tabId) === json) return
    this.lastSent.set(tabId, json)
    this.window!.webContents.send('signin:state', { tabId, state })
  }
}
