// SessionBar editing: inline rename, color, close with confirmation, and the recently closed stack
// (Cmd/Ctrl+Shift+T) for tabs and sessions, including restart, eviction and the agent/production rules.
import { test, expect } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { launchApp, relaunch, tabEval, teardown, waitFor, wm, type AppCtx } from './fixtures/app'
import { capture } from './fixtures/capture'
import { startTestServer, type TestServer } from './fixtures/test-server'
import { call, closeSettings, enableBridgeViaUi, httpClient, openSettings, setGrant } from './fixtures/mcp'
import {
  createHiddenTab,
  createSessions,
  getLayout,
  logsHaveTabNotFound,
  MOD,
  openSession,
  pressInShell,
  pressInTab,
  tabOf,
  waitLoaded,
  waitViewOnSlot
} from './fixtures/ui'
import type { Session } from '../src/main/types'

test.describe.configure({ mode: 'serial' })

let ctx: AppCtx
let server: TestServer
let client: Client | undefined
let alpha: Session
let beta: Session
let gamma: Session
let alphaTab: string
let betaTab: string
let gammaTab: string
/** Logs of the launch before the restart in test 14 */
const earlierLogs: string[] = []

const PURPLE = '#8b5cf6'
const PURPLE_RGB = 'rgb(139, 92, 246)'

// ---------------------------------------------------------------- helpers

const grants = () => ctx.page.evaluate(() => window.api.agent.getGrants())
const grantOf = async (id: string) => (await grants()).find((g) => g.sessionId === id)
const partitionCookies = (partition: string) =>
  wm(
    ctx.app,
    async (_sf, p, { session }) => (await session.fromPartition(p).cookies.get({})).map((c) => `${c.name}=${c.value}`),
    partition
  )
const closedItems = () => wm(ctx.app, (sf) => sf.db.listClosedItems())
const reopenKey = () => pressInShell(ctx.app, 'T', [MOD, 'shift'])
const getSession = (id: string) => ctx.page.evaluate((i) => window.api.session.get(i), id)
const allSessionIds = async () => (await ctx.page.evaluate(() => window.api.session.getAll())).map((s) => s.id)
const tabsOf = (id: string) => ctx.page.evaluate((s) => window.api.tab.getBySession(s), id)
const tabIdsOf = async (id: string) => (await tabsOf(id)).map((t) => t.id)
const liveTabs = () => wm(ctx.app, (sf) => sf.windowManager.listTabs())
const pane1 = async () => tabOf(await getLayout(ctx.page), 'pane-1')
const listed = async () =>
  (await call(client!, 'list_sessions')).json.sessions as Array<{ name: string; agent_access: string }>

const sessionButton = (id: string) => ctx.page.locator(`[data-testid="session-${id}"]`)
const nameInput = (id: string) => ctx.page.locator(`[data-testid="rename-session-${id}"]`)
const closeX = (id: string) => ctx.page.locator(`[data-testid="close-session-${id}"]`)
const dialog = () => ctx.page.locator('[data-testid="close-dialog"]')
const toastText = (text: string) => ctx.page.getByText(text, { exact: true })

/** A session's one new tab after an action (ids not in `before`). */
async function newTabOf(sessionId: string, before: string[]) {
  return waitFor(
    async () => {
      const added = (await tabsOf(sessionId)).filter((t) => !before.includes(t.id))
      return added.length === 1 ? added[0] : null
    },
    10_000,
    `one new tab of ${sessionId}`
  )
}

/** Composited screenshot once the shell has painted its latest state (two animation frames). */
async function snap(name: string) {
  // A busy machine can delay the shell's next frame; capturePage would then return the previous one
  await ctx.page.evaluate(
    () =>
      Promise.race([
        new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
        new Promise<void>((r) => setTimeout(r, 3000))
      ])
  )
  await capture(ctx.app, name)
}

/** Escape until the command palette is gone (an open toast is a Radix layer too). */
async function closePalette() {
  for (let i = 0; i < 4 && (await ctx.page.locator('[cmdk-input]').isVisible()); i++) {
    await pressInShell(ctx.app, 'Escape')
    await ctx.page.waitForTimeout(300)
  }
  await expect(ctx.page.locator('[cmdk-input]')).toHaveCount(0)
}

