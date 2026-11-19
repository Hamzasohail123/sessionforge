import { test, expect } from '@playwright/test'
import { launchApp, relaunch, tabEval, teardown, waitFor, wm, type AppCtx } from './fixtures/app'
import { capture, colorMatches, sampleTab } from './fixtures/capture'
import { LABEL_COLORS, startTestServer, type TestServer } from './fixtures/test-server'
import {
  createHiddenTab,
  createSessions,
  getLayout,
  logsHaveTabNotFound,
  setMode,
  tabOf,
  waitLoaded,
  waitViewOnSlot
} from './fixtures/ui'
import type { Session } from '../src/main/types'

test.describe.configure({ mode: 'serial' })

interface SfRead {
  cookie: string
  local: string | null
  session: string | null
  idb: string | null
}

let ctx: AppCtx
let server: TestServer
let A: Session
let B: Session
let A1: string
let A2: string
let B1: string

const read = (tabId: string) => tabEval<SfRead>(ctx.app, tabId, 'sfRead()')
const assign = (paneId: 'pane-1' | 'pane-2', tabId: string | null) =>
  ctx.page.evaluate(([p, t]) => window.api.layout.assignTab(p, t), [paneId, tabId] as const)

test.beforeAll(async () => {
  server = await startTestServer()
  ctx = await launchApp()
  ;[A, B] = await createSessions(ctx.page, [
    { name: 'Session A', color: '#ef4444' },
    { name: 'Session B', color: '#3b82f6' }
  ])
  // A1 is the /opener page (a /page plus openPopup); A2 is created first so A1 is the more recent one shown
  A2 = await createHiddenTab(ctx.app, A.id, `${server.base}/page?label=D`)
  A1 = await createHiddenTab(ctx.app, A.id, `${server.base}/opener?label=A`)
  B1 = await createHiddenTab(ctx.app, B.id, `${server.base}/page?label=B`)
  await setMode(ctx.page, 'columns')
  await assign('pane-1', A1)
  await assign('pane-2', B1)
  await waitLoaded(ctx.page, A1, `${server.base}/opener`, 'Page A')
  await waitLoaded(ctx.page, A2, `${server.base}/page`, 'Page D')
  await waitLoaded(ctx.page, B1, `${server.base}/page`, 'Page B')
})

test.afterAll(async () => {
  await teardown(ctx)
  await server?.close()
})

test('storage is shared inside a session, sessionStorage per tab, and the other session sees nothing', async () => {
  await tabEval(ctx.app, A1, 'sfWrite("a")')
  expect(await read(A1)).toEqual({ cookie: 'sf=a', local: 'a', session: 'a', idb: 'a' })

  const a2 = await read(A2)
  expect(a2.cookie).toContain('sf=a')
  expect(a2.local).toBe('a')
  expect(a2.idb).toBe('a')
  expect(a2.session).toBeNull()

  const b1 = await read(B1)
  expect(b1.cookie).not.toContain('sf=')
  expect(b1.local).toBeNull()
  expect(b1.session).toBeNull()
  expect(b1.idb).toBeNull()

  await waitViewOnSlot(ctx.app, ctx.page, A1, 'pane-1')
  await waitViewOnSlot(ctx.app, ctx.page, B1, 'pane-2')
  expect(colorMatches(await sampleTab(ctx.app, A1), LABEL_COLORS.A)).toBe(true)
  expect(colorMatches(await sampleTab(ctx.app, B1), LABEL_COLORS.B)).toBe(true)
  await capture(ctx.app, 'isolation-side-by-side')
})

