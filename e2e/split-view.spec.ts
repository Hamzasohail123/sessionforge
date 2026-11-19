import { test, expect } from '@playwright/test'
import { closeApp, launchApp, relaunch, tabEval, teardown, waitFor, wm, type AppCtx } from './fixtures/app'
import { bandPoint, capture, colorMatches, sampleShell, sampleTab, type Rgb } from './fixtures/capture'
import { LABEL_COLORS, startTestServer, type TestServer } from './fixtures/test-server'
import {
  attachedViews,
  createHiddenTab,
  createSessions,
  getLayout,
  intersects,
  logsHaveTabNotFound,
  openSession,
  pressInShell,
  rectOf,
  setMode,
  tabOf,
  viewInfo,
  waitLoaded,
  waitViewOnSlot,
  type Box
} from './fixtures/ui'
import type { PaneId, Session } from '../src/main/types'

test.describe.configure({ mode: 'serial' })

let ctx: AppCtx
let server: TestServer
const sessions: Record<string, Session> = {}
const tabs: Record<string, string> = {}

const PANES: PaneId[] = ['pane-1', 'pane-2', 'pane-3', 'pane-4']

/** Views match their slots, sit below the toolbar, do not overlap, and show their label colour. */
async function assertPanes(assign: Array<[PaneId, string]>) {
  const toolbarBottom = await rectOf(ctx.page, 'address-bar').then((r) => r.y + r.height)
  const boxes: Box[] = []
  for (const [paneId, label] of assign) {
    const box = await waitViewOnSlot(ctx.app, ctx.page, tabs[label], paneId)
    expect(box.y).toBeGreaterThanOrEqual(Math.floor(toolbarBottom))
    boxes.push(box)
    const rgb = await sampleTab(ctx.app, tabs[label])
    expect(colorMatches(rgb, LABEL_COLORS[label]), `${paneId} shows ${label}: ${JSON.stringify(rgb)}`).toBe(true)
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) expect(intersects(boxes[i], boxes[j])).toBe(false)
}

interface FocusStyle {
  focused: boolean
  focusVisible: boolean
  outlineColor: string
  outlineStyle: string
  boxShadow: string
}

const sessionButtonFocusStyle = (sessionId: string): Promise<FocusStyle> =>
  ctx.page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="session-${id}"]`) as HTMLElement
    const cs = getComputedStyle(el)
    return {
      focused: document.activeElement === el,
      focusVisible: el.matches(':focus-visible'),
      outlineColor: cs.outlineColor,
      outlineStyle: cs.outlineStyle,
      boxShadow: cs.boxShadow
    }
  }, sessionId)

/** The expected keyboard ring colour, computed from the theme in the page. */
const neutralRing = (): Promise<string> =>
  ctx.page.evaluate(() => {
    const el = document.createElement('div')
    el.style.color = 'hsl(var(--muted-foreground) / 0.6)'
    document.body.appendChild(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  })

const UA_RING = 'rgb(229, 151, 0)'
const outlineInvisible = (f: FocusStyle) => f.outlineColor === 'rgba(0, 0, 0, 0)' || f.outlineStyle === 'none'

/** Band pixel of a pane (1 px inside its left edge) and the pane's own background colour. */
async function paneBand(paneId: PaneId): Promise<{ rgb: Rgb; background: Rgb }> {
  const { rect, bg } = await ctx.page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="pane-${id}"]`) as HTMLElement
    const r = el.getBoundingClientRect()
    return { rect: { left: r.left, top: r.top, height: r.height }, bg: getComputedStyle(el).backgroundColor }
  }, paneId)
  const [r, g, b] = bg.match(/\d+/g)!.map(Number)
  return { rgb: await sampleShell(ctx.app, bandPoint(rect)), background: { r, g, b } }
}
const near = (a: Rgb, b: Rgb, tol = 12) =>
  Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol
const twoFrames = () =>
  ctx.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))