test.beforeAll(async () => {
  server = await startTestServer()
  ctx = await launchApp()
  ;[alpha, beta, gamma] = await createSessions(ctx.page, [
    { name: 'Alpha', color: '#ef4444' },
    { name: 'Beta', color: '#3b82f6' },
    { name: 'Gamma', color: '#10b981' }
  ])
  alphaTab = await createHiddenTab(ctx.app, alpha.id, `${server.base}/page?label=A`)
  betaTab = await createHiddenTab(ctx.app, beta.id, `${server.base}/page?label=B`)
  gammaTab = await createHiddenTab(ctx.app, gamma.id, `${server.base}/page?label=C`)
  await waitLoaded(ctx.page, betaTab, `${server.base}/page`, 'Page B')
  await tabEval(ctx.app, betaTab, 'sfWrite("beta")')
  await openSession(ctx.page, 'pane-1', alpha.id)
  await waitViewOnSlot(ctx.app, ctx.page, alphaTab, 'pane-1')
  await enableBridgeViaUi(ctx)
  client = await httpClient(ctx)
})

test.afterAll(async () => {
  await client?.close().catch(() => undefined)
  await teardown(ctx)
  await server?.close()
})

// ---------------------------------------------------------------- rename and color

test('1: a single click still opens the session', async () => {
  await sessionButton(beta.id).click()
  await waitFor(async () => (await pane1()) === betaTab, 5_000, 'pane-1 on Beta')
  await sessionButton(alpha.id).click()
  await waitFor(async () => (await pane1()) === alphaTab, 5_000, 'pane-1 on Alpha')
  await expect(nameInput(alpha.id)).toHaveCount(0)
})

test('2: double-click renames with Enter; no duplicate open; app shortcuts are ignored while editing', async () => {
  const tabsBefore = await tabIdsOf(alpha.id)
  const liveBefore = (await liveTabs()).length
  await sessionButton(alpha.id).dblclick()
  const input = nameInput(alpha.id)
  await expect(input).toBeFocused()
  expect(
    await input.evaluate((el: HTMLInputElement) => ({ start: el.selectionStart, end: el.selectionEnd, len: el.value.length }))
  ).toEqual({ start: 0, end: 5, len: 5 })
  expect(await tabIdsOf(alpha.id)).toEqual(tabsBefore)
  expect(await pane1()).toBe(alphaTab)

  // Ctrl+T and Ctrl+K are matched in main; the renderer drops them while the name is edited
  await pressInShell(ctx.app, 'T', [MOD])
  await pressInShell(ctx.app, 'K', [MOD])
  await ctx.page.waitForTimeout(600)
  expect((await liveTabs()).length).toBe(liveBefore)
  await expect(ctx.page.locator('[cmdk-input]')).toHaveCount(0)
  await expect(input).toBeFocused()

  await ctx.page.keyboard.type('Alpha QA')
  await snap('sessionbar-rename')
  await ctx.page.keyboard.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(sessionButton(alpha.id)).toContainText('Alpha QA')
  expect((await getSession(alpha.id))?.name).toBe('Alpha QA')
})

test('3: Escape cancels, leaving the field saves, an empty name keeps the old one', async () => {
  await sessionButton(beta.id).dblclick()
  await expect(nameInput(beta.id)).toBeFocused()
  await ctx.page.keyboard.type('Nope')
  await pressInShell(ctx.app, 'Escape')
  await expect(nameInput(beta.id)).toHaveCount(0)
  await expect(sessionButton(beta.id)).toContainText('Beta')
  expect((await getSession(beta.id))?.name).toBe('Beta')

  await sessionButton(beta.id).dblclick()
  await expect(nameInput(beta.id)).toBeFocused()
  await ctx.page.keyboard.type('Beta 2')
  await nameInput(beta.id).blur()
  await expect(nameInput(beta.id)).toHaveCount(0)
  await expect(sessionButton(beta.id)).toContainText('Beta 2')
  expect((await getSession(beta.id))?.name).toBe('Beta 2')

  await sessionButton(beta.id).dblclick()
  await expect(nameInput(beta.id)).toBeFocused()
  // Select all is Cmd+A on macOS; Playwright resolves ControlOrMeta for the OS it runs on
  await ctx.page.keyboard.press('ControlOrMeta+A')
  await ctx.page.keyboard.press('Backspace')
  await expect(nameInput(beta.id)).toHaveValue('')
  await ctx.page.keyboard.press('Enter')
  await expect(nameInput(beta.id)).toHaveCount(0)
  await expect(sessionButton(beta.id)).toContainText('Beta 2')
  expect((await getSession(beta.id))?.name).toBe('Beta 2')

  // The same limits at the IPC boundary
  await expect(
    ctx.page.evaluate((id) => window.api.session.update({ id, name: 'x'.repeat(61) }), beta.id)
  ).rejects.toThrow()
  await expect(ctx.page.evaluate((id) => window.api.session.update({ id, name: '   ' }), beta.id)).rejects.toThrow()
  await expect(
    ctx.page.evaluate((id) => window.api.session.update({ id, color: 'red; background: url(x)' }), beta.id)
  ).rejects.toThrow()
  expect((await getSession(beta.id))?.name).toBe('Beta 2')
})