test('a popup opens in the opener session and pane, then closes back to the opener', async () => {
  await tabEval(ctx.app, A1, 'openPopup(), true')
  const popupId = await waitFor(
    async () => {
      const id = tabOf(await getLayout(ctx.page), 'pane-1')
      return id && id !== A1 ? id : null
    },
    10_000,
    'popup tab in pane-1'
  )
  expect(tabOf(await getLayout(ctx.page), 'pane-2')).toBe(B1)
  expect(await wm(ctx.app, (sf, id) => sf.db.getTabById(id)?.sessionId ?? null, popupId)).toBe(A.id)
  await waitLoaded(ctx.page, popupId, `${server.base}/page?label=C&popup=1`, 'Page C')

  const popup = await read(popupId)
  expect(popup.cookie).toContain('sf=a')
  expect(popup.local).toBe('a')
  expect(await tabEval(ctx.app, popupId, '!!window.opener')).toBe(true)
  // The suite runs with --no-sandbox, so pin the per-view flags for a normal tab and the popup
  for (const id of [A1, popupId]) {
    const prefs = await wm(
      ctx.app,
      (sf, tabId) => {
        // Still on WebContents at runtime, but no longer in Electron's public typings
        const wc = sf.windowManager.getViewForTest(tabId)!.webContents as Electron.WebContents & {
          getLastWebPreferences(): Electron.WebPreferences | null
        }
        const p = wc.getLastWebPreferences()
        return { sandbox: p?.sandbox, contextIsolation: p?.contextIsolation, nodeIntegration: p?.nodeIntegration }
      },
      id
    )
    expect(prefs, id === A1 ? 'tab' : 'popup').toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false })
  }
  await waitViewOnSlot(ctx.app, ctx.page, popupId, 'pane-1')
  expect(colorMatches(await sampleTab(ctx.app, popupId), LABEL_COLORS.C)).toBe(true)
  await capture(ctx.app, 'isolation-popup')

  // window.close() is allowed for a script-opened window; no user gesture needed
  await wm(ctx.app, (sf, id) => sf.windowManager.getViewForTest(id)!.webContents.executeJavaScript('window.close()'), popupId)
  await waitFor(async () => tabOf(await getLayout(ctx.page), 'pane-1') === A1, 10_000, 'A1 back in pane-1')
  await waitFor(
    async () => (await wm(ctx.app, (sf, id) => sf.db.getTabById(id), popupId)) === null,
    5_000,
    'popup row deleted'
  )
  await waitViewOnSlot(ctx.app, ctx.page, A1, 'pane-1')
  expect(tabOf(await getLayout(ctx.page), 'pane-2')).toBe(B1)
})

test('after a relaunch session A keeps its cookie, localStorage and IndexedDB; B stays empty', async () => {
  ctx = await relaunch(ctx)
  const layout = await waitFor(async () => {
    const l = await getLayout(ctx.page)
    return tabOf(l, 'pane-1') === A1 && tabOf(l, 'pane-2') === B1 ? l : null
  }, 15_000, 'restored layout')
  expect(layout.mode).toBe('columns')
  await waitLoaded(ctx.page, A1, `${server.base}/opener`, 'Page A')
  await waitLoaded(ctx.page, B1, `${server.base}/page`, 'Page B')

  const a1 = await read(A1)
  expect(a1.cookie).toContain('sf=a')
  expect(a1.local).toBe('a')
  expect(a1.idb).toBe('a')

  const b1 = await read(B1)
  expect(b1.cookie).not.toContain('sf=')
  expect(b1.local).toBeNull()
  expect(b1.session).toBeNull()
  expect(b1.idb).toBeNull()

  await waitViewOnSlot(ctx.app, ctx.page, A1, 'pane-1')
  await waitViewOnSlot(ctx.app, ctx.page, B1, 'pane-2')
  expect(colorMatches(await sampleTab(ctx.app, A1), LABEL_COLORS.A)).toBe(true)
  expect(colorMatches(await sampleTab(ctx.app, B1), LABEL_COLORS.B)).toBe(true)
  await capture(ctx.app, 'isolation-after-restart')
  expect(logsHaveTabNotFound(ctx.logs)).toBe(false)
})