test.beforeAll(async () => {
  server = await startTestServer()
  ctx = await launchApp()
  const made = await createSessions(ctx.page, [
    { name: 'Session A', color: '#ef4444' },
    { name: 'Session B', color: '#3b82f6' },
    { name: 'Session C', color: '#10b981' },
    { name: 'Session D', color: '#eab308' }
  ])
  ;['A', 'B', 'C', 'D'].forEach((l, i) => (sessions[l] = made[i]))
  for (const l of ['A', 'B', 'C', 'D']) {
    tabs[l] = await createHiddenTab(ctx.app, sessions[l].id, `${server.base}/page?label=${l}`)
  }
})

test.afterAll(async () => {
  await teardown(ctx)
  await server?.close()
})

test('R2: single pane sits below the toolbars and fills the width', async () => {
  await openSession(ctx.page, 'pane-1', sessions.A.id)
  await waitLoaded(ctx.page, tabs.A, `${server.base}/page`, 'Page A')
  const box = await waitViewOnSlot(ctx.app, ctx.page, tabs.A, 'pane-1')
  const toolbar = await rectOf(ctx.page, 'address-bar')
  expect(box.y).toBeGreaterThanOrEqual(Math.floor(toolbar.y + toolbar.height))
  expect(box.width).toBeGreaterThan(1000)
})

test('columns: two sessions side by side', async () => {
  await setMode(ctx.page, 'columns')
  await openSession(ctx.page, 'pane-2', sessions.B.id)
  await waitLoaded(ctx.page, tabs.B, `${server.base}/page`, 'Page B')
  const layout = await getLayout(ctx.page)
  expect(layout.mode).toBe('columns')
  expect(tabOf(layout, 'pane-1')).toBe(tabs.A)
  expect(tabOf(layout, 'pane-2')).toBe(tabs.B)
  await assertPanes([
    ['pane-1', 'A'],
    ['pane-2', 'B']
  ])
  await capture(ctx.app, 'split-view-columns')
})

test('active session and tab are marked (Addendum 4)', async () => {
  // A second and third tab in B so the TabBar has an active and inactive tabs
  const extra1 = await createHiddenTab(ctx.app, sessions.B.id, `${server.base}/page?label=C`)
  const extra2 = await createHiddenTab(ctx.app, sessions.B.id, `${server.base}/page?label=D`)
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-2'))
  await ctx.page.click(`[data-testid="session-${sessions.B.id}"]`) // keeps B's tab in pane-2
  await ctx.page.reload() // refresh the TabBar list after the hidden tabs were created
  await ctx.page.waitForSelector(`[data-testid="tab-${extra2}"]`)

  const bar = ctx.page.locator('[data-testid="session-bar"]')
  await expect(bar.locator(`[data-testid="session-${sessions.B.id}"]`)).toHaveAttribute('aria-pressed', 'true')
  for (const l of ['A', 'C', 'D'])
    await expect(bar.locator(`[data-testid="session-${sessions[l].id}"]`)).toHaveAttribute('aria-pressed', 'false')
  // A is visible in the other pane: secondary marker
  await expect(ctx.page.locator(`[data-testid="session-in-pane-${sessions.A.id}"]`)).toBeVisible()

  const tabBar = ctx.page.locator('[data-testid="tab-bar"]')
  await expect(tabBar.locator('[role="tab"]')).toHaveCount(3)
  await expect(tabBar.locator(`[data-testid="tab-${tabs.B}"]`)).toHaveAttribute('aria-selected', 'true')
  for (const id of [extra1, extra2])
    await expect(tabBar.locator(`[data-testid="tab-${id}"]`)).toHaveAttribute('aria-selected', 'false')
  await expect(tabBar.locator('[aria-selected="true"]')).toHaveCount(1)
  await waitViewOnSlot(ctx.app, ctx.page, tabs.B, 'pane-2')
  await capture(ctx.app, 'active-state-columns')

  // Gate 3: a 2 px band in the session colour around the focused pane only
  await expect(ctx.page.locator('[data-testid="pane-pane-2"]')).toHaveAttribute('data-focused', 'true')
  await twoFrames()
  let p2 = await paneBand('pane-2')
  let p1 = await paneBand('pane-1')
  expect(colorMatches(p2.rgb, sessions.B.color), `focused band ${JSON.stringify(p2.rgb)}`).toBe(true)
  expect(colorMatches(p1.rgb, sessions.A.color), `unfocused band ${JSON.stringify(p1.rgb)}`).toBe(false)
  expect(near(p1.rgb, p1.background), `unfocused band is background ${JSON.stringify(p1)}`).toBe(true)
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-1'))
  await expect(ctx.page.locator('[data-testid="pane-pane-1"]')).toHaveAttribute('data-focused', 'true')
  await twoFrames()
  p2 = await paneBand('pane-2')
  p1 = await paneBand('pane-1')
  expect(colorMatches(p1.rgb, sessions.A.color), `focused band ${JSON.stringify(p1.rgb)}`).toBe(true)
  expect(near(p2.rgb, p2.background), `unfocused band is background ${JSON.stringify(p2)}`).toBe(true)
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-2'))

  // Extra tabs are not needed by the rest of the spec
  for (const id of [extra1, extra2]) await ctx.page.evaluate((t) => window.api.tab.close(t), id)
})