test('4: the color picker saves the color', async () => {
  await sessionButton(gamma.id).dblclick()
  await expect(nameInput(gamma.id)).toBeFocused()
  await ctx.page.click(`[data-testid="color-session-${gamma.id}"]`)
  const popover = ctx.page.locator(`[data-testid="color-popover-${gamma.id}"]`)
  await expect(popover).toBeVisible()
  await expect(popover.locator('[aria-pressed="true"]')).toHaveAttribute('aria-label', 'Green')
  await ctx.page.waitForTimeout(300) // open animation
  await snap('sessionbar-color')

  await ctx.page.click('[data-testid="color-option-purple"]')
  await waitFor(async () => (await getSession(gamma.id))?.color === PURPLE, 5_000, 'Gamma purple')
  await expect(popover).toHaveCount(0)
  await expect(ctx.page.locator(`[data-testid="color-session-${gamma.id}"]`)).toHaveCSS('background-color', PURPLE_RGB)
  await expect(nameInput(gamma.id)).toBeFocused()
  await pressInShell(ctx.app, 'Escape')
  await expect(nameInput(gamma.id)).toHaveCount(0)
  await expect(sessionButton(gamma.id).locator('div.rounded-full').first()).toHaveCSS('background-color', PURPLE_RGB)
  expect((await getSession(gamma.id))?.name).toBe('Gamma')
})

// ---------------------------------------------------------------- close and reopen

test('5: the x shows on the active session, on hover and on keyboard focus', async () => {
  await ctx.page.mouse.move(600, 400)
  // The double-click in test 4 opened Gamma in pane-1
  const active = (await getLayout(ctx.page)).panes[0].sessionId!
  expect(active).toBe(gamma.id)
  expect(await pane1()).toBe(gammaTab)
  await expect(closeX(gamma.id)).toHaveCSS('opacity', '1')
  await expect(closeX(alpha.id)).toHaveCSS('opacity', '0')
  await ctx.page.hover(`[data-testid="sessionbar-item-${alpha.id}"]`)
  await expect(closeX(alpha.id)).toHaveCSS('opacity', '1')
  await ctx.page.mouse.move(600, 400)
  await expect(closeX(alpha.id)).toHaveCSS('opacity', '0')

  await sessionButton(beta.id).focus()
  await ctx.page.keyboard.press('Tab')
  await expect(closeX(beta.id)).toBeFocused()
  await expect(closeX(beta.id)).toHaveAttribute('aria-label', 'Close session Beta 2')
  await expect(closeX(beta.id)).toHaveCSS('opacity', '1')
  await ctx.page.keyboard.press('Enter')
  await expect(dialog()).toBeVisible()
  await expect(dialog()).toContainText('Close session "Beta 2"?')
  await expect(ctx.page.locator('[data-testid="close-dialog-confirm"]')).toBeFocused()
  await ctx.page.waitForTimeout(300) // open animation
  await snap('sessionbar-close-confirm')
})

test('6: Cancel and Escape change nothing', async () => {
  const snapshot = async () => ({
    sessions: await allSessionIds(),
    betaTabs: await tabIdsOf(beta.id),
    layout: await getLayout(ctx.page),
    closed: await closedItems()
  })
  const before = await snapshot()

  await ctx.page.click('[data-testid="close-dialog-cancel"]')
  await expect(dialog()).toHaveCount(0)
  await expect(sessionButton(beta.id)).toBeVisible()
  expect(await snapshot()).toEqual(before)

  await closeX(beta.id).click()
  await expect(dialog()).toBeVisible()
  await pressInShell(ctx.app, 'Escape')
  await expect(dialog()).toHaveCount(0)
  await ctx.page.waitForTimeout(300)
  await expect(sessionButton(beta.id)).toBeVisible()
  expect(await snapshot()).toEqual(before)
})

