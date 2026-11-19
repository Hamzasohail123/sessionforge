import { test, expect } from '@playwright/test'
import { launchApp, tabEval, teardown, waitFor, wm, type AppCtx } from './fixtures/app'
import { capture } from './fixtures/capture'
import { startTestServer, type TestServer } from './fixtures/test-server'
import {
  attachedViews,
  createHiddenTab,
  createSessions,
  getLayout,
  logsHaveTabNotFound,
  MOD,
  pressInShell,
  pressInTab,
  setMode,
  tabOf,
  tabState,
  waitLoaded,
  waitViewOnSlot
} from './fixtures/ui'
import type { PaneId, Session } from '../src/main/types'
import { DEFAULT_URL } from '../src/main/constants'

// Shortcuts pressed inside page views are matched in main (before-input-event) and must act on the
// pane the key was pressed in; the page must not see them.
test.describe.configure({ mode: 'serial' })

let ctx: AppCtx
let server: TestServer
let A: Session
let B: Session
let a1: string
let a2: string
let b1: string
let b2: string

/** Send a key to a tab's page without focusing it first (sendInputEvent goes to that page either way). */
async function sendKeyNoFocus(tabId: string, keyCode: string, modifiers: string[] = []) {
  await wm(
    ctx.app,
    (sf, { tabId, keyCode, modifiers }) => {
      const wc = sf.windowManager.getViewForTest(tabId)!.webContents
      const mods = modifiers as Array<'control' | 'shift' | 'alt' | 'meta'>
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods })
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods })
    },
    { tabId, keyCode, modifiers }
  )
}

const activePane = async () => (await getLayout(ctx.page)).activePaneId
const paneTab = async (paneId: PaneId) => tabOf(await getLayout(ctx.page), paneId)
const sessionTabIds = async (sessionId: string) =>
  (await ctx.page.evaluate((s) => window.api.tab.getBySession(s), sessionId)).map((t) => t.id)
const ctrlKeys = (tabId: string) => tabEval<number>(ctx.app, tabId, 'window.__ctrlKeys')
const paletteOpen = () => ctx.page.locator('[cmdk-input]').isVisible()
const addressFocused = () =>
  ctx.page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'address-input')
const devToolsOpen = (tabId: string) =>
  wm(ctx.app, (sf, id) => sf.windowManager.getViewForTest(id)?.webContents.isDevToolsOpened() ?? false, tabId)
const shellDevToolsOpen = () => wm(ctx.app, (sf) => sf.window.webContents.isDevToolsOpened())

async function closeDevTools(tabId: string) {
  await wm(ctx.app, (sf, id) => sf.windowManager.getViewForTest(id)!.webContents.closeDevTools(), tabId)
  await waitFor(async () => !(await devToolsOpen(tabId)), 5_000, 'devtools closed')
}

async function waitPaneTab(paneId: PaneId, tabId: string) {
  await waitFor(async () => (await paneTab(paneId)) === tabId, 5_000, `${paneId} to show ${tabId}`)
}

async function watchLoads(tabIds: string[]) {
  await wm(
    ctx.app,
    (sf, ids) => {
      const g = globalThis as unknown as { __loads?: Record<string, number> }
      g.__loads ??= {}
      for (const id of ids) {
        if (id in g.__loads) continue
        g.__loads[id] = 0
        sf.windowManager.getViewForTest(id)!.webContents.on('did-start-loading', () => g.__loads![id]++)
      }
    },
    tabIds
  )
}
const loadsOf = (tabId: string) =>
  wm(ctx.app, (_sf, id) => (globalThis as unknown as { __loads: Record<string, number> }).__loads[id], tabId)

test.beforeAll(async () => {
  server = await startTestServer()
  ctx = await launchApp()
  ;[A, B] = await createSessions(ctx.page, [
    { name: 'Session A', color: '#ef4444' },
    { name: 'Session B', color: '#3b82f6' }
  ])
  await setMode(ctx.page, 'columns')
  a1 = await createHiddenTab(ctx.app, A.id, `${server.base}/page?label=A`)
  a2 = await createHiddenTab(ctx.app, A.id, `${server.base}/page?label=B`)
  b1 = await createHiddenTab(ctx.app, B.id, `${server.base}/page?label=C`)
  b2 = await createHiddenTab(ctx.app, B.id, `${server.base}/page?label=D`)
  await ctx.page.evaluate(([t1, t2]) => window.api.layout.assignTab('pane-1', t1).then(() => window.api.layout.assignTab('pane-2', t2)), [a1, b1] as const)
  await waitLoaded(ctx.page, a1, `${server.base}/page`, 'Page A')
  await waitLoaded(ctx.page, a2, `${server.base}/page`, 'Page B')
  await waitLoaded(ctx.page, b1, `${server.base}/page`, 'Page C')
  await waitLoaded(ctx.page, b2, `${server.base}/page`, 'Page D')
  await waitViewOnSlot(ctx.app, ctx.page, a1, 'pane-1')
  await waitViewOnSlot(ctx.app, ctx.page, b1, 'pane-2')
})