test('session buttons: no ring after a mouse click, neutral ring for keyboard focus', async () => {
  const ring = await neutralRing()
  // (a) Mouse click, then keys: no focus and no ring on the button (B is already in the focused pane)
  await ctx.page.click(`[data-testid="session-${sessions.B.id}"]`)
  await ctx.page.keyboard.press('Shift')
  await ctx.page.keyboard.press('ArrowRight')
  const a = await sessionButtonFocusStyle(sessions.B.id)
  expect(a.focused).toBe(false)
  expect(outlineInvisible(a), JSON.stringify(a)).toBe(true)
  expect(a.boxShadow).toBe('none')

  // A focused address bar with typed text is blurred by a session click, so the stale text is gone
  await ctx.page.click('[data-testid="address-input"]')
  await ctx.page.keyboard.type('stale-text')
  await ctx.page.click(`[data-testid="session-${sessions.B.id}"]`)
  expect(await ctx.page.evaluate(() => document.activeElement === document.body)).toBe(true)
  expect(await ctx.page.inputValue('[data-testid="address-input"]')).not.toContain('stale-text')

  // (b) Keyboard focus: thin neutral ring, never the orange UA ring
  await ctx.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  let focusedId: string | null = null
  for (let i = 0; i < 20 && !focusedId; i++) {
    await ctx.page.keyboard.press('Tab')
    focusedId = await ctx.page.evaluate(() => {
      const el = document.activeElement
      return el?.matches('[data-testid="session-bar"] button[data-testid^="session-"]')
        ? el.getAttribute('data-testid')!.slice('session-'.length)
        : null
    })
  }
  const last = await ctx.page.evaluate(() => document.activeElement?.getAttribute('data-testid'))
  expect(focusedId, `no session button reached by Tab; last: ${last}`).not.toBeNull()
  const b = await sessionButtonFocusStyle(focusedId!)
  expect(b.focusVisible).toBe(true)
  expect(outlineInvisible(b), JSON.stringify(b)).toBe(true)
  expect(b.boxShadow).toContain(ring)
  expect(b.boxShadow).not.toContain(UA_RING)
  await ctx.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
})

test('toolbar height stays constant when an empty pane is focused', async () => {
  await ctx.page.evaluate(() => window.api.layout.assignTab('pane-2', null))
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-1'))
  const before = await waitViewOnSlot(ctx.app, ctx.page, tabs.A, 'pane-1')

  await ctx.page.click('[data-testid="pane-header-pane-2"]')
  await waitFor(async () => (await getLayout(ctx.page)).activePaneId === 'pane-2')
  await ctx.page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  )
  expect((await viewInfo(ctx.app, tabs.A))?.bounds).toEqual(before)
  await expect(ctx.page.locator('[data-testid="address-bar"]')).toBeVisible()
  await expect(ctx.page.locator('[data-testid="address-input"]')).toBeDisabled()
  await expect(ctx.page.locator('[title="New tab"]')).toBeDisabled()

  await ctx.page.click('[data-testid="pane-header-pane-1"]')
  await waitFor(async () => (await getLayout(ctx.page)).activePaneId === 'pane-1')
  await ctx.page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  )
  expect((await viewInfo(ctx.app, tabs.A))?.bounds).toEqual(before)
})

