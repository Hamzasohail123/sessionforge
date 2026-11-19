// RecentlyClosed: closing tabs and sessions so Cmd/Ctrl+Shift+T can bring them back, newest first.
// The only writer of closed_items. A closed session keeps its sessions row, grant and partition
// (logins stay on disk); its tabs are removed and their URLs kept in its entry. The rules (caps,
// eviction, which entry reopens) are pure and live in closed-stack.ts.
import { randomUUID } from 'crypto'
import { SessionManager } from './session-manager'
import { WindowManager } from './window-manager'
import { DatabaseManager } from './database'
import { isOpenableUrl } from './import-payload'
import {
  ClosedTabSchema,
  pickReopen,
  planEviction,
  restoreIndex,
  type ClosedItem,
  type ClosedTab
} from './closed-stack'
import type { CloseSessionResult, ReopenResult } from './types'

export interface RecentlyClosedHooks {
  /** A session was closed or deleted (Agent Bridge, Google sign-in requests) */
  onSessionRemoved: (sessionId: string) => void
  /** A closed session is open again */
  onSessionReopened: (sessionId: string) => void
}

export class RecentlyClosed {
  private static instance: RecentlyClosed
  private sessions: SessionManager
  private windows: WindowManager
  private db: DatabaseManager
  private hooks: Partial<RecentlyClosedHooks> = {}

  private constructor() {
    this.sessions = SessionManager.getInstance()
    this.windows = WindowManager.getInstance()
    this.db = DatabaseManager.getInstance()
  }

  static getInstance(): RecentlyClosed {
    if (!RecentlyClosed.instance) {
      RecentlyClosed.instance = new RecentlyClosed()
    }
    return RecentlyClosed.instance
  }

  /** Set in index.ts once the Agent Bridge and the sign-in coordinator exist. */
  setHooks(hooks: RecentlyClosedHooks): void {
    this.hooks = hooks
  }

  private callHook(name: keyof RecentlyClosedHooks, sessionId: string): void {
    try {
      this.hooks[name]?.(sessionId)
    } catch (e) {
      console.warn('[closed] hook failed', name, (e as Error).message)
    }
  }

  /** The user closed a tab (x or Cmd/Ctrl+W). Script and app closes don't come through here. */
  async closeTab(tabId: string): Promise<void> {
    const state = this.windows.getTabState(tabId)
    this.windows.closeTab(tabId)
    if (!state || this.sessions.stateOf(state.sessionId) !== 'open' || !isOpenableUrl(state.url)) return
    this.db.addClosedItem({
      id: randomUUID(),
      kind: 'tab',
      sessionId: state.sessionId,
      url: state.url,
      title: state.title.slice(0, 2000),
      tabs: [],
      closedAt: Date.now()
    })
    await this.evict()
  }

  /** Hide a session and close its tabs; its logins stay on disk until it is evicted or deleted. */
  async closeSession(sessionId: string): Promise<CloseSessionResult> {
    const session = this.sessions.getSession(sessionId)
    if (!session) throw new Error('Session not found')
    const tabs: ClosedTab[] = this.windows
      .listTabs()
      .filter((t) => t.sessionId === sessionId)
      .sort((a, b) => a.order - b.order)
      .map((t) => ClosedTabSchema.safeParse({ url: t.url, title: t.title.slice(0, 2000), lastActiveAt: t.lastActiveAt }))
      .flatMap((p) => (p.success ? [p.data] : []))
    const entryId = randomUUID()
    // Recorded before the tabs close, so a crash keeps the URLs (DatabaseManager cleans up the rest)
    this.db.addClosedItem({
      id: entryId,
      kind: 'session',
      sessionId,
      url: null,
      title: null,
      tabs,
      closedAt: Date.now()
    })
    this.sessions.setClosed(sessionId, true)
    this.callHook('onSessionRemoved', sessionId)
    this.windows.closeTabsForSession(sessionId)
    await this.evict()
    return { entryId, name: session.name }
  }

