import { test, expect } from '@playwright/test'
import { clickMenuItem, launchApp, openMenuAt, teardown, waitFor, wm, type AppCtx } from './fixtures/app'
import { capture } from './fixtures/capture'
import { startTestServer, type TestServer } from './fixtures/test-server'
import {
  createHiddenTab,
  createSessions,
  getLayout,
  logsHaveTabNotFound,
  MOD,
  openSession,
  pressInTab,
  setMode,
  tabOf,
  waitLoaded,
  waitViewOnSlot
} from './fixtures/ui'
import type { Session } from '../src/main/types'

// Replaces scripts/verify-devtools.mjs. Views are selected by tab id, and pane-1 holds a different
// session's page, so picking the wrong view would fail these checks.
test.describe.configure({ mode: 'serial' })

let ctx: AppCtx
let server: TestServer
let A: Session
let B: Session
let aTab: string
let devTab: string

const devToolsOpen = (tabId: string) =>
  wm(ctx.app, (sf, id) => sf.windowManager.getViewForTest(id)!.webContents.isDevToolsOpened(), tabId)

async function closeDevTools(tabId: string) {
  await wm(ctx.app, (sf, id) => sf.windowManager.getViewForTest(id)!.webContents.closeDevTools(), tabId)
  await waitFor(async () => !(await devToolsOpen(tabId)), 5_000, 'devtools closed')
}

/** Put the /dev tab back in pane-2 (menu actions open new tabs there). */
async function showDevTab() {
  await ctx.page.evaluate((id) => window.api.layout.assignTab('pane-2', id), devTab)
  await waitViewOnSlot(ctx.app, ctx.page, devTab, 'pane-2')
}

/** Ids of session-B tabs that appeared since `known`. */
async function newBTabs(known: Set<string>) {
  const all = await ctx.page.evaluate((s) => window.api.tab.getBySession(s), B.id)
  return all.filter((t) => !known.has(t.id))
}

const has = (labels: string[] | null, ...want: string[]) =>
  !!labels && want.every((w) => labels.some((l) => l.startsWith(w)))
const lastIsInspect = (labels: string[] | null) => !!labels && labels[labels.length - 1] === 'Inspect'

test.beforeAll(async () => {
  server = await startTestServer()
  ctx = await launchApp()
  ;[A, B] = await createSessions(ctx.page, [
    { name: 'Session A', color: '#ef4444' },
    { name: 'Dev', color: '#1565c0' }
  ])
  await setMode(ctx.page, 'columns')
  aTab = await createHiddenTab(ctx.app, A.id, `${server.base}/page?label=A`)
  devTab = await createHiddenTab(ctx.app, B.id, `${server.base}/dev`)
  await openSession(ctx.page, 'pane-1', A.id)
  await openSession(ctx.page, 'pane-2', B.id)
  await waitLoaded(ctx.page, aTab, `${server.base}/page`, 'Page A')
  await waitLoaded(ctx.page, devTab, `${server.base}/dev`, 'Dev page')
  await waitViewOnSlot(ctx.app, ctx.page, devTab, 'pane-2')
})

test.afterAll(async () => {
  await teardown(ctx)
  await server?.close()
})

test('D1: page menu', async () => {
  const labels = await openMenuAt(ctx.app, devTab, '#plain')
  expect(has(labels, 'Back', 'Forward', 'Reload', 'Save as', 'Print', 'View page source', 'Inspect'), JSON.stringify(labels)).toBe(true)
  expect(lastIsInspect(labels)).toBe(true)
})

test('D2: link menu', async () => {
  const labels = await openMenuAt(ctx.app, devTab, '#link')
  expect(has(labels, 'Open link in new tab', 'Copy link address', 'Inspect'), JSON.stringify(labels)).toBe(true)
  expect(lastIsInspect(labels)).toBe(true)
})

test('D3: editable menu', async () => {
  const labels = await openMenuAt(ctx.app, devTab, '#field', 'el.focus(); el.select()')
  expect(has(labels, 'Undo', 'Cut', 'Copy', 'Paste', 'Select all', 'Inspect'), JSON.stringify(labels)).toBe(true)
  expect(lastIsInspect(labels)).toBe(true)
})

test('D4: image menu', async () => {
  const labels = await openMenuAt(ctx.app, devTab, '#img')
  expect(has(labels, 'Open image in new tab', 'Save image as', 'Copy image', 'Inspect'), JSON.stringify(labels)).toBe(true)
  expect(lastIsInspect(labels)).toBe(true)
})

