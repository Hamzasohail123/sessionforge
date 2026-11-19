import { BrowserWindow, WebContentsView } from 'electron'
import type { Rectangle, WebContents, WebPreferences } from 'electron'
import { randomUUID } from 'crypto'
import { SessionManager } from './session-manager'
import { DatabaseManager } from './database'
import type {
  Layout,
  LayoutMode,
  LayoutState,
  PaneId,
  PaneRect,
  SessionImportedEvent,
  ShortcutAction,
  ShortcutEvent,
  Tab,
  TabState
} from './types'
import { attachDeveloperTools, openDevTools, toggleDevTools } from './context-menu'
import { isShellZoomKey, matchShortcut } from './shortcuts'
import * as L from './layout'
import { isHttpUrl, isOpenableUrl } from './import-payload'
import { DEFAULT_URL } from './constants'
import type { TabNavigation, TabObserver } from './google-signin/types'

/** localStorage seeding state for an imported tab (filled in by the import pipeline). */
interface SeedState {
  identifier: string | null
  origins: Set<string>
}

interface ManagedTab {
  id: string
  sessionId: string
  view: WebContentsView | null // null = known from the DB, view not built yet
  url: string
  title: string
  order: number
  lastActiveAt: number
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  seeding: SeedState | null
  /** window.open() popups: the tab that opened it */
  openerTabId: string | null
  /** Start URL plus redirect targets of the main-frame navigation in flight */
  pendingChain: string[]
  /** The same for the navigation that committed the current document */
  chain: string[]
}

export interface CreateTabOptions {
  /** 'focused' (default): show in the focused pane; 'place': next free pane (imports); 'none': no pane */
  assign?: 'focused' | 'none' | 'place'
  /** localStorage to seed before page scripts run (imports, §7.4) */
  seed?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>
  /**
   * Don't build the view yet (a reopened session's tabs, like startup restore); it is built when a
   * pane shows the tab. Only meaningful with assign 'none'.
   */
  lazy?: boolean
  /** Known title until the page reports its own (reopened tabs) */
  title?: string
}

const OPENABLE_ERROR = 'Only http(s) and view-source URLs can be opened'

export class WindowManager {
  private static instance: WindowManager
  private tabs: Map<string, ManagedTab> = new Map()
  private layout: Layout = L.defaultLayout()
  private paneRects: Map<PaneId, PaneRect> = new Map()
  private overlay = false
  private attached: Set<WebContentsView> = new Set()
  private window: BrowserWindow | null = null
  private shuttingDown = false
  private popupGuard: ((sessionId: string, openerTabId: string, url: string) => boolean) | null = null
  private tabObserver: TabObserver | null = null
  private sessionManager: SessionManager
  private db: DatabaseManager

  private constructor() {
    this.sessionManager = SessionManager.getInstance()
    this.db = DatabaseManager.getInstance()
  }

  static getInstance(): WindowManager {
    if (!WindowManager.instance) {
      WindowManager.instance = new WindowManager()
    }
    return WindowManager.instance
  }

  /** Load every saved tab (views are built lazily), restore the layout and show its panes. */
  init(window: BrowserWindow): void {
    this.window = window
    const saved = this.db.getAllTabs()
    for (const t of saved) {
      this.tabs.set(t.id, {
        id: t.id,
        sessionId: t.sessionId,
        view: null,
        url: t.url,
        title: t.title ?? '',
        order: t.order,
        lastActiveAt: t.lastActiveAt,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        seeding: null,
        openerTabId: null,
        pendingChain: [],
        chain: []
      })
    }

    const raw = this.db.getLayoutRaw('main')
    if (raw === null && saved.length > 0) {
      // Tabs but no saved layout (older DBs): show the tab the user saw last
      this.layout = L.assignTab(L.defaultLayout(), 'pane-1', L.pickMostRecent(saved)?.id ?? null)
    } else {
      this.layout = L.normalizeLayout(raw, new Set(this.tabs.keys()))
    }

    for (const pane of this.layout.panes) {
      const tab = pane.tabId ? this.tabs.get(pane.tabId) : undefined
      if (tab) this.ensureView(tab)
    }

    window.on('close', () => this.beginShutdown())
    window.webContents.once('did-finish-load', () => this.broadcastLayout())

    // Shell shortcuts: the only before-input-event listener on the shell (zoom keys blocked first)
    window.webContents.on('before-input-event', (e, input) => {
      if (isShellZoomKey(input, process.platform)) {
        e.preventDefault()
        return
      }
      const m = matchShortcut(input, process.platform, 'shell')
      if (!m) return
      if (m.preventDefault) e.preventDefault()
      this.dispatchShortcut(m.action, null)
    })
  }

