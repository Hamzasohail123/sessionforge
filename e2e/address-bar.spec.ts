import { test, expect } from '@playwright/test'
import { internetAvailable, launchApp, tabEval, teardown, waitFor, type AppCtx } from './fixtures/app'
import { capture, colorMatches, sampleTab } from './fixtures/capture'
import { LABEL_COLORS, startTestServer, type TestServer } from './fixtures/test-server'
import {
  createHiddenTab,
  createSessions,
  getLayout,
  logsHaveTabNotFound,
  openSession,
  tabOf,
  tabState,
  viewInfo,
  waitLoaded,
  waitViewOnSlot
} from './fixtures/ui'
import type { Session } from '../src/main/types'

test.describe.configure({ mode: 'serial' })

let ctx: AppCtx
let server: TestServer
let A: Session
let firstTab: string
let newTab: string
let online = false

async function typeAddress(text: string) {
  const input = ctx.page.locator('[data-testid="address-input"]')
  await input.click()
  await input.fill(text)
  await input.press('Enter')
}

async function pane1Tab(): Promise<string> {
  return tabOf(await getLayout(ctx.page), 'pane-1')!
}

test.beforeAll(async () => {
  server = await startTestServer()
  online = await internetAvailable()
  ctx = await launchApp()
  ;[A] = await createSessions(ctx.page, [{ name: 'Session A', color: '#ef4444' }])
  // Start from a local page so the session's first tab never needs the internet
  firstTab = await createHiddenTab(ctx.app, A.id, `${server.base}/page?label=D`)
  await openSession(ctx.page, 'pane-1', A.id)
  expect(await pane1Tab()).toBe(firstTab)
  await waitLoaded(ctx.page, firstTab, `${server.base}/page`, 'Page D')
})

test.afterAll(async () => {
  await teardown(ctx)
  await server?.close()
})

test('R1: typed 127.0.0.1 URL renders the page', async () => {
  await typeAddress(`127.0.0.1:${server.port}/page?label=A`)
  await waitLoaded(ctx.page, firstTab, `${server.base}/page`, 'Page A')
  await waitViewOnSlot(ctx.app, ctx.page, firstTab, 'pane-1')
  expect(colorMatches(await sampleTab(ctx.app, firstTab), LABEL_COLORS.A)).toBe(true)
  await capture(ctx.app, 'address-bar-local')
})

test('R3/R4: localhost:PORT loads as a URL and the address bar shows the title', async () => {
  await typeAddress(`localhost:${server.port}/page?label=B`)
  const state = await waitLoaded(ctx.page, firstTab, 'http://localhost', 'Page B')
  expect(state.url.startsWith(`${server.localBase}/page`)).toBe(true)
  expect(colorMatches(await sampleTab(ctx.app, firstTab), LABEL_COLORS.B)).toBe(true)
  // Not focused: the input shows the page title
  await expect(ctx.page.locator('[data-testid="address-input"]')).toHaveValue('Page B')
})

test('R5: back button returns to the previous page', async () => {
  await ctx.page.click('[title="Back (Alt+Left)"]')
  await waitLoaded(ctx.page, firstTab, `${server.base}/page`, 'Page A')
})

test('internet: example.com renders in the pane', async () => {
  test.skip(!online, 'no internet: example.com unreachable')
  await typeAddress('example.com')
  await waitLoaded(ctx.page, firstTab, 'https://example.com', 'Example Domain')
  const v = await viewInfo(ctx.app, firstTab)
  expect(v?.attached && v.visible).toBe(true)
  await waitViewOnSlot(ctx.app, ctx.page, firstTab, 'pane-1')
  await capture(ctx.app, 'address-bar-example')
})

test('R6 (internet): words run a Google search', async () => {
  test.skip(!online, 'no internet: example.com unreachable')
  await typeAddress('sessionforge playwright')
  // Google may answer automated traffic with its /sorry/ interstitial; the navigation is what is tested
  const state = await waitFor(
    async () => {
      const s = await tabState(ctx.page, firstTab)
      // /sorry/?continue=… encodes the search URL twice, so decode until it stops changing
      let u = s?.url ?? ''
      for (let i = 0; i < 3; i++) u = decodeURIComponent(u)
      return s && !s.isLoading && u.includes('google.com/') && u.includes('q=sessionforge playwright') ? s : null
    },
    20_000,
    'google search'
  )
  expect(state.title.length).toBeGreaterThan(0)
  await waitFor(
    async () => (await viewInfo(ctx.app, firstTab))?.visible,
    5_000,
    `search page visible (toasts: ${JSON.stringify(await ctx.page.locator('ol li').allInnerTexts())})`
  )
  await capture(ctx.app, 'address-bar-search')
})

test('R7/R8: + adds a tab and the address bar drives the new tab', async () => {
  const tabs = ctx.page.locator('[data-testid="tab-bar"] [role="tab"]')
  const before = await tabs.count()
  await ctx.page.click('[title="New tab"]')
  await expect(tabs).toHaveCount(before + 1)
  newTab = await waitFor(async () => {
    const id = await pane1Tab()
    return id !== firstTab ? id : null
  })
  await expect(ctx.page.locator(`[data-testid="tab-${newTab}"]`)).toHaveAttribute('aria-selected', 'true')

  await typeAddress(`127.0.0.1:${server.port}/page?label=C`)
  await waitLoaded(ctx.page, newTab, `${server.base}/page`, 'Page C')
  // The old tab was not navigated
  expect((await tabState(ctx.page, firstTab))?.title).not.toBe('Page C')
  expect(colorMatches(await sampleTab(ctx.app, newTab), LABEL_COLORS.C)).toBe(true)
})

test('R9-R12: session switch hides the page, isolates cookies, and returns to the tab you left', async () => {
  await tabEval(ctx.app, newTab, 'sfWrite("a")')

  const [B] = await createSessions(ctx.page, [{ name: 'Session B', color: '#3b82f6' }])
  const bTab = await createHiddenTab(ctx.app, B.id, `${server.base}/page?label=B`)
  const layout = await openSession(ctx.page, 'pane-1', B.id)
  expect(tabOf(layout, 'pane-1')).toBe(bTab)
  expect(layout.panes[0].sessionId).toBe(B.id)

  // R9: A's page is no longer attached to the window
  await waitFor(async () => !(await viewInfo(ctx.app, newTab))?.attached, 5_000, 'A view detached')
  await waitLoaded(ctx.page, bTab, `${server.base}/page`, 'Page B')

  // R10: B cannot see A's cookie
  const bRead = await tabEval<{ cookie: string }>(ctx.app, bTab, 'sfRead()')
  expect(bRead.cookie).not.toContain('sf=')

  // R11: returning shows the tab you left
  const back = await openSession(ctx.page, 'pane-1', A.id)
  expect(tabOf(back, 'pane-1')).toBe(newTab)
  await waitViewOnSlot(ctx.app, ctx.page, newTab, 'pane-1')

  // R12: A sees its own cookie
  const aRead = await tabEval<{ cookie: string }>(ctx.app, newTab, 'sfRead()')
  expect(aRead.cookie).toContain('sf=a')
})

test('no "Tab not found" in the app logs', async () => {
  expect(logsHaveTabNotFound(ctx.logs)).toBe(false)
})