test('7: "Close session" removes it from the bar, the panes, the palette, Settings and the Agent Bridge', async () => {
  await sessionButton(beta.id).click()
  await waitFor(async () => (await pane1()) === betaTab, 5_000, 'pane-1 on Beta')
  expect((await listed()).map((s) => s.name)).toContain('Beta 2')

  await closeX(beta.id).click()
  await ctx.page.click('[data-testid="close-dialog-confirm"]')
  await expect(sessionButton(beta.id)).toHaveCount(0)
  await expect(toastText('Closed Beta 2')).toBeVisible()
  await expect(ctx.page.locator('[data-testid="toast-reopen"]')).toBeVisible()

  const layout = await getLayout(ctx.page)
  expect(layout.panes.some((p) => p.sessionId === beta.id)).toBe(false)
  expect((await liveTabs()).some((t) => t.sessionId === beta.id)).toBe(false)
  expect(await tabsOf(beta.id)).toEqual([])
  expect(await allSessionIds()).not.toContain(beta.id)
  expect(await getSession(beta.id)).toBeUndefined()

  // Agent Bridge: not listed, not addressable by name
  expect((await listed()).map((s) => s.name)).not.toContain('Beta 2')
  expect((await call(client!, 'snapshot', { session: 'Beta 2' })).text).toContain('ERROR unknown_session')

  // Command palette
  await pressInShell(ctx.app, 'K', [MOD])
  await expect(ctx.page.locator('[cmdk-input]')).toBeVisible()
  await expect(ctx.page.locator('[cmdk-item]').filter({ hasText: 'Alpha QA' })).toHaveCount(1)
  await expect(ctx.page.locator('[cmdk-item]').filter({ hasText: 'Beta 2' })).toHaveCount(0)
  await closePalette()

  // Settings → Agent Bridge → Access, and Settings → Sessions
  await openSettings(ctx, 'access')
  await expect(ctx.page.locator(`[data-testid="agent-grant-${alpha.id}"]`)).toHaveCount(1)
  await expect(ctx.page.locator(`[data-testid="agent-grant-${beta.id}"]`)).toHaveCount(0)
  await ctx.page.click('[data-testid="settings-nav-sessions"]')
  await expect(ctx.page.locator(`[data-testid="session-row-${alpha.id}"]`)).toHaveCount(1)
  await expect(ctx.page.locator(`[data-testid="session-row-${beta.id}"]`)).toHaveCount(0)
  await closeSettings(ctx)

  // The login stays on disk, and so does the entry to reopen it
  expect(await partitionCookies(beta.partition)).toContain('sf=beta')
  const items = await closedItems()
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ kind: 'session', sessionId: beta.id })
  expect(items[0].tabs.map((t) => t.url)).toEqual([`${server.base}/page?label=B`])
})

test('8: Ctrl+Shift+T in the shell reopens the session with its tab and its login', async () => {
  await ctx.page.evaluate(() => window.api.layout.focusPane('pane-1'))
  await reopenKey()
  await expect(sessionButton(beta.id)).toBeVisible()
  await expect(sessionButton(beta.id)).toContainText('Beta 2')
  await expect(toastText('Reopened Beta 2')).toBeVisible()
  const tab = await waitFor(async () => {
    const id = await pane1()
    const t = id ? (await tabsOf(beta.id)).find((x) => x.id === id) : undefined
    return t ?? null
  }, 10_000, 'pane-1 on a Beta tab')
  await waitLoaded(ctx.page, tab.id, `${server.base}/page?label=B`, 'Page B')
  const read = await tabEval<{ cookie: string }>(ctx.app, tab.id, 'sfRead()')
  expect(read.cookie).toContain('sf=beta')
  expect((await listed()).find((s) => s.name === 'Beta 2')).toMatchObject({ agent_access: 'read' })
  expect(await closedItems()).toEqual([])
  await waitViewOnSlot(ctx.app, ctx.page, tab.id, 'pane-1')
  await snap('sessionbar-reopened')
})

test('9: the toast\'s Reopen button brings back exactly that session', async () => {
  await closeX(gamma.id).click()
  await ctx.page.click('[data-testid="close-dialog-confirm"]')
  await expect(sessionButton(gamma.id)).toHaveCount(0)
  await expect(toastText('Closed Gamma')).toBeVisible()
  await ctx.page.click('[data-testid="toast-reopen"]')
  await expect(sessionButton(gamma.id)).toBeVisible()
  await expect(toastText('Reopened Gamma')).toBeVisible()
  expect((await getSession(gamma.id))?.color).toBe(PURPLE)
  expect((await tabsOf(gamma.id)).map((t) => t.url)).toEqual([`${server.base}/page?label=C`])
  expect(await closedItems()).toEqual([])
})

