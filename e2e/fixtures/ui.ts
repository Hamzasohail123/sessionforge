import type { ElectronApplication, Page } from '@playwright/test'
import type { LayoutMode, LayoutState, PaneId, Session, TabState } from '../../src/main/types'
import { waitFor, wm } from './app'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface ViewInfo {
  bounds: Box
  visible: boolean
  attached: boolean
  url: string
  title: string
}

/** Create sessions through the real bridge, then reload the UI so the SessionBar lists them. */
export async function createSessions(page: Page, names: Array<{ name: string; color: string }>): Promise<Session[]> {
  const out: Session[] = []
  for (const n of names) {
    out.push(await page.evaluate((input) => window.api.session.create({ ...input, env: 'local' }), n))
  }
  await page.reload()
  await page.waitForSelector('[data-testid="session-bar"]')
  for (const s of out) await page.waitForSelector(`[data-testid="session-${s.id}"]`)
  return out
}

export const getLayout = (page: Page): Promise<LayoutState> => page.evaluate(() => window.api.layout.get())

export const tabOf = (layout: LayoutState, paneId: PaneId): string | null =>
  layout.panes.find((p) => p.paneId === paneId)?.tabId ?? null

export const setMode = (page: Page, mode: LayoutMode) => page.click(`[data-testid="layout-${mode}"]`)

export const openSession = (page: Page, paneId: PaneId, sessionId: string): Promise<LayoutState> =>
  page.evaluate(([p, s]) => window.api.layout.openSession(p as PaneId, s), [paneId, sessionId] as const)

/** Create a tab in main without showing it in a pane. */
export const createHiddenTab = (app: ElectronApplication, sessionId: string, url: string): Promise<string> =>
  wm(
    app,
    async (sf, { sessionId, url }) => (await sf.windowManager.createTab(sessionId, url, { assign: 'none' })).id,
    { sessionId, url }
  )

export const tabState = (page: Page, tabId: string): Promise<TabState | null> =>
  page.evaluate((id) => window.api.tab.getState(id), tabId)

/** Wait until a tab finished loading a URL starting with prefix (and optionally has a title). */
export async function waitLoaded(page: Page, tabId: string, prefix: string, title?: string): Promise<TabState> {
  return waitFor(
    async () => {
      const s = await tabState(page, tabId)
      return s && s.url.startsWith(prefix) && !s.isLoading && (title === undefined || s.title === title) ? s : null
    },
    20_000,
    `tab ${tabId} to load ${prefix}${title ? ` (${title})` : ''}`
  )
}

export async function viewInfo(app: ElectronApplication, tabId: string): Promise<ViewInfo | null> {
  return wm(
    app,
    (sf, id) => {
      const v = sf.windowManager.getViewForTest(id)
      if (!v) return null
      return {
        bounds: v.getBounds(),
        visible: v.getVisible(),
        attached: sf.window.contentView.children.includes(v),
        url: v.webContents.getURL(),
        title: v.webContents.getTitle()
      }
    },
    tabId
  )
}

/** Every view attached to the window (by its own state, not its position). */
export async function attachedViews(app: ElectronApplication): Promise<Array<{ bounds: Box; visible: boolean }>> {
  return wm(app, (sf) =>
    sf.window.contentView.children
      .filter((v) => 'webContents' in v)
      .map((v) => ({ bounds: v.getBounds(), visible: v.getVisible() }))
  )
}

export async function rectOf(page: Page, testId: string): Promise<Box> {
  return page.evaluate((id) => {
    const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  }, testId)
}

export const near = (a: Box, b: Box, tol = 1) =>
  Math.abs(a.x - b.x) <= tol &&
  Math.abs(a.y - b.y) <= tol &&
  Math.abs(a.width - b.width) <= tol &&
  Math.abs(a.height - b.height) <= tol

export const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** Wait until the tab's view sits exactly on its pane slot. */
export async function waitViewOnSlot(app: ElectronApplication, page: Page, tabId: string, paneId: PaneId): Promise<Box> {
  return waitFor(
    async () => {
      const v = await viewInfo(app, tabId)
      const slot = await rectOf(page, `pane-slot-${paneId}`)
      return v && v.attached && near(v.bounds, slot) ? v.bounds : null
    },
    10_000,
    `view of ${tabId} to match pane-slot-${paneId}`
  )
}

/**
 * The app's main shortcut modifier for sendInputEvent: Cmd on macOS, Ctrl elsewhere, as in
 * src/main/shortcuts.ts. Use it wherever a spec means "Cmd/Ctrl". Ctrl+Tab is Control on every OS,
 * so tab cycling keeps 'control'.
 */
export const MOD = process.platform === 'darwin' ? 'meta' : 'control'
/** MOD as a key name for the agent's press tool (page.keyboard has its own 'ControlOrMeta') */
export const MOD_KEY = process.platform === 'darwin' ? 'Meta' : 'Control'

/** Send a key to a tab's page (keyDown + keyUp), as a user pressing it inside the page. */
export async function pressInTab(app: ElectronApplication, tabId: string, keyCode: string, modifiers: string[] = []) {
  await wm(
    app,
    async (sf, { tabId, keyCode, modifiers }) => {
      const wc = sf.windowManager.getViewForTest(tabId)!.webContents
      wc.focus()
      const mods = modifiers as Array<'control' | 'shift' | 'alt' | 'meta'>
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods })
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods })
    },
    { tabId, keyCode, modifiers }
  )
}

/**
 * Send a key to the shell (keyDown + keyUp). sendInputEvent passes through before-input-event like a
 * real key press, so main's shortcut handler sees it; Playwright's page.keyboard (CDP) does not.
 */
export async function pressInShell(app: ElectronApplication, keyCode: string, modifiers: string[] = []) {
  await wm(
    app,
    (sf, { keyCode, modifiers }) => {
      const mods = modifiers as Array<'control' | 'shift' | 'alt' | 'meta'>
      sf.window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods })
      sf.window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods })
    },
    { keyCode, modifiers }
  )
}

/**
 * Close a tab's DevTools and wait until they are closed.
 *
 * On macOS, app.evaluate runs as a V8 interrupt inside whatever main-process JS is running, including JS
 * that native code calls during the AppKit focus changes of a DevTools open. Calling closeDevTools() from
 * inside that native callback crashes the main process. So first wait until devToolsWebContents is set
 * (the last step of opening; isDevToolsOpened() can be true before it), then call closeDevTools() from
 * setTimeout, which runs it as its own main-process task, as a key press or IPC call would.
 *
 * The setTimeout is what prevents the crash, and it is required even after devToolsWebContents is set:
 * the devtools-opened and focus events still run JS from native code after that point.
 */
export async function closeTabDevTools(app: ElectronApplication, tabId: string): Promise<void> {
  await waitFor(
    () =>
      wm(
        app,
        (sf, id) => {
          const wc = sf.windowManager.getViewForTest(id)?.webContents
          return !!wc && wc.isDevToolsOpened() && wc.devToolsWebContents !== null
        },
        tabId
      ),
    5_000,
    'devtools to finish opening'
  )
  await wm(
    app,
    (sf, id) =>
      new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          try {
            sf.windowManager.getViewForTest(id)!.webContents.closeDevTools()
            resolve()
          } catch (e) {
            reject(e)
          }
        }, 0)
      }),
    tabId
  )
  await waitFor(
    () => wm(app, (sf, id) => !(sf.windowManager.getViewForTest(id)?.webContents.isDevToolsOpened() ?? false), tabId),
    5_000,
    'devtools closed'
  )
}

export const logsHaveTabNotFound = (logs: string[]) => logs.join('').includes('Tab not found')