test.afterAll(async () => {
  await teardown(ctx)
  await server?.close()
})

test('Ctrl+1 from inside pane-2 focuses pane-1', async () => {
  await pressInTab(ctx.app, b1, '1', [MOD])
  await waitFor(async () => (await activePane()) === 'pane-1', 5_000, 'pane-1 active')
  await ctx.page.waitForTimeout(500) // focus ring re-render
  await capture(ctx.app, 'shortcuts-focus-pane')
  expect(await paneTab('pane-1')).toBe(a1)
  expect(await paneTab('pane-2')).toBe(b1)
})

test('Ctrl+T opens a new tab of session A in pane-1', async () => {
  const before = await sessionTabIds(A.id)
  // New tabs open DEFAULT_URL (Google); record the request and load a local page instead
  await wm(
    ctx.app,
    (sf, local) => {
      const g = globalThis as unknown as { __created: unknown[][] }
      g.__created = []
      const w = sf.windowManager as unknown as { createTab: (...a: unknown[]) => unknown }
      const orig = w.createTab.bind(w)
      w.createTab = (...args: unknown[]) => {
        g.__created.push(args.slice(0, 2))
        return orig(args[0], local, ...args.slice(2))
      }
    },
    `${server.base}/page?label=D`
  )
  await pressInTab(ctx.app, a1, 'T', [MOD])
  const added = await waitFor(async () => {
    const now = await sessionTabIds(A.id)
    const n = now.filter((id) => !before.includes(id))
    return n.length === 1 ? n[0] : null
  }, 5_000, 'one new A tab')
  await waitPaneTab('pane-1', added)
  await ctx.page.waitForTimeout(500)
  expect((await sessionTabIds(A.id)).length).toBe(before.length + 1) // handled once
  expect((await sessionTabIds(B.id)).length).toBe(2)
  expect(await paneTab('pane-2')).toBe(b1)
  const created = await wm(ctx.app, (sf) => {
    delete (sf.windowManager as unknown as { createTab?: unknown }).createTab // back to the prototype method
    return (globalThis as unknown as { __created: unknown[][] }).__created
  })
  expect(created).toEqual([[A.id, DEFAULT_URL]])
  await waitLoaded(ctx.page, added, `${server.base}/page?label=D`, 'Page D')
  await waitViewOnSlot(ctx.app, ctx.page, added, 'pane-1')
  await ctx.page.waitForTimeout(500)
  await capture(ctx.app, 'shortcuts-new-tab')
})

test('Ctrl+Tab / Ctrl+Shift+Tab cycle pane-1 through A\'s tabs; Ctrl+W closes and refills', async () => {
  const a3 = (await paneTab('pane-1'))!
  expect([a1, a2]).not.toContain(a3)
  // Order is a1, a2, a3 (creation order). Tab cycling is Control on every OS, macOS included.
  await pressInTab(ctx.app, a3, 'Tab', ['control'])
  await waitPaneTab('pane-1', a1)
  await pressInTab(ctx.app, a1, 'Tab', ['control'])
  await waitPaneTab('pane-1', a2)
  await pressInTab(ctx.app, a2, 'Tab', ['control', 'shift'])
  await waitPaneTab('pane-1', a1)
  await pressInTab(ctx.app, a1, 'Tab', ['control', 'shift'])
  await waitPaneTab('pane-1', a3)
  expect(await paneTab('pane-2')).toBe(b1)

  // Ctrl+W closes the shown tab and pane-1 gets another A tab
  await pressInTab(ctx.app, a3, 'W', [MOD])
  await waitFor(async () => !(await sessionTabIds(A.id)).includes(a3), 5_000, 'a3 closed')
  expect(await tabState(ctx.page, a3)).toBeNull()
  const refill = await paneTab('pane-1')
  expect([a1, a2]).toContain(refill)
  await ctx.page.waitForTimeout(300)
  expect(await sessionTabIds(A.id)).toHaveLength(2) // only one tab closed
  expect(await paneTab('pane-2')).toBe(b1)
})