async function createSessionInDialog(name: string) {
  await ctx.page.click('[title="New session"]')
  await ctx.page.fill('#name', name)
  await ctx.page.click('button:has-text("Create Session")')
  await ctx.page.waitForSelector('#name', { state: 'detached' })
}

test('a new session fills an empty focused pane, and leaves a filled one alone', async () => {
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-2'))
  await createSessionInDialog('Fresh One')
  const layout = await waitFor(async () => {
    const l = await getLayout(ctx.page)
    return tabOf(l, 'pane-2') ? l : null
  })
  const all: Session[] = await ctx.page.evaluate(() => window.api.session.getAll())
  const fresh = all.find((s) => s.name === 'Fresh One')!
  expect(layout.panes[1].sessionId).toBe(fresh.id)
  expect(tabOf(layout, 'pane-1')).toBe(tabs.A)

  await createSessionInDialog('Fresh Two')
  await waitFor(async () =>
    (await ctx.page.evaluate(() => window.api.session.getAll())).some((s) => s.name === 'Fresh Two')
  )
  await ctx.page.waitForTimeout(300)
  expect(await getLayout(ctx.page)).toEqual(layout)

  await openSession(ctx.page, 'pane-2', sessions.B.id)
  expect(tabOf(await getLayout(ctx.page), 'pane-2')).toBe(tabs.B)
})

test('rows layout', async () => {
  await setMode(ctx.page, 'rows')
  await assertPanes([
    ['pane-1', 'A'],
    ['pane-2', 'B']
  ])
  const [p1, p2] = [await rectOf(ctx.page, 'pane-slot-pane-1'), await rectOf(ctx.page, 'pane-slot-pane-2')]
  expect(p2.y).toBeGreaterThan(p1.y + p1.height - 1)
  await capture(ctx.app, 'split-view-rows')
})

async function fillGrid() {
  await setMode(ctx.page, 'grid')
  for (const [paneId, l] of [
    ['pane-2', 'B'],
    ['pane-3', 'C'],
    ['pane-4', 'D']
  ] as const)
    await openSession(ctx.page, paneId, sessions[l].id)
  await waitLoaded(ctx.page, tabs.C, `${server.base}/page`, 'Page C')
  await waitLoaded(ctx.page, tabs.D, `${server.base}/page`, 'Page D')
}

test('grid, single, and back to grid', async () => {
  await fillGrid()
  await assertPanes(PANES.map((p, i) => [p, 'ABCD'[i]] as [PaneId, string]))
  // Gate 2 regression: no session button shows a focus ring in the grid screenshot
  const ring = await neutralRing()
  for (const l of ['A', 'B', 'C', 'D']) {
    const f = await sessionButtonFocusStyle(sessions[l].id)
    expect(outlineInvisible(f), `${l}: ${JSON.stringify(f)}`).toBe(true)
    expect(f.boxShadow === 'none' || f.boxShadow.includes(ring), `${l}: ${f.boxShadow}`).toBe(true)
    expect(f.outlineColor).not.toBe(UA_RING)
  }
  await capture(ctx.app, 'split-view-grid')

  await setMode(ctx.page, 'single')
  await assertPanes([['pane-1', 'A']])
  await waitFor(async () => (await attachedViews(ctx.app)).length === 1, 5_000, 'one attached view')
  await capture(ctx.app, 'split-view-single')

  await fillGrid()
  await assertPanes(PANES.map((p, i) => [p, 'ABCD'[i]] as [PaneId, string]))
})