test('D5: selection menu', async () => {
  const labels = await openMenuAt(
    ctx.app,
    devTab,
    '#text',
    'const s = getSelection(); const rg = document.createRange(); rg.selectNodeContents(el); s.removeAllRanges(); s.addRange(rg)'
  )
  expect(has(labels, 'Copy', 'Search Google for'), JSON.stringify(labels)).toBe(true)
  expect(lastIsInspect(labels)).toBe(true)
})

test('D6: Inspect opens detached DevTools for that tab only', async () => {
  await openMenuAt(ctx.app, devTab, '#plain')
  await clickMenuItem(ctx.app, 'Inspect')
  await waitFor(() => devToolsOpen(devTab), 5_000, 'devtools open')
  const detached = await wm(
    ctx.app,
    (sf, id) => {
      const wc = sf.windowManager.getViewForTest(id)!.webContents
      const dt = wc.devToolsWebContents
      const children = sf.window.contentView.children.map((v) => (v as Electron.WebContentsView).webContents)
      return dt !== null && !children.includes(dt)
    },
    devTab
  )
  expect(detached).toBe(true)
  expect(await devToolsOpen(aTab)).toBe(false)
  await ctx.page.waitForTimeout(1000)
  await capture(ctx.app, 'devtools-inspect')
  await closeDevTools(devTab)
})

test('menu "new tab" items open in the right-clicked tab\'s pane', async () => {
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-1'))
  const known = new Set((await ctx.page.evaluate((s) => window.api.tab.getBySession(s), B.id)).map((t) => t.id))

  // Open link in new tab
  await openMenuAt(ctx.app, devTab, '#link')
  await clickMenuItem(ctx.app, 'Open link in new tab')
  const [linkTab] = await waitFor(async () => {
    const n = await newBTabs(known)
    return n.length === 1 ? n : null
  })
  known.add(linkTab.id)
  expect(linkTab.url).toBe(`${server.base}/page?label=B`)
  let layout = await getLayout(ctx.page)
  expect(tabOf(layout, 'pane-2')).toBe(linkTab.id)
  expect(tabOf(layout, 'pane-1')).toBe(aTab)

  // Search Google for "…": assert the requested URL (no internet needed)
  await showDevTab()
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-1'))
  await wm(ctx.app, (sf) => {
    const g = globalThis as unknown as { __created: unknown[] }
    g.__created = []
    const w = sf.windowManager as unknown as { createTab: (...a: unknown[]) => unknown }
    const orig = w.createTab.bind(w)
    w.createTab = (...args: unknown[]) => {
      g.__created.push(args)
      return orig(...args)
    }
  })
  await openMenuAt(
    ctx.app,
    devTab,
    '#text',
    'const s = getSelection(); const rg = document.createRange(); rg.selectNodeContents(el); s.removeAllRanges(); s.addRange(rg)'
  )
  await clickMenuItem(ctx.app, 'Search Google for')
  const [searchTab] = await waitFor(async () => {
    const n = await newBTabs(known)
    return n.length === 1 ? n : null
  })
  known.add(searchTab.id)
  const created = await wm(ctx.app, (sf) => {
    delete (sf.windowManager as unknown as { createTab?: unknown }).createTab // back to the prototype method
    return (globalThis as unknown as { __created: unknown[][] }).__created
  })
  expect(created).toHaveLength(1)
  expect(created[0][0]).toBe(B.id)
  expect(created[0][1]).toBe('https://www.google.com/search?q=Selectable%20words%20here')
  layout = await getLayout(ctx.page)
  expect(tabOf(layout, 'pane-2')).toBe(searchTab.id)
  expect(tabOf(layout, 'pane-1')).toBe(aTab)

  // View page source
  await showDevTab()
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-1'))
  await openMenuAt(ctx.app, devTab, '#plain')
  await clickMenuItem(ctx.app, 'View page source')
  const [srcTab] = await waitFor(async () => {
    const n = await newBTabs(known)
    return n.length === 1 ? n : null
  })
  expect(srcTab.url.startsWith(`view-source:${server.base}`)).toBe(true)
  layout = await getLayout(ctx.page)
  expect(tabOf(layout, 'pane-2')).toBe(srcTab.id)
  expect(tabOf(layout, 'pane-1')).toBe(aTab)
})