test('Ctrl+L and Ctrl+K from inside a page reach the shell UI; the pages never see the keys', async () => {
  await pressInTab(ctx.app, b1, 'L', [MOD])
  await waitFor(addressFocused, 5_000, 'address input focused')
  expect(await activePane()).toBe('pane-2')

  await pressInTab(ctx.app, a1, 'K', [MOD])
  await waitFor(paletteOpen, 5_000, 'palette open')
  await waitFor(async () => (await attachedViews(ctx.app)).every((v) => !v.visible), 5_000, 'views hidden')

  // Shell Escape (Radix gets it) closes the palette and the views come back
  await pressInShell(ctx.app, 'Escape')
  await waitFor(async () => !(await paletteOpen()), 5_000, 'palette closed')
  await waitFor(async () => (await attachedViews(ctx.app)).every((v) => v.visible), 5_000, 'views visible')

  for (const id of [a1, a2, b1]) expect(await ctrlKeys(id), `page ${id} saw a shortcut key`).toBe(0)
})

test('a key pressed in pane-2 while pane-1 is active acts on pane-2 (Ctrl+R, F12, Ctrl+W)', async () => {
  const p1 = (await paneTab('pane-1'))!
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-1'))
  await waitFor(async () => (await activePane()) === 'pane-1', 5_000, 'pane-1 active')
  await watchLoads([p1, b1])
  const l1 = await loadsOf(p1)
  const l2 = await loadsOf(b1)

  await sendKeyNoFocus(b1, 'R', [MOD])
  await waitFor(async () => (await loadsOf(b1)) === l2 + 1, 5_000, 'pane-2 reloaded')
  await waitLoaded(ctx.page, b1, `${server.base}/page`, 'Page C')
  expect(await activePane()).toBe('pane-2')

  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-1'))
  await waitFor(async () => (await activePane()) === 'pane-1', 5_000, 'pane-1 active')
  await sendKeyNoFocus(b1, 'F12')
  await waitFor(() => devToolsOpen(b1), 5_000, 'pane-2 devtools open')
  expect(await devToolsOpen(p1)).toBe(false)
  expect(await loadsOf(p1)).toBe(l1)
  expect(await shellDevToolsOpen()).toBe(false)
  await closeDevTools(b1)

  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-1'))
  await waitFor(async () => (await activePane()) === 'pane-1', 5_000, 'pane-1 active')
  await sendKeyNoFocus(b1, 'W', [MOD])
  await waitFor(async () => !(await sessionTabIds(B.id)).includes(b1), 5_000, 'b1 closed')
  await waitPaneTab('pane-2', b2)
  expect(await paneTab('pane-1')).toBe(p1)
  expect(await tabState(ctx.page, p1)).not.toBeNull()
  b1 = b2
})

test('Escape reaches a loaded page and stops a loading one', async () => {
  const p1 = (await paneTab('pane-1'))!
  const label = p1 === a1 ? 'A' : 'B'
  await waitLoaded(ctx.page, p1, `${server.base}/page`, `Page ${label}`)
  const esc0 = await tabEval<number>(ctx.app, p1, 'window.__escKeys')
  await pressInTab(ctx.app, p1, 'Escape')
  await waitFor(async () => (await tabEval<number>(ctx.app, p1, 'window.__escKeys')) === esc0 + 1, 5_000, 'page saw Escape')
  const after = await tabState(ctx.page, p1)
  expect(after?.title).toBe(`Page ${label}`)
  expect(after?.isLoading).toBe(false)

  // /slow holds its body for 3 s; Escape while loading stops it
  await ctx.page.evaluate(([id, url]) => window.api.tab.navigate(id, url), [p1, `${server.base}/slow`] as const)
  await waitFor(async () => {
    const s = await tabState(ctx.page, p1)
    return s?.url.startsWith(`${server.base}/slow`) && s.isLoading
  }, 5_000, '/slow loading')
  const t0 = Date.now()
  await pressInTab(ctx.app, p1, 'Escape')
  await waitFor(async () => (await tabState(ctx.page, p1))?.isLoading === false, 5_000, 'load stopped')
  expect(Date.now() - t0).toBeLessThan(2_500)

  // Back to the colour page for the next test
  await ctx.page.evaluate(([id, url]) => window.api.tab.navigate(id, url), [p1, `${server.base}/page?label=${label}`] as const)
  await waitLoaded(ctx.page, p1, `${server.base}/page?label=${label}`, `Page ${label}`)
})