test('10: newest first, from inside a page: the session closed last, then the tab', async () => {
  expect(await closedItems()).toEqual([])
  const d = await createHiddenTab(ctx.app, alpha.id, `${server.base}/page?label=D`)
  await ctx.page.evaluate((id) => window.api.layout.assignTab('pane-1', id), d)
  await waitLoaded(ctx.page, d, `${server.base}/page?label=D`, 'Page D')
  await waitViewOnSlot(ctx.app, ctx.page, d, 'pane-1')

  // Ctrl+W inside the page records the tab; then Beta closes
  await pressInTab(ctx.app, d, 'W', [MOD])
  await waitFor(async () => !(await tabIdsOf(alpha.id)).includes(d), 5_000, 'tab D closed')
  await ctx.page.evaluate((id) => window.api.session.close(id), beta.id)
  expect((await closedItems()).map((i) => i.kind)).toEqual(['session', 'tab'])

  const shown = (await pane1())!
  expect((await tabsOf(alpha.id)).map((t) => t.id)).toContain(shown)
  await pressInTab(ctx.app, shown, 'T', [MOD, 'shift'])
  await expect(sessionButton(beta.id)).toBeVisible()
  await expect(toastText('Reopened Beta 2')).toBeVisible()
  const betaNow = await waitFor(async () => {
    const id = await pane1()
    return id && (await tabIdsOf(beta.id)).includes(id) ? id : null
  }, 10_000, 'pane-1 on Beta')
  await waitLoaded(ctx.page, betaNow, `${server.base}/page?label=B`, 'Page B')
  await waitViewOnSlot(ctx.app, ctx.page, betaNow, 'pane-1')

  const alphaBefore = await tabIdsOf(alpha.id)
  await pressInTab(ctx.app, betaNow, 'T', [MOD, 'shift'])
  const reopened = await newTabOf(alpha.id, alphaBefore)
  expect(reopened.url).toBe(`${server.base}/page?label=D`)
  await waitFor(async () => (await pane1()) === reopened.id, 5_000, 'pane-1 on the reopened tab')
  await ctx.page.waitForTimeout(500)
  expect((await tabIdsOf(alpha.id)).length).toBe(alphaBefore.length + 1) // handled once
  await waitLoaded(ctx.page, reopened.id, `${server.base}/page?label=D`, 'Page D')

  await reopenKey()
  await expect(toastText('Nothing to reopen')).toBeVisible()
  expect(await closedItems()).toEqual([])
})

test('11: a reopened tab gets the URL it had when it closed', async () => {
  const id = (await pane1())!
  const url = `${server.base}/page?label=C&x=1`
  await ctx.page.evaluate(([t, u]) => window.api.tab.navigate(t, u), [id, url] as const)
  await waitLoaded(ctx.page, id, url, 'Page C')
  await pressInTab(ctx.app, id, 'W', [MOD])
  await waitFor(async () => !(await tabIdsOf(alpha.id)).includes(id), 5_000, 'tab closed')
  const before = await tabIdsOf(alpha.id)
  await reopenKey()
  const reopened = await newTabOf(alpha.id, before)
  expect(reopened.url).toBe(url)
  await waitFor(async () => (await pane1()) === reopened.id, 5_000, 'pane-1 on the reopened tab')
  await waitLoaded(ctx.page, reopened.id, url, 'Page C')
  expect(await closedItems()).toEqual([])
})

test('12: "Delete permanently" removes the cookies and it can\'t be reopened', async () => {
  const [delta] = await createSessions(ctx.page, [{ name: 'Delta', color: '#f97316' }])
  const deltaTab = await createHiddenTab(ctx.app, delta.id, `${server.base}/page?label=D`)
  await waitLoaded(ctx.page, deltaTab, `${server.base}/page`, 'Page D')
  await tabEval(ctx.app, deltaTab, 'sfWrite("delta")')
  const partition = await wm(ctx.app, (sf, id) => sf.sessionManager.getSession(id)!.partition, delta.id)
  expect(await partitionCookies(partition)).toContain('sf=delta')

  // An older Alpha entry, then a Delta entry
  const oldUrl = `${server.base}/page?label=A&old=1`
  const oldTab = await createHiddenTab(ctx.app, alpha.id, oldUrl)
  await ctx.page.evaluate((id) => window.api.tab.close(id), oldTab)
  await ctx.page.evaluate((id) => window.api.tab.close(id), deltaTab)
  expect((await closedItems()).map((i) => i.sessionId)).toEqual([delta.id, alpha.id])

  await closeX(delta.id).click()
  await expect(dialog()).toBeVisible()
  await ctx.page.click('[data-testid="close-dialog-delete"]')
  await expect(sessionButton(delta.id)).toHaveCount(0)
  await expect(toastText('Deleted Delta')).toBeVisible()
  expect((await partitionCookies(partition)).filter((c) => c.startsWith('sf='))).toEqual([])
  expect((await closedItems()).some((i) => i.sessionId === delta.id)).toBe(false)
  expect(await wm(ctx.app, (sf, id) => sf.sessionManager.getSessionIncludingClosed(id) ?? null, delta.id)).toBeNull()

  const before = await tabIdsOf(alpha.id)
  await reopenKey()
  const reopened = await newTabOf(alpha.id, before)
  expect(reopened.url).toBe(oldUrl)
  expect(await getSession(delta.id)).toBeUndefined()
  await expect(sessionButton(delta.id)).toHaveCount(0)
  expect(await closedItems()).toEqual([])
})