  /** "Delete permanently": storage cleared; the DB cascade removes its entries and grant. Open or closed. */
  async deleteSession(sessionId: string): Promise<boolean> {
    const before = this.sessions.stateOf(sessionId)
    this.windows.closeTabsForSession(sessionId)
    // Hidden before the storage clear starts, so agents and sign-in can't use it meanwhile and the
    // hook still finds its name (SessionManager.deleteSession works on closed sessions)
    if (before !== 'missing') this.sessions.setClosed(sessionId, true)
    this.callHook('onSessionRemoved', sessionId)
    try {
      return await this.sessions.deleteSession(sessionId)
    } catch (e) {
      // Nothing was deleted: an open session stays open (without its tabs)
      if (before === 'open') this.sessions.setClosed(sessionId, false)
      throw e
    }
  }

  /** Cmd/Ctrl+Shift+T: the newest entry that can be reopened; null when there is none. */
  async reopenLast(): Promise<ReopenResult | null> {
    return this.reopenFrom(this.db.listClosedItems())
  }

  /** The toast's "Reopen": exactly that entry, if it can still be reopened. */
  async reopen(entryId: string): Promise<ReopenResult | null> {
    const item = this.db.getClosedItem(entryId)
    return item ? this.reopenFrom([item]) : null
  }

  private async reopenFrom(items: ClosedItem[]): Promise<ReopenResult | null> {
    const { item, staleIds } = pickReopen(items, (id) => this.sessions.stateOf(id))
    for (const id of staleIds) this.db.deleteClosedItem(id)
    if (!item) return null
    return item.kind === 'tab' ? this.reopenTab(item) : this.reopenSession(item)
  }

  private async reopenTab(item: ClosedItem): Promise<ReopenResult> {
    const tab = await this.windows.createTab(item.sessionId, item.url!, {
      assign: 'focused',
      title: item.title ?? undefined
    })
    this.db.deleteClosedItem(item.id)
    return {
      kind: 'tab',
      sessionId: item.sessionId,
      sessionName: this.sessions.getSession(item.sessionId)?.name ?? '',
      tabId: tab.id
    }
  }

  private async reopenSession(item: ClosedItem): Promise<ReopenResult> {
    const id = item.sessionId
    // createTab needs the session open; its entry goes only once the tabs exist again
    this.sessions.setClosed(id, false)
    this.callHook('onSessionReopened', id)
    const pane = this.windows.getLayoutState().activePaneId
    const ids: string[] = []
    try {
      for (const t of item.tabs) {
        ids.push((await this.windows.createTab(id, t.url, { assign: 'none', lazy: true, title: t.title })).id)
      }
    } catch (e) {
      await this.keepUnrestored(item, item.tabs.slice(ids.length))
      throw e
    }
    this.db.deleteClosedItem(item.id)
    let tabId: string | null
    if (ids.length === 0) {
      const state = await this.windows.openSession(pane, id)
      tabId = state.panes.find((p) => p.paneId === pane)?.tabId ?? null
    } else {
      tabId = ids[restoreIndex(item.tabs)]
      this.windows.assignTab(pane, tabId)
    }
    return { kind: 'session', sessionId: id, sessionName: this.sessions.getSession(id)?.name ?? '', tabId }
  }

  /**
   * A reopen failed partway (window gone, shutting down). The session stays open with the tabs it got,
   * and the tabs not restored become tab entries, so Cmd/Ctrl+Shift+T brings them back in tab order.
   * The session entry goes: a 'session' row would mark the open session closed again.
   */
  private async keepUnrestored(item: ClosedItem, left: ClosedTab[]): Promise<void> {
    const closedAt = Date.now()
    for (const t of [...left].reverse()) {
      this.db.addClosedItem({
        id: randomUUID(),
        kind: 'tab',
        sessionId: item.sessionId,
        url: t.url,
        title: t.title,
        tabs: [],
        closedAt
      })
    }
    this.db.deleteClosedItem(item.id)
    await this.evict()
  }

  /** Apply the caps after every push. */
  private async evict(): Promise<void> {
    const plan = planEviction(this.db.listClosedItems())
    for (const id of plan.dropIds) this.db.deleteClosedItem(id)
    // Already closed: no tabs, no agent calls, no sign-in requests, so no hooks
    for (const sessionId of plan.hardDeleteSessionIds) await this.sessions.deleteSession(sessionId)
  }
}