  /** From here on nothing is written to the DB, so teardown cannot wipe tabs or the layout. */
  beginShutdown(): void {
    this.shuttingDown = true
  }

  // ---------------------------------------------------------------- helpers

  private send(channel: string, payload: unknown): void {
    const w = this.window
    if (!w || w.isDestroyed() || w.webContents.isDestroyed()) return
    w.webContents.send(channel, payload)
  }

  private sendTabUpdate(tabId: string): void {
    const state = this.getTabState(tabId)
    if (state) this.send('tab:updated', state)
  }

  private requireTab(id: string): ManagedTab {
    const tab = this.tabs.get(id)
    if (!tab) throw new Error('Tab not found')
    return tab
  }

  getLayoutState(): LayoutState {
    return {
      ...this.layout,
      panes: this.layout.panes.map((p) => ({
        ...p,
        sessionId: p.tabId ? (this.tabs.get(p.tabId)?.sessionId ?? null) : null
      }))
    }
  }

  private broadcastLayout(): void {
    this.send('layout:updated', this.getLayoutState())
  }

  private persistLayout(): void {
    if (this.shuttingDown) return
    try {
      this.db.saveLayout(this.layout)
    } catch (e) {
      console.error('[layout] persist failed', (e as Error).message)
    }
  }

  /** Every layout mutation: pure result → apply to views → persist → broadcast. */
  private commit(next: Layout): LayoutState {
    this.layout = next
    this.applyLayout()
    this.persistLayout()
    const state = this.getLayoutState()
    this.send('layout:updated', state)
    return state
  }

  private paneOfTab(tabId: string): PaneId | null {
    return L.paneOfTab(this.layout, tabId)
  }

  /** Tabs shown in panes other than paneId. */
  private shownElsewhere(paneId: PaneId | null): Set<string> {
    const ids = new Set<string>()
    for (const p of this.layout.panes) if (p.tabId && p.paneId !== paneId) ids.add(p.tabId)
    return ids
  }

  private sessionTabs(sessionId: string): ManagedTab[] {
    return [...this.tabs.values()].filter((t) => t.sessionId === sessionId)
  }

  // ---------------------------------------------------------------- views

  /** The only place a view is built for an existing tab. */
  private ensureView(tab: ManagedTab): WebContentsView {
    if (tab.view) return tab.view
    const view = this.buildView(tab)
    view.webContents.loadURL(tab.url).catch((e: Error & { code?: string }) => {
      if (e.code !== 'ERR_ABORTED') console.warn('[tab] loadURL failed', tab.url, e.message)
    })
    return view
  }