test('13: production: rename keeps the cap, env can\'t change, a reopened session is capped again', async () => {
  const prod = await ctx.page.evaluate(() =>
    window.api.session.create({ name: 'Prod', color: '#ef4444', env: 'production' })
  )
  await createHiddenTab(ctx.app, prod.id, `${server.base}/page?label=A`)
  await ctx.page.reload()
  await ctx.page.waitForSelector(`[data-testid="session-${prod.id}"]`)
  await wm(ctx.app, (sf, id) => sf.db.setAgentGrant(id, 'control'), prod.id)
  expect(await grantOf(prod.id)).toMatchObject({ stored: 'control', effective: 'read', productionCapped: true })

  await sessionButton(prod.id).dblclick()
  await expect(nameInput(prod.id)).toBeFocused()
  await ctx.page.keyboard.type('Prod EU')
  await ctx.page.keyboard.press('Enter')
  await expect(sessionButton(prod.id)).toContainText('Prod EU')
  expect(await grantOf(prod.id)).toMatchObject({ effective: 'read', productionCapped: true, elevated: false })

  // env is not part of session:update any more
  await expect(
    ctx.page.evaluate((id) => window.api.session.update({ id, env: 'local' } as never), prod.id)
  ).rejects.toThrow()
  expect((await getSession(prod.id))?.env).toBe('production')
  expect(await grantOf(prod.id)).toMatchObject({ effective: 'read', productionCapped: true })

  // Elevation needs the current name
  await expect(setGrant(ctx, prod.id, 'control', 'Prod')).rejects.toThrow(/Type the session name "Prod EU"/)
  await setGrant(ctx, prod.id, 'control', 'Prod EU')
  expect(await grantOf(prod.id)).toMatchObject({ effective: 'control', elevated: true, productionCapped: false })

  await ctx.page.evaluate((id) => window.api.session.close(id), prod.id)
  await reopenKey()
  await expect(toastText('Reopened Prod EU')).toBeVisible()
  expect(await grantOf(prod.id)).toMatchObject({
    stored: 'control',
    effective: 'read',
    productionCapped: true,
    elevated: false
  })
  expect((await listed()).find((s) => s.name === 'Prod EU')).toMatchObject({ agent_access: 'read' })
  expect(await closedItems()).toEqual([])
})

test('14: the stack survives a restart', async () => {
  const url = `${server.base}/page?label=C&r=1`
  const t = await createHiddenTab(ctx.app, alpha.id, url)
  await waitLoaded(ctx.page, t, url, 'Page C')
  await ctx.page.evaluate((id) => window.api.tab.close(id), t)
  await ctx.page.evaluate((id) => window.api.session.close(id), gamma.id)
  expect((await closedItems()).map((i) => i.kind)).toEqual(['session', 'tab'])

  await client?.close()
  client = undefined
  earlierLogs.push(...ctx.logs)
  ctx = await relaunch(ctx)
  await expect(sessionButton(alpha.id)).toContainText('Alpha QA')
  await expect(sessionButton(gamma.id)).toHaveCount(0)
  expect((await liveTabs()).some((x) => x.sessionId === gamma.id)).toBe(false)

  await reopenKey()
  await expect(sessionButton(gamma.id)).toBeVisible()
  expect((await getSession(gamma.id))?.color).toBe(PURPLE)
  const gTab = await waitFor(async () => {
    const id = await pane1()
    return id && (await tabIdsOf(gamma.id)).includes(id) ? id : null
  }, 10_000, 'pane-1 on Gamma')
  await waitLoaded(ctx.page, gTab, `${server.base}/page?label=C`, 'Page C')

  const before = await tabIdsOf(alpha.id)
  await reopenKey()
  const reopened = await newTabOf(alpha.id, before)
  expect(reopened.url).toBe(url)
  expect(await closedItems()).toEqual([])
})