test('D7-D10: F12, Ctrl+Shift+I and Ctrl+U inside the page', async () => {
  await showDevTab()
  // D7: F12 closes DevTools when open
  await wm(ctx.app, (sf, id) => sf.windowManager.openDevTools(id), devTab)
  await waitFor(() => devToolsOpen(devTab), 5_000, 'devtools open')
  await pressInTab(ctx.app, devTab, 'F12')
  await waitFor(async () => !(await devToolsOpen(devTab)), 5_000, 'F12 closed devtools')

  // D8: F12 opens DevTools
  await pressInTab(ctx.app, devTab, 'F12')
  await waitFor(() => devToolsOpen(devTab), 5_000, 'F12 opened devtools')

  // D9: Ctrl+Shift+I toggles (closes) them
  await pressInTab(ctx.app, devTab, 'I', [MOD, 'shift'])
  await waitFor(async () => !(await devToolsOpen(devTab)), 5_000, 'Ctrl+Shift+I closed devtools')
  expect(await devToolsOpen(aTab)).toBe(false)

  // D10: Ctrl+U opens view-source in a new tab of the same session, in pane-2
  const known = new Set((await ctx.page.evaluate((s) => window.api.tab.getBySession(s), B.id)).map((t) => t.id))
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-1'))
  await pressInTab(ctx.app, devTab, 'U', [MOD])
  const [src] = await waitFor(async () => {
    const n = await newBTabs(known)
    return n.length === 1 ? n : null
  })
  expect(src.url).toBe(`view-source:${server.base}/dev`)
  const layout = await getLayout(ctx.page)
  expect(tabOf(layout, 'pane-2')).toBe(src.id)
  expect(tabOf(layout, 'pane-1')).toBe(aTab)
})

// ---- Step 4: every shortcut goes through the one before-input-event handler (matchShortcut) ----

const shellDevToolsOpen = () => wm(ctx.app, (sf) => sf.window.webContents.isDevToolsOpened())

/** Count did-start-loading per tab, so a key handled twice shows up as two loads. */
async function watchLoads(tabId: string) {
  await wm(
    ctx.app,
    (sf, id) => {
      const g = globalThis as unknown as { __loads?: Record<string, number> }
      g.__loads ??= {}
      if (id in g.__loads) return
      g.__loads[id] = 0
      sf.windowManager.getViewForTest(id)!.webContents.on('did-start-loading', () => g.__loads![id]++)
    },
    tabId
  )
}
const loadsOf = (tabId: string) =>
  wm(ctx.app, (_sf, id) => (globalThis as unknown as { __loads: Record<string, number> }).__loads[id], tabId)

/** Wait for the tab to finish loading, then a little longer so a second (duplicate) load would have started. */
async function settled(tabId: string) {
  await ctx.page.waitForTimeout(300)
  await waitFor(async () => (await ctx.page.evaluate((id) => window.api.tab.getState(id), tabId))?.isLoading === false, 10_000, 'load to stop')
  await ctx.page.waitForTimeout(500)
}

test('step 4: DevTools keys toggle once per press; the shell DevTools never open', async () => {
  await showDevTab()
  expect(await devToolsOpen(devTab)).toBe(false)

  // F12 twice leaves DevTools closed
  await pressInTab(ctx.app, devTab, 'F12')
  await waitFor(() => devToolsOpen(devTab), 5_000, 'F12 opened devtools')
  await pressInTab(ctx.app, devTab, 'F12')
  await waitFor(async () => !(await devToolsOpen(devTab)), 5_000, 'second F12 closed devtools')
  await ctx.page.waitForTimeout(500)
  expect(await devToolsOpen(devTab)).toBe(false)
  expect(await shellDevToolsOpen()).toBe(false)

  // Ctrl+Shift+I twice: open, then closed
  await pressInTab(ctx.app, devTab, 'I', [MOD, 'shift'])
  await waitFor(() => devToolsOpen(devTab), 5_000, 'Ctrl+Shift+I opened devtools')
  await pressInTab(ctx.app, devTab, 'I', [MOD, 'shift'])
  await waitFor(async () => !(await devToolsOpen(devTab)), 5_000, 'second Ctrl+Shift+I closed devtools')
  await ctx.page.waitForTimeout(500)
  expect(await devToolsOpen(devTab)).toBe(false)

  // Ctrl+Shift+J opens on the console and a second press keeps them open
  await pressInTab(ctx.app, devTab, 'J', [MOD, 'shift'])
  await waitFor(() => devToolsOpen(devTab), 5_000, 'Ctrl+Shift+J opened devtools')
  await pressInTab(ctx.app, devTab, 'J', [MOD, 'shift'])
  await ctx.page.waitForTimeout(500)
  expect(await devToolsOpen(devTab)).toBe(true)
  await closeDevTools(devTab)

  // Ctrl+Shift+C opens them (Elements panel)
  await pressInTab(ctx.app, devTab, 'C', [MOD, 'shift'])
  await waitFor(() => devToolsOpen(devTab), 5_000, 'Ctrl+Shift+C opened devtools')
  await closeDevTools(devTab)

  expect(await devToolsOpen(aTab)).toBe(false)
  expect(await shellDevToolsOpen()).toBe(false)
})