test('keys with extra modifiers reach the page (Ctrl+Shift+K, Ctrl+Alt+L)', async () => {
  const p1 = (await paneTab('pane-1'))!
  await ctx.page.waitForTimeout(300)
  const tabsA = (await sessionTabIds(A.id)).length
  const tabsB = (await sessionTabIds(B.id)).length
  for (const [key, mods, seen] of [
    ['K', [MOD, 'shift'], 'Shift+K'],
    ['L', [MOD, 'alt'], 'Alt+l']
  ] as const) {
    await pressInTab(ctx.app, p1, key, [...mods])
    await waitFor(async () => (await tabEval<string>(ctx.app, p1, 'window.__lastCtrlKey')) === seen, 5_000, `page saw ${seen}`)
  }
  await ctx.page.waitForTimeout(500)
  expect((await sessionTabIds(A.id)).length).toBe(tabsA)
  expect((await sessionTabIds(B.id)).length).toBe(tabsB)
  expect(await paletteOpen()).toBe(false)
  expect(await addressFocused()).toBe(false)
  expect(await tabEval<number>(ctx.app, p1, 'window.__ctrlKeys')).toBe(2)
})

test('Ctrl+Shift+T inside a page reopens the last closed tab once, in that pane', async () => {
  // Newest entry on the stack: session B's /page?label=C, closed with Ctrl+W in the pane-2 test
  const p1 = (await paneTab('pane-1'))!
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-2'))
  await waitFor(async () => (await activePane()) === 'pane-2', 5_000, 'pane-2 active')
  const beforeA = await sessionTabIds(A.id)
  const beforeB = await sessionTabIds(B.id)
  const keys0 = await ctrlKeys(p1)

  await pressInTab(ctx.app, p1, 'T', [MOD, 'shift'])
  const added = await waitFor(async () => {
    const n = (await sessionTabIds(B.id)).filter((id) => !beforeB.includes(id))
    return n.length === 1 ? n[0] : null
  }, 5_000, 'one reopened B tab')
  await waitPaneTab('pane-1', added)
  await waitLoaded(ctx.page, added, `${server.base}/page?label=C`, 'Page C')
  await ctx.page.waitForTimeout(500)
  expect(await activePane()).toBe('pane-1')
  expect((await sessionTabIds(B.id)).length).toBe(beforeB.length + 1) // handled once
  expect(await sessionTabIds(A.id)).toEqual(beforeA)
  expect(await paneTab('pane-2')).toBe(b1)
  expect(await ctrlKeys(p1)).toBe(keys0) // the page never saw it

  // p1 back in pane-1 for the next tests
  await ctx.page.evaluate((id) => window.api.layout.assignTab('pane-1', id), p1)
  await waitPaneTab('pane-1', p1)
  await waitViewOnSlot(ctx.app, ctx.page, p1, 'pane-1')
})

test('shell-focused: Escape closes a dialog, F12 opens only the tab\'s DevTools', async () => {
  const p1 = (await paneTab('pane-1'))!
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-1'))
  await ctx.page.click('[data-testid="address-input"]')
  expect(await addressFocused()).toBe(true)

  await pressInShell(ctx.app, 'K', [MOD])
  await waitFor(paletteOpen, 5_000, 'palette open')
  await waitFor(async () => (await attachedViews(ctx.app)).every((v) => !v.visible), 5_000, 'views hidden')
  await pressInShell(ctx.app, 'Escape')
  await waitFor(async () => !(await paletteOpen()), 5_000, 'palette closed')
  await waitFor(async () => (await attachedViews(ctx.app)).every((v) => v.visible), 5_000, 'views visible')
  // Escape on the shell with the tab idle stops nothing
  expect((await tabState(ctx.page, p1))?.title).toMatch(/^Page /)

  await ctx.page.click('[data-testid="address-input"]')
  await pressInShell(ctx.app, 'F12')
  await waitFor(() => devToolsOpen(p1), 5_000, 'tab devtools open')
  await ctx.page.waitForTimeout(500)
  expect(await shellDevToolsOpen()).toBe(false)
  expect(await devToolsOpen(b1)).toBe(false)
  await closeDevTools(p1)
})

test('exactly one before-input-event listener per page view and on the shell', async () => {
  const counts = await wm(
    ctx.app,
    (sf, ids) => ({
      shell: sf.window.webContents.listenerCount('before-input-event'),
      pages: ids.map((id) => sf.windowManager.getViewForTest(id)?.webContents.listenerCount('before-input-event') ?? -1)
    }),
    [a1, a2, b1]
  )
  expect(counts).toEqual({ shell: 1, pages: [1, 1, 1] })
})

test('no "Tab not found" in the app logs', async () => {
  expect(logsHaveTabNotFound(ctx.logs)).toBe(false)
})