test('15: more than 10 closed sessions: the oldest is deleted for good', async () => {
  expect(await closedItems()).toEqual([])
  const evs: Array<{ id: string; partition: string }> = []
  for (let i = 1; i <= 11; i++) {
    const s = await ctx.page.evaluate((n) => window.api.session.create({ name: n, color: '#3b82f6', env: 'local' }), `Ev${i}`)
    await wm(
      ctx.app,
      (sf, a) =>
        sf.sessionManager
          .getElectronSession(a.id)!
          .cookies.set({ url: a.url, name: 'ev', value: 'n', expirationDate: Date.now() / 1000 + 3600 }),
      { id: s.id, url: `${server.base}/` }
    )
    evs.push({ id: s.id, partition: s.partition })
  }
  for (const e of evs) expect(await partitionCookies(e.partition)).toEqual(['ev=n'])
  for (const e of evs) await ctx.page.evaluate((id) => window.api.session.close(id), e.id)

  expect(await wm(ctx.app, (sf, id) => sf.sessionManager.getSessionIncludingClosed(id) ?? null, evs[0].id)).toBeNull()
  expect(await partitionCookies(evs[0].partition)).toEqual([])
  const items = await closedItems()
  expect(items).toHaveLength(10)
  expect(items.every((i) => i.kind === 'session')).toBe(true)
  expect(items.map((i) => i.sessionId)).toEqual(evs.slice(1).map((e) => e.id).reverse())
  for (const e of evs.slice(1)) {
    expect(await wm(ctx.app, (sf, id) => sf.sessionManager.isClosed(id), e.id)).toBe(true)
    expect(await partitionCookies(e.partition)).toEqual(['ev=n'])
  }

  for (const e of evs.slice(1)) expect(await ctx.page.evaluate((id) => window.api.session.delete(id), e.id)).toBe(true)
  expect(await closedItems()).toEqual([])
  for (const e of evs.slice(1)) expect(await partitionCookies(e.partition)).toEqual([])
})

test('16: closing 30 tabs after a session never deletes it: it reopens with its cookie', async () => {
  expect(await closedItems()).toEqual([])
  const keep = await ctx.page.evaluate(() => window.api.session.create({ name: 'Keep', color: '#3b82f6', env: 'local' }))
  const keepTab = await createHiddenTab(ctx.app, keep.id, `${server.base}/page?label=B&keep=1`)
  await waitLoaded(ctx.page, keepTab, `${server.base}/page`, 'Page B')
  await tabEval(ctx.app, keepTab, 'sfWrite("keep")')
  const { entryId } = await ctx.page.evaluate((id) => window.api.session.close(id), keep.id)

  const urls = Array.from({ length: 30 }, (_, i) => `${server.base}/page?label=A&n=${i}`)
  for (const url of urls) {
    const t = await createHiddenTab(ctx.app, alpha.id, url)
    await ctx.page.evaluate((id) => window.api.tab.close(id), t)
  }
  const items = await closedItems()
  expect(items.filter((i) => i.kind === 'tab').map((i) => i.url)).toEqual(urls.slice(5).reverse())
  expect(items.filter((i) => i.kind === 'session').map((i) => i.id)).toEqual([entryId])
  expect(await wm(ctx.app, (sf, id) => sf.sessionManager.isClosed(id), keep.id)).toBe(true)
  expect(await partitionCookies(keep.partition)).toContain('sf=keep')

  const result = await ctx.page.evaluate((e) => window.api.closed.reopen(e), entryId)
  expect(result).toMatchObject({ kind: 'session', sessionId: keep.id })
  expect(await getSession(keep.id)).toBeDefined()
  await waitLoaded(ctx.page, result!.tabId!, `${server.base}/page?label=B&keep=1`, 'Page B')
  const read = await tabEval<{ cookie: string }>(ctx.app, result!.tabId!, 'sfRead()')
  expect(read.cookie).toContain('sf=keep')

  // Drain: the session, then the 25 tab entries
  expect(await ctx.page.evaluate((id) => window.api.session.delete(id), keep.id)).toBe(true)
  await wm(ctx.app, (sf) => {
    for (const i of sf.db.listClosedItems()) sf.db.deleteClosedItem(i.id)
  })
  expect(await closedItems()).toEqual([])
})