test('step 4: Ctrl+U opens one view-source tab in pane-2, and its URL round-trips through the address bar', async () => {
  await showDevTab()
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-1'))
  const known = new Set((await ctx.page.evaluate((s) => window.api.tab.getBySession(s), B.id)).map((t) => t.id))
  await pressInTab(ctx.app, devTab, 'U', [MOD])
  const [src] = await waitFor(async () => {
    const n = await newBTabs(known)
    return n.length === 1 ? n : null
  })
  const srcUrl = `view-source:${server.base}/dev`
  await waitLoaded(ctx.page, src.id, srcUrl)
  await ctx.page.waitForTimeout(500)
  expect(await newBTabs(known)).toHaveLength(1) // handled once
  let layout = await getLayout(ctx.page)
  expect(tabOf(layout, 'pane-2')).toBe(src.id)
  expect(tabOf(layout, 'pane-1')).toBe(aTab)
  expect(layout.activePaneId).toBe('pane-2')

  // Typing the view-source URL back keeps the tab on view-source: (no Google search)
  await ctx.page.fill('[data-testid="address-input"]', srcUrl)
  await ctx.page.press('[data-testid="address-input"]', 'Enter')
  await ctx.page.waitForTimeout(500)
  const state = await waitLoaded(ctx.page, src.id, 'view-source:')
  expect(state.url).toBe(srcUrl)
  layout = await getLayout(ctx.page)
  expect(tabOf(layout, 'pane-2')).toBe(src.id)
  expect(await shellDevToolsOpen()).toBe(false)
})

test('step 4: Alt+Left goes back one entry; Ctrl+R, Ctrl+Shift+R and Shift+F5 each start one load', async () => {
  const hist = await createHiddenTab(ctx.app, B.id, `${server.base}/page?label=A`)
  await ctx.page.evaluate((id) => window.api.layout.assignTab('pane-2', id), hist)
  await waitLoaded(ctx.page, hist, `${server.base}/page`, 'Page A')
  for (const label of ['B', 'C']) {
    await ctx.page.evaluate(([id, url]) => window.api.tab.navigate(id, url), [hist, `${server.base}/page?label=${label}`] as const)
    await waitLoaded(ctx.page, hist, `${server.base}/page?label=${label}`, `Page ${label}`)
  }
  await waitViewOnSlot(ctx.app, ctx.page, hist, 'pane-2')

  // Alt+Left once: exactly one entry back (C → B, not A)
  await pressInTab(ctx.app, hist, 'Left', ['alt'])
  await waitFor(async () => (await ctx.page.evaluate((id) => window.api.tab.getState(id), hist))?.title === 'Page B', 10_000, 'Page B after Alt+Left')
  await settled(hist)
  const back = await ctx.page.evaluate((id) => window.api.tab.getState(id), hist)
  expect(back?.title).toBe('Page B')
  expect(back?.url).toBe(`${server.base}/page?label=B`)

  await watchLoads(hist)
  for (const [key, mods] of [
    ['R', [MOD]],
    ['R', [MOD, 'shift']],
    ['F5', ['shift']]
  ] as const) {
    const before = await loadsOf(hist)
    await pressInTab(ctx.app, hist, key, [...mods])
    await settled(hist)
    expect(await loadsOf(hist), `${mods.join('+')}+${key} starts exactly one load`).toBe(before + 1)
  }
  expect(await shellDevToolsOpen()).toBe(false)
})

test('no "Tab not found" in the app logs', async () => {
  expect(logsHaveTabNotFound(ctx.logs)).toBe(false)
})