test('R13/R14: views hide while the palette is open and come back after', async () => {
  await ctx.page.locator('[data-testid="session-bar"]').click({ position: { x: 5, y: 5 } })
  await pressInShell(ctx.app, 'K', ['control']) // through main's shortcut handler, like a real key
  await ctx.page.waitForSelector('[cmdk-input]')
  await waitFor(async () => {
    const v = await attachedViews(ctx.app)
    return v.length === 4 && v.every((x) => !x.visible)
  }, 5_000, 'all views hidden')
  await capture(ctx.app, 'split-view-palette-open')

  await pressInShell(ctx.app, 'Escape')
  await waitFor(async () => {
    const v = await attachedViews(ctx.app)
    return v.length === 4 && v.every((x) => x.visible)
  }, 5_000, 'all views visible')
})

test('window resize moves the views with their slots', async () => {
  await wm(ctx.app, (sf) => sf.window.setSize(1000, 700))
  await waitFor(async () => (await rectOf(ctx.page, 'split-view')).width <= 1000, 5_000, 'renderer resized')
  for (const [i, p] of PANES.entries()) await waitViewOnSlot(ctx.app, ctx.page, tabs['ABCD'[i]], p)
  await assertPanes(PANES.map((p, i) => [p, 'ABCD'[i]] as [PaneId, string]))
  await capture(ctx.app, 'split-view-resized')
  await wm(ctx.app, (sf) => sf.window.setSize(1400, 900))
  for (const [i, p] of PANES.entries()) await waitViewOnSlot(ctx.app, ctx.page, tabs['ABCD'[i]], p)
})

test('R15: relaunch keeps mode, pane assignments, tab count and the cookie', async () => {
  await tabEval(ctx.app, tabs.A, 'sfWrite("a")')
  const before = await getLayout(ctx.page)
  const count = await wm(ctx.app, (sf) => sf.db.getAllTabs().length)

  ctx = await relaunch(ctx)
  const after = await waitFor(async () => {
    const l = await getLayout(ctx.page)
    return l.panes.every((p) => p.tabId) ? l : null
  })
  expect(after.mode).toBe('grid')
  expect(after.panes.map((p) => p.tabId)).toEqual(before.panes.map((p) => p.tabId))
  expect(await wm(ctx.app, (sf) => sf.db.getAllTabs().length)).toBe(count)

  for (const [i, l] of ['A', 'B', 'C', 'D'].entries())
    await waitLoaded(ctx.page, tabs[l], `${server.base}/page`, `Page ${'ABCD'[i]}`)
  await assertPanes(PANES.map((p, i) => [p, 'ABCD'[i]] as [PaneId, string]))
  const read = await tabEval<{ cookie: string }>(ctx.app, tabs.A, 'sfRead()')
  expect(read.cookie).toContain('sf=a')
  await capture(ctx.app, 'split-view-after-restart')
  expect(logsHaveTabNotFound(ctx.logs)).toBe(false)
})

test('tabs without a saved layout: pane-1 shows the most recently shown tab', async () => {
  let fresh: AppCtx | undefined
  try {
    fresh = await launchApp()
    const [S] = await createSessions(fresh.page, [{ name: 'Solo', color: '#8b5cf6' }])
    const first: string = (await fresh.page.evaluate(
      ([s, u]) => window.api.tab.create(s, u),
      [S.id, `${server.base}/page?label=A`] as const
    )).id
    await fresh.page.evaluate(([s, u]) => window.api.tab.create(s, u), [S.id, `${server.base}/page?label=B`] as const)
    await fresh.page.waitForTimeout(20)
    await fresh.page.evaluate((id) => window.api.tab.setActive(id), first) // first is now the most recent
    await wm(fresh.app, (sf) => {
      ;(sf.db as unknown as { db: { prepare(sql: string): { run(): void } } }).db
        .prepare('DELETE FROM layouts')
        .run()
    })
    fresh = await relaunch(fresh)
    expect(tabOf(await getLayout(fresh.page), 'pane-1')).toBe(first)
    await closeApp(fresh)
    expect(logsHaveTabNotFound(fresh.logs)).toBe(false)
  } finally {
    await teardown(fresh)
  }
})