test('17: one Ctrl+Shift+T press in the shell reopens exactly one of two entries', async () => {
  expect(await closedItems()).toEqual([])
  const older = `${server.base}/page?label=A&once=1`
  const newer = `${server.base}/page?label=C&once=2`
  for (const url of [older, newer]) {
    const t = await createHiddenTab(ctx.app, alpha.id, url)
    await ctx.page.evaluate((id) => window.api.tab.close(id), t)
  }
  expect((await closedItems()).map((i) => i.url)).toEqual([newer, older])

  const before = await tabIdsOf(alpha.id)
  await reopenKey()
  const reopened = await newTabOf(alpha.id, before)
  expect(reopened.url).toBe(newer)
  await ctx.page.waitForTimeout(600)
  expect((await tabIdsOf(alpha.id)).length).toBe(before.length + 1)
  const left = await closedItems()
  expect(left.map((i) => [i.kind, i.url])).toEqual([['tab', older]])

  const before2 = await tabIdsOf(alpha.id)
  await reopenKey()
  expect((await newTabOf(alpha.id, before2)).url).toBe(older)
  expect(await closedItems()).toEqual([])
})

test('18: the command palette\'s "Reopen closed tab or session" reopens the newest entry', async () => {
  expect(await closedItems()).toEqual([])
  await closeX(gamma.id).click()
  await ctx.page.click('[data-testid="close-dialog-confirm"]')
  await expect(sessionButton(gamma.id)).toHaveCount(0)
  expect((await closedItems()).map((i) => [i.kind, i.sessionId])).toEqual([['session', gamma.id]])

  await pressInShell(ctx.app, 'K', [MOD])
  await expect(ctx.page.locator('[cmdk-input]')).toBeVisible()
  await expect(ctx.page.locator('[data-testid="palette-reopen"]')).toContainText('Reopen closed tab or session')
  await ctx.page.click('[data-testid="palette-reopen"]')
  await expect(ctx.page.locator('[cmdk-input]')).toHaveCount(0)
  await expect(sessionButton(gamma.id)).toBeVisible()
  await expect(toastText('Reopened Gamma')).toBeVisible()
  expect((await tabsOf(gamma.id)).map((t) => t.url)).toEqual([`${server.base}/page?label=C`])
  expect(await closedItems()).toEqual([])
})

test('19: a reopen that fails partway keeps the session open and the tabs it didn\'t restore', async () => {
  expect(await closedItems()).toEqual([])
  const part = await ctx.page.evaluate(() => window.api.session.create({ name: 'Partial', color: '#3b82f6', env: 'local' }))
  const urls = [1, 2, 3].map((n) => `${server.base}/page?label=B&part=${n}`)
  for (const url of urls) await createHiddenTab(ctx.app, part.id, url)
  await ctx.page.evaluate((id) => window.api.session.close(id), part.id)

  // The reopen's second createTab throws, as it does when the window is gone or the app is quitting
  await wm(ctx.app, (sf) => {
    const w = sf.windowManager
    const original = w.createTab.bind(w)
    let calls = 0
    w.createTab = async (...args: Parameters<typeof original>) => {
      if (++calls === 2) throw new Error('test: createTab failed')
      return original(...args)
    }
  })
  try {
    await expect(ctx.page.evaluate(() => window.api.closed.reopenLast())).rejects.toThrow(/test: createTab failed/)
  } finally {
    await wm(ctx.app, (sf) => {
      delete (sf.windowManager as unknown as { createTab?: unknown }).createTab
    })
  }

  expect(await wm(ctx.app, (sf, id) => sf.sessionManager.stateOf(id), part.id)).toBe('open')
  expect((await tabsOf(part.id)).map((t) => t.url)).toEqual([urls[0]])
  expect((await closedItems()).map((i) => [i.kind, i.sessionId, i.url])).toEqual([
    ['tab', part.id, urls[1]],
    ['tab', part.id, urls[2]]
  ])

  // Ctrl+Shift+T brings the rest back in tab order
  for (const n of [2, 3]) {
    await reopenKey()
    await waitFor(async () => (await tabsOf(part.id)).length === n, 10_000, `${n} Partial tabs`)
  }
  expect((await tabsOf(part.id)).map((t) => t.url)).toEqual(urls)
  expect(await closedItems()).toEqual([])

  // It closes again normally, then goes
  await ctx.page.evaluate((id) => window.api.session.close(id), part.id)
  expect((await closedItems()).map((i) => [i.kind, i.tabs.length])).toEqual([['session', 3]])
  expect(await ctx.page.evaluate((id) => window.api.session.delete(id), part.id)).toBe(true)
  expect(await closedItems()).toEqual([])
})

test('20: no "Tab not found" in the app logs (both launches)', async () => {
  expect(logsHaveTabNotFound([...earlierLogs, ...ctx.logs])).toBe(false)
})