  /**
   * Imported tab: install the localStorage values through a CDP pre-document script, so they exist
   * before the page's own scripts run, then load url. Falls back to set-and-reload without CDP.
   */
  private async loadSeeded(tab: ManagedTab, url: string, seed: NonNullable<CreateTabOptions['seed']>): Promise<void> {
    const seedMap: Record<string, Array<[string, string]>> = {}
    for (const o of seed) {
      const entries = o.localStorage.map((e): [string, string] => [e.name, e.value])
      seedMap[o.origin] = [...(seedMap[o.origin] ?? []), ...entries]
    }
    // JSON.stringify output is a valid JS literal, so names and values cannot break out of it
    const apply = `(()=>{const s=${JSON.stringify(seedMap)}[location.origin];if(!s)return;try{for(const [k,v] of s)localStorage.setItem(k,v)}catch(e){}})()`

    // Step 0: seeding state before any navigation, so about:blank is never persisted or broadcast
    const view = this.buildView(tab)
    const seeding: SeedState = { identifier: null, origins: new Set(Object.keys(seedMap)) }
    tab.seeding = seeding
    const wc = view.webContents
    const originOf = (u: string) => {
      try {
        return new URL(u).origin
      } catch {
        return ''
      }
    }
    const load = () =>
      wc.loadURL(url).catch((e: Error & { code?: string }) => {
        if (e.code !== 'ERR_ABORTED') console.warn('[tab] loadURL failed', url, e.message)
      })

    let cdp = false
    try {
      await wc.loadURL('about:blank') // Page.enable hangs on a webContents that never navigated
      wc.debugger.attach('1.3')
      await wc.debugger.sendCommand('Page.enable')
      const { identifier } = (await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: apply
      })) as { identifier: string }
      seeding.identifier = identifier
      cdp = true
    } catch (e) {
      console.warn('[import] CDP seeding unavailable, using reload fallback', (e as Error).message)
      try {
        if (wc.debugger.isAttached()) wc.debugger.detach()
      } catch {
        // already gone
      }
    }

    let done = false
    const teardown = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      wc.removeListener('did-finish-load', onFinish)
      if (tab.seeding === seeding) tab.seeding = null
      if (!cdp || wc.isDestroyed()) return
      const detach = async () => {
        try {
          if (seeding.identifier !== null) {
            await wc.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', {
              identifier: seeding.identifier
            })
          }
        } catch (e) {
          console.warn('[import] removing the seed script failed', (e as Error).message)
        }
        try {
          if (wc.debugger.isAttached()) wc.debugger.detach()
        } catch (e) {
          console.warn('[import] debugger detach failed', (e as Error).message)
        }
      }
      void detach()
    }
    const onFinish = () => {
      if (!seeding.origins.has(originOf(wc.getURL()))) return
      if (!cdp) {
        // Fallback: the page ran once without its values; set them and reload once
        wc.executeJavaScript(apply)
          .then(() => wc.reload())
          .catch((e: Error) => console.warn('[import] seeding fallback failed', e.message))
      }
      teardown()
    }
    // The script stays installed through redirect chains until the page reaches a seeded origin
    const timer = setTimeout(teardown, 30_000)
    wc.on('did-finish-load', onFinish)
    wc.once('destroyed', teardown)

    tab.url = url
    load()
  }

  private buildView(tab: ManagedTab, guest?: WebContents, guestPrefs?: WebPreferences): WebContentsView {
    const electronSession = this.sessionManager.getElectronSession(tab.sessionId)
    if (!electronSession) throw new Error('Session not found')
    const safe = { sandbox: true, contextIsolation: true, nodeIntegration: false }
    const view = guest
      ? new WebContentsView({ webContents: guest, webPreferences: { ...guestPrefs, ...safe } })
      : new WebContentsView({ webPreferences: { session: electronSession, ...safe } })
    view.setBackgroundColor('#ffffff')
    tab.view = view
    tab.isLoading = true
    this.wireView(tab, view.webContents)
    return view
  }

  private wireView(tab: ManagedTab, wc: WebContents): void {
    const id = tab.id
    const refreshHistory = () => {
      tab.canGoBack = wc.navigationHistory.canGoBack()
      tab.canGoForward = wc.navigationHistory.canGoForward()
    }

    // Chrome-like right-click menu; its "new tab" items open in this tab's pane
    attachDeveloperTools(wc, { openInNewTab: (url) => this.openInNewTab(id, url) })

    // Keys pressed inside the page never reach the shell: the one shortcut handler for this view
    wc.on('before-input-event', (e, input) => {
      const m = matchShortcut(input, process.platform, 'page')
      if (!m) return
      if (m.action === 'stop' && !this.tabs.get(id)?.isLoading) return // not a shortcut now: the page gets Esc
      if (m.preventDefault) e.preventDefault()
      this.dispatchShortcut(m.action, id)
    })

    // Popups stay in the opener's session (window.opener keeps working)
    wc.setWindowOpenHandler((details) => {
      if (this.popupGuard?.(tab.sessionId, id, details.url)) return { action: 'deny' }
      if (this.shuttingDown || !(isHttpUrl(details.url) || details.url === 'about:blank')) {
        return { action: 'deny' }
      }
      return {
        action: 'allow',
        outlivesOpener: true,
        createWindow: (options) => {
          const guest = (options as Electron.BrowserWindowConstructorOptions & { webContents?: WebContents })
            .webContents
          return this.adoptPopup(tab.sessionId, id, guest, options.webPreferences, details.url).webContents
        }
      }
    })

    // Navigation chain for the Google sign-in matcher: start URL plus redirect targets. It becomes
    // the tab's chain only when the navigation commits, so aborted navigations never leak into it.
    wc.on('did-start-navigation', (d) => {
      if (d.isMainFrame && !d.isSameDocument) tab.pendingChain = [d.url]
    })
    wc.on('did-redirect-navigation', (d) => {
      if (d.isMainFrame && tab.pendingChain.length < 20) tab.pendingChain.push(d.url)
    })

    wc.on('did-start-loading', () => {
      tab.isLoading = true
      this.sendTabUpdate(id)
    })
    wc.on('did-stop-loading', () => {
      tab.isLoading = false
      refreshHistory()
      this.sendTabUpdate(id)
    })

    const onNavigate = (eventUrl: string) => {
      refreshHistory()
      // did-navigate reports a view-source tab's inner URL; keep the view-source: one the tab shows
      const newUrl = wc.getURL().startsWith('view-source:') ? wc.getURL() : eventUrl
      if (tab.seeding && newUrl === 'about:blank') return
      tab.url = newUrl
      // Navigation does not make a tab "most recent"; only being shown does (assignTab)
      if (!this.shuttingDown && this.tabs.has(id)) this.db.updateTab(id, { url: newUrl })
      this.sendTabUpdate(id)
      // In-page navigations keep the chain of the last full navigation
      this.notifyObserver({ tabId: id, sessionId: tab.sessionId, url: newUrl, chain: [...tab.chain], openerTabId: tab.openerTabId })
    }
    wc.on('did-navigate', (_e, url) => {
      tab.chain = tab.pendingChain.length ? tab.pendingChain : [url]
      tab.pendingChain = []
      onNavigate(url)
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) onNavigate(url)
    })

    wc.on('page-title-updated', (_e, title) => {
      tab.title = title
      if (!this.shuttingDown && this.tabs.has(id)) this.db.updateTab(id, { title })
      this.sendTabUpdate(id)
    })

    wc.on('did-fail-load', (_e, errorCode, desc, validatedURL, isMainFrame) => {
      // -3 = ERR_ABORTED (stopped, or replaced by a new navigation)
      if (!isMainFrame || errorCode === -3) return
      console.warn('[tab] load failed', errorCode, desc, validatedURL)
      tab.isLoading = false
      this.sendTabUpdate(id)
    })

    // Clicking inside a page focuses its pane
    wc.on('focus', () => {
      const pane = this.paneOfTab(id)
      if (pane && pane !== this.layout.activePaneId && !this.shuttingDown) {
        this.commit(L.focusPane(this.layout, pane))
      }
    })

    // window.close() from the page (OAuth popups), or app teardown
    wc.on('destroyed', () => this.forgetTab(id))
  }

  /** Attach the views of the panes that have a measured rect; detach the rest. */
  private applyLayout(): void {
    const win = this.window
    if (!win || win.isDestroyed() || this.shuttingDown) return
    const zoom = win.webContents.getZoomFactor()
    const content = win.getContentBounds()
    const wanted = new Map<WebContentsView, Rectangle>()

    for (const pane of this.layout.panes) {
      if (!pane.tabId) continue
      const rect = this.paneRects.get(pane.paneId)
      if (!rect || rect.width < 1 || rect.height < 1) continue
      const tab = this.tabs.get(pane.tabId)
      if (!tab) continue
      const view = this.ensureView(tab)
      const x = Math.min(Math.round(rect.x * zoom), content.width)
      const y = Math.min(Math.round(rect.y * zoom), content.height)
      wanted.set(view, {
        x,
        y,
        width: Math.max(0, Math.min(Math.round(rect.width * zoom), content.width - x)),
        height: Math.max(0, Math.min(Math.round(rect.height * zoom), content.height - y))
      })
    }

    for (const view of [...this.attached]) {
      if (!wanted.has(view)) this.detach(view)
    }
    for (const [view, bounds] of wanted) {
      if (!this.attached.has(view)) {
        win.contentView.addChildView(view)
        this.attached.add(view)
      }
      view.setBounds(bounds)
      view.setVisible(!this.overlay)
    }
  }

  private detach(view: WebContentsView): void {
    if (!this.attached.delete(view)) return
    const win = this.window
    if (win && !win.isDestroyed()) {
      try {
        win.contentView.removeChildView(view)
      } catch (e) {
        console.warn('[layout] removeChildView failed', (e as Error).message)
      }
    }
  }

  // ---------------------------------------------------------------- layout operations

  setMode(mode: LayoutMode): LayoutState {
    return this.commit(L.setMode(this.layout, mode))
  }

  focusPane(paneId: PaneId): LayoutState {
    const state = this.commit(L.focusPane(this.layout, paneId))
    const tabId = this.layout.panes.find((p) => p.paneId === paneId)?.tabId
    const view = tabId ? this.tabs.get(tabId)?.view : null
    if (view && !view.webContents.isDestroyed()) view.webContents.focus()
    return state
  }

  assignTab(paneId: PaneId, tabId: string | null): LayoutState {
    const tab = tabId ? this.requireTab(tabId) : null
    const next = L.assignTab(this.layout, paneId, tabId)
    if (tab) this.markShown(tab)
    return this.commit(next)
  }

  private markShown(tab: ManagedTab): void {
    tab.lastActiveAt = Date.now()
    if (!this.shuttingDown) this.db.updateTab(tab.id, { lastActiveAt: tab.lastActiveAt })
  }

  /** Show a session in a pane: its tab already there, else its most recent free tab, else a new tab. */
  async openSession(paneId: PaneId, sessionId: string): Promise<LayoutState> {
    if (!this.sessionManager.getSession(sessionId)) throw new Error('Session not found')
    const current = L.focusPane(this.layout, paneId).panes.find((p) => p.paneId === paneId)?.tabId
    if (current && this.tabs.get(current)?.sessionId === sessionId) {
      return this.commit(L.focusPane(this.layout, paneId))
    }
    const pick = L.pickMostRecent(this.sessionTabs(sessionId), this.shownElsewhere(paneId))
    const tabId = pick ? pick.id : (await this.createTab(sessionId, DEFAULT_URL, { assign: 'none' })).id
    return this.assignTab(paneId, tabId)
  }

  setPaneRects(rects: PaneRect[]): void {
    this.paneRects = new Map(rects.map((r) => [r.paneId, r]))
    this.applyLayout()
  }

  /** Hide web views while a dialog or the command palette is open (views draw above the UI). */
  setOverlay(open: boolean): void {
    this.overlay = open
    for (const view of this.attached) view.setVisible(!open)
    if (open && this.window && !this.window.isDestroyed()) this.window.webContents.focus()
  }

  /**
   * A shortcut matched in a page (sourceTabId) or the shell (null). Main resolves the target tab from
   * its own layout after any focus change; the renderer decides what the action does.
   */
  private dispatchShortcut(action: ShortcutAction, sourceTabId: string | null): void {
    if (this.shuttingDown) return
    const win = this.window
    if (!win || win.isDestroyed()) return

    // 1. A key pressed in a pane that is not active acts on that pane
    const sourcePane = sourceTabId ? this.paneOfTab(sourceTabId) : null
    if (sourcePane && sourcePane !== this.layout.activePaneId) this.commit(L.focusPane(this.layout, sourcePane))

    // 2. The renderer needs keyboard focus to open the palette or focus its input
    if (action === 'commandPalette' || action === 'focusAddressBar' || action === 'openSettings') win.webContents.focus()

    // 3. Pane focus is done here; a pane beyond the current mode is ignored
    const paneNumber = /^focusPane([1-4])$/.exec(action)?.[1]
    if (paneNumber) {
      try {
        this.focusPane(`pane-${paneNumber}` as PaneId)
      } catch {
        // pane not in the current layout: no change
      }
    }

    // 4. Target from main's state after step 1
    const pane = this.layout.panes.find((p) => p.paneId === this.layout.activePaneId)
    const tabId = pane?.tabId ?? null
    const sessionId = tabId ? (this.tabs.get(tabId)?.sessionId ?? null) : null
    this.send('shortcut', { action, tabId, sessionId } satisfies ShortcutEvent)
  }

  // ---------------------------------------------------------------- tab operations

  getTabState(tabId: string): TabState | null {
    const tab = this.tabs.get(tabId)
    if (!tab) return null
    return {
      id: tab.id,
      sessionId: tab.sessionId,
      url: tab.url,
      title: tab.title,
      isLoading: tab.view ? tab.isLoading : false,
      canGoBack: tab.view ? tab.canGoBack : false,
      canGoForward: tab.view ? tab.canGoForward : false
    }
  }

  async createTab(sessionId: string, url: string, opts: CreateTabOptions = {}): Promise<Tab> {
    if (!this.sessionManager.getSession(sessionId)) throw new Error('Session not found')
    if (!isOpenableUrl(url)) throw new Error(OPENABLE_ERROR)
    if (!this.window || this.window.isDestroyed()) throw new Error('Window not ready')
    if (this.shuttingDown) throw new Error('Shutting down')

    const tab: Tab = {
      id: randomUUID(),
      sessionId,
      url,
      title: opts.title,
      order: this.db.getNextTabOrder(sessionId),
      lastActiveAt: Date.now()
    }
    this.db.createTab(tab)
    const managed: ManagedTab = {
      id: tab.id,
      sessionId,
      view: null,
      url,
      title: opts.title ?? '',
      order: tab.order,
      lastActiveAt: tab.lastActiveAt,
      isLoading: !opts.lazy,
      canGoBack: false,
      canGoForward: false,
      seeding: null,
      openerTabId: null,
      pendingChain: [],
      chain: []
    }
    this.tabs.set(tab.id, managed)
    const seed = (opts.seed ?? []).filter((o) => o.localStorage.length > 0)
    if (seed.length > 0) await this.loadSeeded(managed, url, seed)
    else if (!opts.lazy) this.ensureView(managed)

    const assign = opts.assign ?? 'focused'
    if (assign === 'focused') {
      this.assignTab(this.layout.activePaneId, tab.id)
    } else if (assign === 'place') {
      this.markShown(managed)
      this.commit(L.placeTab(this.layout, tab.id))
    }
    this.send('tabs:changed', { sessionId })
    return { ...tab, lastActiveAt: managed.lastActiveAt }
  }

  setActiveTab(tabId: string): void {
    this.requireTab(tabId)
    this.assignTab(this.layout.activePaneId, tabId)
  }

  getTabsBySession(sessionId: string): Tab[] {
    return this.db.getTabsBySession(sessionId)
  }

  /** Close a tab; panes showing it get the session's most recent free tab. Unknown ids are a no-op. */
  closeTab(id: string): void {
    this.removeTabInternal(id, { closeContents: true, notify: true })
  }

  private removeTabInternal(
    id: string,
    opts: { closeContents: boolean; notify: boolean; pick?: (paneId: PaneId) => string | null }
  ): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    // Delete first so the view's own 'destroyed' event is a no-op
    this.tabs.delete(id)

    const pick =
      opts.pick ??
      ((paneId: PaneId) =>
        L.pickMostRecent(this.sessionTabs(tab.sessionId), this.shownElsewhere(paneId))?.id ?? null)
    const before = this.layout
    const next = L.removeTab(before, id, pick)
    next.panes.forEach((p, i) => {
      if (p.tabId && p.tabId !== before.panes[i]?.tabId) {
        const t = this.tabs.get(p.tabId)
        if (t) this.markShown(t)
      }
    })

    if (tab.view) {
      this.detach(tab.view)
      if (opts.closeContents && !tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    }
    if (!this.shuttingDown) this.db.deleteTab(id)
    this.commit(next)
    if (opts.notify) this.send('tabs:changed', { sessionId: tab.sessionId })
    try {
      this.tabObserver?.onClosed(id)
    } catch (e) {
      console.warn('[signin] observer failed', (e as Error).message)
    }
  }

  /** The page's webContents went away by itself (window.close(), or app teardown). */
  private forgetTab(id: string): void {
    if (this.shuttingDown || !this.tabs.has(id)) return
    this.removeTabInternal(id, { closeContents: false, notify: true })
  }

  /** Next/previous tab of the focused pane's session that no other pane shows. */
  cycleTab(direction: 1 | -1): void {
    const paneId = this.layout.activePaneId
    const currentId = this.layout.panes.find((p) => p.paneId === paneId)?.tabId
    const current = currentId ? this.tabs.get(currentId) : undefined
    if (!current) return
    const elsewhere = this.shownElsewhere(paneId)
    const list = this.sessionTabs(current.sessionId)
      .filter((t) => !elsewhere.has(t.id))
      .sort((a, b) => a.order - b.order)
    const i = list.findIndex((t) => t.id === current.id)
    const next = list[(i + direction + list.length) % list.length]
    if (next && next.id !== current.id) this.assignTab(paneId, next.id)
  }

  /** Before a session is deleted: empty its panes, then close its tabs without refilling. */
  closeTabsForSession(sessionId: string): void {
    const sessionOf = (tabId: string | null) => (tabId ? this.tabs.get(tabId)?.sessionId : undefined)
    this.commit({
      ...this.layout,
      panes: this.layout.panes.map((p) => (sessionOf(p.tabId) === sessionId ? { ...p, tabId: null } : p))
    })
    for (const tab of this.sessionTabs(sessionId)) {
      this.removeTabInternal(tab.id, { closeContents: true, notify: false, pick: () => null })
    }
    this.send('tabs:changed', { sessionId })
  }

  private liveContents(tabId: string): WebContents {
    return this.ensureView(this.requireTab(tabId)).webContents
  }

  navigateTo(tabId: string, url: string): void {
    if (!isOpenableUrl(url)) throw new Error(OPENABLE_ERROR)
    const tab = this.requireTab(tabId)
    const wc = this.ensureView(tab).webContents
    tab.url = url
    wc.loadURL(url).catch((e: Error & { code?: string }) => {
      if (e.code !== 'ERR_ABORTED') console.warn('[tab] loadURL failed', url, e.message)
    })
  }

  goBack(tabId: string): void {
    const history = this.liveContents(tabId).navigationHistory
    if (history.canGoBack()) history.goBack()
  }

  goForward(tabId: string): void {
    const history = this.liveContents(tabId).navigationHistory
    if (history.canGoForward()) history.goForward()
  }

  reload(tabId: string): void {
    this.liveContents(tabId).reload()
  }

  reloadIgnoringCache(tabId: string): void {
    this.liveContents(tabId).reloadIgnoringCache()
  }

  stop(tabId: string): void {
    // A tab without a live view is not loading anything
    this.requireTab(tabId).view?.webContents.stop()
  }

  /** No panel: toggle (F12, Ctrl+Shift+I, toolbar). With a panel: open and select it, never close. */
  openDevTools(tabId: string, panel?: 'elements' | 'console'): void {
    const wc = this.liveContents(tabId)
    if (panel) openDevTools(wc, panel)
    else toggleDevTools(wc)
  }

  async viewSource(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId)
    const url = tab.url
    if (url.startsWith('view-source:')) return
    if (!isHttpUrl(url)) throw new Error('View source is only available for http(s) pages')
    await this.createTab(tab.sessionId, `view-source:${url}`, { assign: 'focused' })
  }

  /** Context-menu "new tab" items: open in the pane of the tab that was right-clicked. */
  private openInNewTab(openerTabId: string, url: string): void {
    const sessionId = this.tabs.get(openerTabId)?.sessionId
    if (!sessionId || this.shuttingDown) return
    this.createTab(sessionId, url, { assign: 'none' })
      .then((tab) => this.assignTab(this.paneOfTab(openerTabId) ?? this.layout.activePaneId, tab.id))
      .catch((e: Error) => console.error('[tab] open in new tab failed', e.message))
  }

  /** A window.open() popup: same session as the opener, shown in the opener's pane. */
  private adoptPopup(
    sessionId: string,
    openerTabId: string,
    guest: WebContents | undefined,
    prefs: WebPreferences | undefined,
    url: string
  ): WebContentsView {
    const tab: ManagedTab = {
      id: randomUUID(),
      sessionId,
      view: null,
      url,
      title: '',
      order: this.db.getNextTabOrder(sessionId),
      lastActiveAt: Date.now(),
      isLoading: true,
      canGoBack: false,
      canGoForward: false,
      seeding: null,
      openerTabId,
      // The popup's first URL is in the chain even if its start event fired before wiring
      pendingChain: isHttpUrl(url) ? [url] : [],
      chain: []
    }
    const view = this.buildView(tab, guest, prefs)
    this.tabs.set(tab.id, tab)
    this.db.createTab({ id: tab.id, sessionId, url, order: tab.order, lastActiveAt: tab.lastActiveAt })
    this.assignTab(this.paneOfTab(openerTabId) ?? this.layout.activePaneId, tab.id)
    this.send('tabs:changed', { sessionId })
    return view
  }

  /** After an import. On Linux/GNOME focus() may only flash the taskbar entry (focus-stealing prevention). */
  bringToFront(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  /** Tell the renderer an import finished (it refreshes its lists and shows a toast). */
  notifyImported(evt: SessionImportedEvent): void {
    this.send('session:imported', evt)
  }

  // ---- Agent Bridge accessors (read-mostly)

  /** Agent popup guard: true → the window.open() is denied before a tab exists. */
  setPopupGuard(fn: (sessionId: string, openerTabId: string, url: string) => boolean): void {
    this.popupGuard = fn
  }

  /** Google sign-in detection: told about every committed main-frame navigation and closed tab. */
  setTabObserver(o: TabObserver | null): void {
    this.tabObserver = o
  }

  /** A bug in the observer must not break navigation bookkeeping; removed tabs are not reported. */
  private notifyObserver(e: TabNavigation): void {
    if (!this.tabObserver || this.shuttingDown || !this.tabs.has(e.tabId)) return
    try {
      this.tabObserver.onNavigate(e)
    } catch (err) {
      console.warn('[signin] observer failed', (err as Error).message)
    }
  }

  getPaneOfTab(tabId: string): PaneId | null {
    return this.paneOfTab(tabId)
  }

  listTabs(): Array<{
    id: string
    sessionId: string
    url: string
    title: string
    paneId: PaneId | null
    isLoading: boolean
    lastActiveAt: number
    order: number
  }> {
    return [...this.tabs.values()].map((t) => ({
      id: t.id,
      sessionId: t.sessionId,
      url: t.url,
      title: t.title,
      paneId: this.paneOfTab(t.id),
      isLoading: t.view ? t.isLoading : false,
      lastActiveAt: t.lastActiveAt,
      order: t.order
    }))
  }

  /** The tab's webContents when its view exists; never builds a view. */
  getLiveWebContents(tabId: string): WebContents | null {
    const wc = this.tabs.get(tabId)?.view?.webContents
    return wc && !wc.isDestroyed() ? wc : null
  }

  /** Builds the view when needed (control tools only). */
  getOrCreateWebContents(tabId: string): WebContents {
    return this.liveContents(tabId)
  }

  tabIdForWebContents(wcId: number): string | null {
    for (const t of this.tabs.values()) {
      if (t.view && !t.view.webContents.isDestroyed() && t.view.webContents.id === wcId) return t.id
    }
    return null
  }

  /** In a pane with a non-empty rect and attached, window shown and not minimized, no overlay. */
  isTabInteractive(tabId: string): boolean {
    const win = this.window
    if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized() || this.overlay) return false
    return this.isTabAttached(tabId)
  }

  /** The tab's view is attached to the window with non-empty bounds. */
  isTabAttached(tabId: string): boolean {
    const view = this.tabs.get(tabId)?.view
    if (!view || !this.attached.has(view) || !this.paneOfTab(tabId)) return false
    const b = view.getBounds()
    return b.width > 0 && b.height > 0
  }

  /** The session's most recently shown tab that no pane shows. */
  pickReusableTab(sessionId: string): string | null {
    return L.pickMostRecent(this.sessionTabs(sessionId), this.shownElsewhere(null))?.id ?? null
  }

  isOverlayOpen(): boolean {
    return this.overlay
  }

  getAttachedPaneViews(): Array<{ paneId: PaneId; tabId: string; sessionId: string; bounds: Rectangle }> {
    const out: Array<{ paneId: PaneId; tabId: string; sessionId: string; bounds: Rectangle }> = []
    for (const p of this.layout.panes) {
      const tab = p.tabId ? this.tabs.get(p.tabId) : undefined
      if (!tab?.view || !this.attached.has(tab.view)) continue
      out.push({ paneId: p.paneId, tabId: tab.id, sessionId: tab.sessionId, bounds: tab.view.getBounds() })
    }
    return out
  }

  /** E2E only: the live view of a tab, selected by id (never by contentView position). */
  getViewForTest(tabId: string): WebContentsView | null {
    if (process.env.SESSIONFORGE_E2E !== '1') throw new Error('getViewForTest is only available in e2e runs')
    return this.tabs.get(tabId)?.view ?? null
  }
}
