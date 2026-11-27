// Real screenshots and demo video frames of SessionForge for the website (site/assets/).
// Temp profile, free ports, SESSIONFORGE_E2E=1 and the local "Acme Admin" demo app only. Never the real
// profile, never a real site, never the real bridge token on screen.
// Run: npm run electron:build && npm run rebuild:native && npx playwright test -c site/tools/capture/playwright.config.ts
import { test, expect, chromium, type BrowserContext, type CDPSession, type Page, type Worker } from '@playwright/test'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createNetServer } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { launchApp, projectRoot, tabEval, teardown, waitFor, wm, type AppCtx } from '../../../e2e/fixtures/app'
import { capture, screenshotDir } from '../../../e2e/fixtures/capture'
import { setContentSize } from '../../../e2e/fixtures/ui'
import {
  bridgeToken,
  call,
  closeSettings,
  enableBridgeViaUi,
  makeSession,
  setGrant
} from '../../../e2e/fixtures/mcp'
import type { LayoutMode, PaneId, Session } from '../../../src/main/types'
import { startDemoApp, startSignInStub, type DemoApp } from './demo-app'

test.describe.configure({ mode: 'serial' })

const SHOTS = join(screenshotDir, 'site')
const FRAMES = join(screenshotDir, 'site-video')
const COLOR = { blue: '#3b82f6', green: '#10b981', yellow: '#eab308', red: '#ef4444' }

interface Crop {
  name: string
  source: string
  /** CSS pixels of the window content; optimize.mjs multiplies by the capture scale */
  box: { x: number; y: number; width: number; height: number }
}

let demo: DemoApp

test.beforeAll(async () => {
  demo = await startDemoApp()
})
test.afterAll(async () => {
  await demo?.close()
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * A 1440x900 window at scale factor 2 is 2880x1800 device pixels, larger than most laptop screens, and
 * window managers shrink it. SF_CAPTURE_DISPLAY points the app at a big nested X server without a window
 * manager instead (for example `Xephyr :99 -screen 3200x2000 -ac -br -noreset` and SF_CAPTURE_DISPLAY=:99).
 */
function onCaptureDisplay(extraArgs: string[]) {
  const display = process.env.SF_CAPTURE_DISPLAY
  if (!display) return { extraArgs }
  return { extraArgs: ['--ozone-platform=x11', ...extraArgs], env: { DISPLAY: display, WAYLAND_DISPLAY: '' } }
}

/** Every tab in the app must show the local demo app (no Google, no real site). */
async function assertLocalOnly(ctx: AppCtx): Promise<void> {
  const urls = await wm(ctx.app, (sf) => sf.windowManager.listTabs().map((t) => t.url))
  for (const url of urls) {
    expect(url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:'), `non-local tab ${url}`).toBe(true)
  }
}

/** The renderer must not show the real bridge token anywhere. */
async function assertNoToken(ctx: AppCtx): Promise<void> {
  const token = await bridgeToken(ctx)
  const text = await ctx.page.evaluate(() => document.body.innerText)
  expect(token.length).toBeGreaterThan(20)
  expect(text.includes(token), 'bridge token visible in the UI').toBe(false)
}

async function settle(ctx: AppCtx, extra = 600): Promise<void> {
  await waitFor(
    () => wm(ctx.app, (sf) => sf.windowManager.listTabs().every((t) => !t.isLoading)),
    20_000,
    'tabs loaded'
  )
  await sleep(extra)
}

async function shot(ctx: AppCtx, name: string, expectWidth?: number): Promise<string> {
  await assertLocalOnly(ctx)
  const file = await capture(ctx.app, `site/${name}`)
  if (expectWidth) {
    const { readFile } = await import('node:fs/promises')
    const png = await readFile(file)
    expect(png.readUInt32BE(16), `${name} width`).toBe(expectWidth)
  }
  return file
}

const setMode = (ctx: AppCtx, mode: LayoutMode) => ctx.page.click(`[data-testid="layout-${mode}"]`)
const show = (ctx: AppCtx, paneId: PaneId, sessionId: string) =>
  ctx.page.evaluate((a) => window.api.layout.openSession(a.paneId, a.sessionId), { paneId, sessionId })
const focus = (ctx: AppCtx, paneId: PaneId) => ctx.page.evaluate((p) => window.api.layout.focusPane(p), paneId)

async function boxOf(ctx: AppCtx, testId: string) {
  const box = await ctx.page.locator(`[data-testid="${testId}"]`).boundingBox()
  if (!box) throw new Error(`no box for ${testId}`)
  return box
}


/** An MCP client over Streamable HTTP, named like a user's own agent script (not an editor). */
async function demoClient(ctx: AppCtx): Promise<Client> {
  const client = new Client({ name: 'demo-agent', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${ctx.mcpPort}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${await bridgeToken(ctx)}` } }
  })
  await client.connect(transport)
  return client
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createNetServer()
    srv.once('error', () => resolve(false))
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)))
  })
}

async function settingsShot(ctx: AppCtx, nav: string, sub: string | null, name: string): Promise<Crop[]> {
  await setContentSize(ctx.app, 1440, 900)
  await ctx.page.click('[data-testid="open-settings"]')
  await ctx.page.waitForSelector('[data-testid="settings-dialog"]')
  await ctx.page.click(`[data-testid="settings-nav-${nav}"]`)
  if (sub) {
    await ctx.page.click(`[data-testid="settings-subtab-${sub}"]`)
    await ctx.page.waitForSelector(`[data-testid="settings-subtab-${sub}"][data-state="active"]`)
  }
  await sleep(400)
  // Through the CSSOM (allowed by the renderer CSP)
  const height = await ctx.page.evaluate(() => {
    const d = document.querySelector<HTMLElement>('[data-testid="settings-dialog"]')!
    // Normal width (1100 px at this window size); only the height grows so nothing scrolls or is cut off
    for (const [k, v] of [['height', 'auto'], ['max-height', 'none']]) d.style.setProperty(k, v, 'important')
    return Math.ceil(d.getBoundingClientRect().height)
  })
  await setContentSize(ctx.app, 1440, Math.max(900, height + 96))
  await sleep(600)
  const overflow = await ctx.page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="settings-scroll"]')!
    const inner = [...el.querySelectorAll<HTMLElement>('pre, code, [class*="overflow-x"]')].filter((e) => e.scrollWidth > e.clientWidth + 1 && !e.closest('details:not([open])'))
      .map((e) => `${e.tagName} ${e.scrollWidth}>${e.clientWidth} ${(e.textContent ?? '').slice(0, 60)}`)
    return { vertical: el.scrollHeight > el.clientHeight + 1, horizontal: inner }
  })
  expect(overflow, `${name}: panel still scrolls`).toEqual({ vertical: false, horizontal: [] })
  await assertNoToken(ctx)
  const text = await ctx.page.evaluate(() => (document.querySelector('[data-testid="settings-dialog"]') as HTMLElement).innerText)
  expect(text.includes(homedir()), `${name} shows the home directory`).toBe(false)
  await shot(ctx, name)
  const dialog = await boxOf(ctx, 'settings-dialog')
  // The capture profile has no OS keyring on purpose (the real one is never touched), so the Token tab warns
  // about it. Users with a keyring don't see that, so the Token images end above the warning, at the card edge.
  const cut = await ctx.page.evaluate(() => {
    const warn = [...document.querySelectorAll<HTMLElement>('[data-testid="settings-scroll"] *')]
      .filter((e) => /OS keyring is unavailable/.test(e.textContent ?? ''))
      .pop()
    if (!warn) return null
    // Up to the warning box: the last ancestor whose parent also holds the Bearer token card
    let el: HTMLElement = warn
    while (el.parentElement && !(el.parentElement.textContent ?? '').includes('Bearer token')) el = el.parentElement
    return el.getBoundingClientRect().top
  })
  if (cut !== null) dialog.height = cut - 4 - dialog.y
  await closeSettings(ctx)
  // The modal only, just inside its 1 px border: no dimmed app around it, so the site's frame is its edge.
  // Unrounded CSS px; optimize.mjs rounds at device scale (the dialog can sit on a half CSS pixel).
  const b = 1
  return [{ name: `${name}-modal`, source: name, box: { x: dialog.x + b, y: dialog.y + b, width: dialog.width - 2 * b, height: dialog.height - (cut === null ? 2 * b : b) } }]
}

const refOf = (snap: string, label: string): string => {
  const e = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`"${e}[^"]*" \\[ref=(e\\d+)\\]`).exec(snap)
  if (!m) throw new Error(`No ref for "${label}" in:\n${snap}`)
  return m[1]
}

async function demoSessions(ctx: AppCtx) {
  const admin = await makeSession(ctx, demo.base, 'Admin', 'Morgan%20Lee', 'admin', 'local', COLOR.blue)
  const customer = await makeSession(ctx, demo.base, 'Customer', 'Jamie%20Rivera', 'customer', 'local', COLOR.green)
  return { admin, customer }
}

async function prodSessions(ctx: AppCtx) {
  const guest = await makeSession(ctx, demo.base, 'Guest', 'Guest', 'guest', 'local', COLOR.yellow)
  const prod = await makeSession(ctx, demo.base, 'Prod Admin', 'Morgan%20Lee', 'admin', 'production', COLOR.red)
  await tabEval(ctx.app, prod.tabId, `location.href = ${JSON.stringify(`${demo.base}/app?env=prod`)}`)
  await waitFor(
    () => wm(ctx.app, (sf, id) => sf.windowManager.getTabState(id)?.url.endsWith('/app?env=prod'), prod.tabId),
    20_000,
    'prod tab on /app?env=prod'
  )
  return { guest, prod }
}

test('screenshots', async () => {
  // Only this test's files: extension/ belongs to the extension test
  await mkdir(SHOTS, { recursive: true })
  for (const f of await readdir(SHOTS)) if (f.endsWith('.png') || f === 'crops.json') await rm(join(SHOTS, f))
  await fetch(`${demo.base}/reset`, { method: 'POST' })
  const crops: Crop[] = []
  let client: Client | undefined
  // The real default MCP port, so the Editors snippets show 127.0.0.1:34568 as users will see it
  if (!(await portFree(34568))) throw new Error('Port 34568 is in use (a SessionForge is running?); quit it for the capture')
  const ctx = await launchApp({ ...onCaptureDisplay(['--force-device-scale-factor=2']), mcpPort: 34568 })
  try {
    await setContentSize(ctx.app, 1440, 900)
    const { admin, customer } = await demoSessions(ctx)
    const { guest, prod } = await prodSessions(ctx)
    await ctx.page.reload()
    await ctx.page.waitForSelector(`[data-testid="session-${prod.session.id}"]`)

    // 1. Two roles side by side
    await setMode(ctx, 'columns')
    await show(ctx, 'pane-1', admin.session.id)
    await show(ctx, 'pane-2', customer.session.id)
    await focus(ctx, 'pane-1')
    await settle(ctx)
    await shot(ctx, 'split-columns', 2880)

    // 2. New Session dialog (never submitted)
    await ctx.page.click('[data-testid="new-session"]')
    await ctx.page.waitForSelector('#name')
    await ctx.page.fill('#name', 'QA Tester')
    await ctx.page.click('form button[aria-label="Purple"]')
    await ctx.page.click('#env')
    await ctx.page.getByRole('option', { name: 'Staging' }).click()
    await sleep(500)
    await shot(ctx, 'new-session')
    for (let i = 0; i < 3 && (await ctx.page.locator('#name').count()); i++) {
      await ctx.page.keyboard.press('Escape')
      await sleep(300)
    }
    await expect(ctx.page.locator('#name')).toHaveCount(0)

    // 3. 2x2 grid with the production session (red PROD label), plus the session bar crop
    await setMode(ctx, 'grid')
    await show(ctx, 'pane-1', admin.session.id)
    await show(ctx, 'pane-2', customer.session.id)
    await show(ctx, 'pane-3', guest.session.id)
    await show(ctx, 'pane-4', prod.session.id)
    await focus(ctx, 'pane-4')
    await settle(ctx)
    await shot(ctx, 'grid', 2880)
    const bar = await boxOf(ctx, 'session-bar')
    const header1 = await boxOf(ctx, 'pane-header-pane-1')
    crops.push({
      name: 'session-bar',
      source: 'grid',
      box: { x: 0, y: 0, width: 1440, height: Math.round(header1.y + header1.height + 120) }
    })
    expect(bar.width).toBeGreaterThan(1000)

    // 4. Agent Bridge in action: Admin at Control, an MCP client drives pane 1
    await enableBridgeViaUi(ctx)
    await setGrant(ctx, admin.session.id, 'control')
    await setGrant(ctx, customer.session.id, 'read')
    await setMode(ctx, 'columns')
    await show(ctx, 'pane-1', admin.session.id)
    await show(ctx, 'pane-2', customer.session.id)
    await focus(ctx, 'pane-1')
    await settle(ctx, 300)
    client = await demoClient(ctx)
    expect((await call(client, 'list_sessions')).isError).toBe(false)
    const opened = await call(client, 'open', { session: 'Admin', url: `${demo.base}/app` })
    expect(opened.isError, opened.text).toBe(false)
    const snap = await call(client, 'snapshot', { session: 'Admin' })
    expect(snap.isError, snap.text).toBe(false)
    const typed = await call(client, 'type', { session: 'Admin', ref: refOf(snap.text, 'Search orders'), text: '1042' })
    expect(typed.isError, typed.text).toBe(false)
    await expect(ctx.page.locator('[data-testid="agent-indicator-pane-1"]')).toHaveText('🤖 Agent')
    await expect(ctx.page.locator('[data-testid="agent-stop-pane-1"]')).toBeVisible()
    await sleep(400)
    await shot(ctx, 'agent', 2880)
    const h = await boxOf(ctx, 'pane-header-pane-1')
    crops.push({
      name: 'agent-header',
      source: 'agent',
      box: { x: Math.round(h.x), y: Math.round(h.y), width: Math.round(h.width), height: Math.round(h.height + 260) }
    })

    // More real calls for the Activity tab: compare roles, read the console
    expect((await call(client, 'send_request_as', { sessions: ['Admin', 'Customer'], include_no_session: true, url: `${demo.base}/api/admin/orders` })).isError).toBe(false)
    expect((await call(client, 'console_logs', { session: 'Customer' })).isError).toBe(false)
    expect((await call(client, 'get_layout')).isError).toBe(false)

    // 5. Settings: the modal is sized to show the panel whole (no inner scrollbars), the window made tall
    // enough for it, then cropped to the modal itself.
    // One Settings image (Addendum 5): the modal at its normal width on MCP Server → Overview
    for (const [nav, sub, name] of [
      ['agent', 'overview', 'settings-overview']
    ] as const) {
      crops.push(...(await settingsShot(ctx, nav, sub, name)))
    }
    await writeFile(join(SHOTS, 'crops.json'), JSON.stringify({ scale: 2, crops }, null, 2))
  } finally {
    await client?.close().catch(() => undefined)
    await teardown(ctx)
  }
})

/** Captures frames on a background loop with real timestamps (Playwright video would miss the pane views). */
function recorder(ctx: AppCtx) {
  const frames: Array<{
    file: string
    t: number
    width: number
    views: Array<{ file: string; x: number; y: number; width: number; height: number }>
  }> = []
  let running = true
  const loop = (async () => {
    while (running) {
      const t = Date.now()
      const name = `f${String(frames.length).padStart(5, '0')}`
      // The shell and each visible pane view as separate JPEGs (q92, faster than PNG); encode-video.mjs composites them.
      // (capture() composites in a scratch window, which is too slow and flaky in a tight loop.)
      const parts = await wm(ctx.app, async (sf) => {
        const win = sf.window
        const shell = await win.webContents.capturePage()
        const views: Array<{ x: number; y: number; width: number; height: number; data: string }> = []
        for (const v of win.contentView.children) {
          if (!v.getVisible() || !('webContents' in v)) continue
          const img = await (v as Electron.WebContentsView).webContents.capturePage()
          views.push({ ...v.getBounds(), data: img.toJPEG(92).toString('base64') })
        }
        return { shell: shell.toJPEG(92).toString('base64'), width: win.getContentBounds().width, views }
      }).catch(() => null)
      if (!parts) continue
      await writeFile(join(FRAMES, `${name}-shell.jpg`), Buffer.from(parts.shell, 'base64'))
      const views = []
      for (const [i, v] of parts.views.entries()) {
        await writeFile(join(FRAMES, `${name}-v${i}.jpg`), Buffer.from(v.data, 'base64'))
        views.push({ file: `${name}-v${i}.jpg`, x: v.x, y: v.y, width: v.width, height: v.height })
      }
      frames.push({ file: `${name}-shell.jpg`, t, width: parts.width, views })
    }
  })()
  return {
    frames,
    mark: () => Date.now(),
    stop: async () => {
      running = false
      await loop
      return frames
    }
  }
}

test('video', async () => {
  await rm(FRAMES, { recursive: true, force: true })
  await mkdir(FRAMES, { recursive: true })
  await fetch(`${demo.base}/reset`, { method: 'POST' })
  let client: Client | undefined
  const ctx = await launchApp(onCaptureDisplay([]))
  try {
    await setContentSize(ctx.app, 1280, 800)
    const admin = await makeSession(ctx, demo.base, 'Admin', 'Morgan%20Lee', 'admin', 'local', COLOR.blue)
    // Sessions made through window.api show in the bar after a renderer reload, so make them all before recording
    const { guest, prod } = await prodSessions(ctx)
    await ctx.page.reload()
    await ctx.page.waitForSelector(`[data-testid="session-${prod.session.id}"]`)
    // Bridge on and Admin at Control before recording starts
    await enableBridgeViaUi(ctx)
    await setGrant(ctx, admin.session.id, 'control')
    await setMode(ctx, 'single')
    await show(ctx, 'pane-1', admin.session.id)
    await focus(ctx, 'pane-1')
    await settle(ctx, 800)
    client = await demoClient(ctx)
    await assertLocalOnly(ctx)

    const rec = recorder(ctx)
    const marks: Record<string, number> = {}
    marks.start = rec.mark()
    await sleep(2500)

    // New Session "Customer" (the focused pane already shows Admin, so no default page opens)
    await ctx.page.click('[data-testid="new-session"]')
    await ctx.page.waitForSelector('#name')
    await ctx.page.click('#name')
    await ctx.page.keyboard.type('Customer', { delay: 70 })
    await ctx.page.click('form button[aria-label="Green"]')
    await sleep(400)
    await ctx.page.click('form button[type="submit"]')
    await expect(ctx.page.locator('#name')).toHaveCount(0)
    const sessions = await ctx.page.evaluate(() => window.api.session.getAll())
    const customer = (sessions as Session[]).find((s) => s.name === 'Customer')
    if (!customer) throw new Error('Customer session not created')
    const tabId = await wm(
      ctx.app,
      async (sf, a) => (await sf.windowManager.createTab(a.id, a.url, { assign: 'none' })).id,
      { id: customer.id, url: `${demo.base}/login-as?user=Jamie%20Rivera&role=customer` }
    )
    await waitFor(
      () => wm(ctx.app, (sf, id) => { const s = sf.windowManager.getTabState(id); return !!s && !s.isLoading && s.url.endsWith('/app') }, tabId),
      20_000,
      'Customer logged in'
    )
    await setMode(ctx, 'columns')
    await show(ctx, 'pane-2', customer.id)
    await focus(ctx, 'pane-1')
    await setGrant(ctx, customer.id, 'read')
    await sleep(1500)
    await assertLocalOnly(ctx)

    // The agent: list, open, snapshot, search, refund. The Customer pane picks up the change.
    marks.agent = rec.mark()
    await call(client, 'list_sessions')
    await sleep(500)
    const opened = await call(client, 'open', { session: 'Admin', url: `${demo.base}/app` })
    expect(opened.isError, opened.text).toBe(false)
    await sleep(700)
    let snap = await call(client, 'snapshot', { session: 'Admin' })
    await sleep(600)
    await call(client, 'type', { session: 'Admin', ref: refOf(snap.text, 'Search orders'), text: '1042' })
    await sleep(1200)
    snap = await call(client, 'snapshot', { session: 'Admin' })
    const refund = /button "Refund" \[ref=(e\d+)\]/.exec(snap.text)
    if (!refund) throw new Error(`No Refund button in:\n${snap.text}`)
    marks.refund = rec.mark()
    const clicked = await call(client, 'click', { session: 'Admin', ref: refund[1] })
    expect(clicked.isError, clicked.text).toBe(false)
    await waitFor(
      () => tabEval<string>(ctx.app, tabId, `document.getElementById('status-1042')?.textContent ?? ''`).then((s) => s === 'Refunded'),
      10_000,
      'Customer pane shows Refunded'
    )
    await sleep(1800)
    const sent = await call(client, 'send_request_as', {
      sessions: ['Admin', 'Customer'],
      include_no_session: true,
      url: `${demo.base}/api/admin/orders`
    })
    expect(sent.isError, sent.text).toBe(false)
    await sleep(2200)

    // Four roles in a grid, one of them production
    marks.grid = rec.mark()
    await setMode(ctx, 'grid')
    await show(ctx, 'pane-3', guest.session.id)
    await show(ctx, 'pane-4', prod.session.id)
    await focus(ctx, 'pane-1')
    await assertLocalOnly(ctx)
    await sleep(3500)
    marks.end = rec.mark()
    const frames = await rec.stop()
    await assertLocalOnly(ctx)
    await writeFile(join(FRAMES, 'frames.json'), JSON.stringify({ marks, frames }, null, 2))
    expect(frames.length).toBeGreaterThan(60)
  } finally {
    await client?.close().catch(() => undefined)
    await teardown(ctx)
  }
})

/** The real extension popup, reached through CDP (an action popup is not a Playwright page). */
class Popup {
  private id = 0
  private waiters = new Map<number, (m: { result?: Record<string, unknown> }) => void>()
  private constructor(
    private cdp: CDPSession,
    private sessionId: string
  ) {
    cdp.on('Target.receivedMessageFromTarget', (e: { message: string }) => {
      const m = JSON.parse(e.message) as { id?: number; result?: Record<string, unknown> }
      if (m.id && this.waiters.has(m.id)) {
        this.waiters.get(m.id)!(m)
        this.waiters.delete(m.id)
      }
    })
  }

  /** Opens the toolbar popup for the active tab of `page` and attaches to it. */
  static async open(context: BrowserContext, page: Page, sw: Worker): Promise<Popup> {
    // openPopup needs Chrome's window focused; the SessionForge window may hold the X focus, so click first
    for (let attempt = 0; ; attempt++) {
      await page.bringToFront()
      await page.mouse.click(5, 5)
      const ok = await sw
        .evaluate(() => (chrome as unknown as { action: { openPopup: () => Promise<void> } }).action.openPopup())
        .then(() => true, () => false)
      if (ok) break
      if (attempt >= 5) throw new Error('Could not open the extension popup')
      await sleep(500)
    }
    const cdp = await context.newCDPSession(page)
    const target = await waitFor(async () => {
      const { targetInfos } = (await cdp.send('Target.getTargets')) as { targetInfos: Array<{ targetId: string; url: string }> }
      return targetInfos.find((t) => t.url.endsWith('/popup.html'))
    }, 10_000, 'extension popup')
    const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })) as { sessionId: string }
    return new Popup(cdp, sessionId)
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<{ result?: Record<string, unknown> }> {
    const id = ++this.id
    return new Promise((resolve) => {
      this.waiters.set(id, resolve)
      void this.cdp.send('Target.sendMessageToTarget', { sessionId: this.sessionId, message: JSON.stringify({ id, method, params }) })
    })
  }

  async eval<T>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    return (r.result?.result as { value: T }).value
  }

  async until(expression: string, what: string): Promise<void> {
    await waitFor(() => this.eval<boolean>(expression), 10_000, what)
  }

  /** Closes the popup (Chrome refuses openPopup while one is shown). */
  async close(): Promise<void> {
    await this.eval('window.close(), true').catch(() => undefined)
    await sleep(500)
    await this.cdp.detach().catch(() => undefined)
  }

  async shot(file: string): Promise<void> {
    await sleep(300)
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(file, Buffer.from(r.result!.data as string, 'base64'))
  }
}

test('extension', async () => {
  const chromePath = join(homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome')
  test.skip(!existsSync(chromePath) || !process.env.SF_CAPTURE_DISPLAY, 'needs Chrome for Testing and SF_CAPTURE_DISPLAY')
  const dir = join(SHOTS, 'extension')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  await fetch(`${demo.base}/reset`, { method: 'POST' })
  const signin = await startSignInStub()
  const tmp = await mkdtemp(join(tmpdir(), 'sessionforge-ext-capture-'))
  const browserLog = join(tmp, 'browser.log')
  let chromeCtx: BrowserContext | undefined
  const ctx = await launchApp({
    ...onCaptureDisplay(['--force-device-scale-factor=2']),
    env: {
      DISPLAY: process.env.SF_CAPTURE_DISPLAY!,
      WAYLAND_DISPLAY: '',
      SESSIONFORGE_TEST_GOOGLE_ORIGIN: signin.base,
      SESSIONFORGE_TEST_BROWSER_LOG: browserLog
    }
  })
  try {
    // A copy of the extension for this run. The code and UI are unchanged except for two things:
    // 1. the import port: README "Requirements" documents editing the two URLs and host_permissions when
    //    SessionForge uses another port. This test app's import server is on a free port, never the real 34567.
    // 2. localhost and google.com site access granted at install. It stands in for the user clicking
    //    Allow in Chrome's own permission prompt, which automation can't click. The temp Chrome profile has
    //    no Google cookies and never opens a Google page.
    const ext = join(tmp, 'extension')
    await cp(join(projectRoot, 'chrome-extension'), ext, { recursive: true })
    const popupJs = (await readFile(join(ext, 'popup.js'), 'utf8'))
      .replace("'http://127.0.0.1:34567/import'", `'http://127.0.0.1:${ctx.importPort}/import'`)
      .replace("'http://127.0.0.1:34567/pending'", `'http://127.0.0.1:${ctx.importPort}/pending'`)
    expect(popupJs).toContain(`127.0.0.1:${ctx.importPort}/import`)
    await writeFile(join(ext, 'popup.js'), popupJs)
    const manifest = JSON.parse(await readFile(join(ext, 'manifest.json'), 'utf8')) as { host_permissions: string[] }
    manifest.host_permissions = [`http://127.0.0.1:${ctx.importPort}/*`, '*://localhost/*', '*://*.google.com/*']
    await writeFile(join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2))

    chromeCtx = await chromium.launchPersistentContext(join(tmp, 'chrome-profile'), {
      executablePath: chromePath,
      headless: false,
      viewport: { width: 900, height: 640 },
      args: [
        `--disable-extensions-except=${ext}`,
        `--load-extension=${ext}`,
        '--ozone-platform=x11',
        '--force-device-scale-factor=2',
        // The popup's daily version check would ask api.github.com; keep this run offline
        '--host-resolver-rules=MAP api.github.com ~NOTFOUND'
      ],
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'WAYLAND_DISPLAY')), DISPLAY: process.env.SF_CAPTURE_DISPLAY! } as Record<string, string>
    })
    const sw = chromeCtx.serviceWorkers()[0] ?? (await chromeCtx.waitForEvent('serviceworker'))
    const tab = chromeCtx.pages()[0] ?? (await chromeCtx.newPage())
    const chromeUrls: string[] = []
    chromeCtx.on('request', (r) => chromeUrls.push(r.url()))

    // Log in to the demo app in Chrome as the Customer
    await tab.goto(`${demo.base}/login-as?user=Jamie%20Rivera&role=customer`)
    await tab.waitForURL('**/app')

    // 1. First run: the consent notice
    let popup = await Popup.open(chromeCtx, tab, sw)
    await popup.until(`getComputedStyle(document.getElementById('consent')).display !== 'none'`, 'consent shown')
    await popup.shot(join(dir, 'popup-consent.png'))
    // 2. Agree, then ready to send
    await popup.eval(`document.getElementById('agree-btn').click()`)
    await popup.until(`document.getElementById('current-url').textContent === 'localhost'`, 'main view')
    await popup.shot(join(dir, 'popup-ready.png'))
    // 3. Send: a new session opens in a pane
    await popup.eval(`document.getElementById('import-btn').click()`)
    await popup.until(`document.getElementById('status').className.includes('success')`, 'sent')
    await popup.shot(join(dir, 'popup-sent.png'))
    const imported = await waitFor(
      () => ctx.page.evaluate(() => window.api.session.getAll()).then((all) => all.find((s) => s.name === 'localhost')),
      15_000,
      'imported session'
    )
    await settle(ctx, 800)
    await assertLocalOnly(ctx)
    await capture(ctx.app, 'site/extension/app-imported')

    await popup.close()

    // 4. Sign in with Chrome: a session that needs a (stand-in) Google login
    const admin = (await ctx.page.evaluate((i) => window.api.session.create(i), { name: 'Admin', color: COLOR.blue, env: 'local' })) as Session
    await ctx.page.reload()
    await ctx.page.waitForSelector(`[data-testid="session-${admin.id}"]`)
    await setMode(ctx, 'columns')
    const adminTab = await wm(
      ctx.app,
      async (sf, a) => (await sf.windowManager.createTab(a.id, a.url, { assign: 'none' })).id,
      { id: admin.id, url: `${signin.base}/ServiceLogin?service=mail&continue=${encodeURIComponent(`${signin.base}/continue?to=${encodeURIComponent(`${demo.base}/app`)}`)}` }
    )
    await ctx.page.evaluate((a) => window.api.layout.assignTab('pane-1', a), adminTab)
    await show(ctx, 'pane-2', imported.id)
    await focus(ctx, 'pane-1')
    await ctx.page.waitForSelector('[data-testid="signin-banner-pane-1"][data-state="offer"]')
    await settle(ctx, 600)
    await assertLocalOnly(ctx)
    await capture(ctx.app, 'site/extension/app-signin-banner')
    const bannerBox = await boxOf(ctx, 'signin-banner-pane-1')
    const headerBox = await boxOf(ctx, 'pane-header-pane-1')
    await ctx.page.click('[data-testid="signin-start-pane-1"]')
    await ctx.page.waitForSelector('[data-testid="signin-banner-pane-1"][data-state="waiting"]')
    await sleep(500)
    await capture(ctx.app, 'site/extension/app-signin-waiting')
    // SessionForge "opened" this URL in the browser (written to the test log instead)
    const opened = await waitFor(async () => (existsSync(browserLog) ? (await readFile(browserLog, 'utf8')).trim().split('\n')[0] : ''), 10_000, 'browser log')
    const openedUrl = (JSON.parse(opened) as { url: string }).url
    expect(openedUrl.startsWith(signin.base)).toBe(true)
    // In Chrome: the sign-in page, then "signing in" (the demo app sets the Admin cookie on localhost)
    await tab.goto(openedUrl)
    await tab.goto(`${demo.base}/login-as?user=Morgan%20Lee&role=admin`)
    await tab.waitForURL('**/app')
    // 5. The popup offers the waiting session
    popup = await Popup.open(chromeCtx, tab, sw)
    await popup.until(`document.querySelectorAll('.pending-btn').length === 1`, 'request button')
    await popup.shot(join(dir, 'popup-request.png'))
    await popup.eval(`document.querySelector('.pending-btn').click()`)
    await popup.until(`document.getElementById('status').className.includes('success')`, 'request sent')
    await popup.shot(join(dir, 'popup-request-sent.png'))
    await waitFor(
      () => wm(ctx.app, (sf, id) => { const s = sf.windowManager.getTabState(id); return !!s && !s.isLoading && !s.url.includes('/signin/') && !s.url.includes('ServiceLogin') ? s.url : null }, adminTab),
      15_000,
      'Admin pane left the sign-in page'
    ).then((url) => {
      console.log('[capture] Admin pane after the hand-off:', url)
      expect(url.startsWith(demo.base), `pane went to ${url}`).toBe(true)
    })
    await settle(ctx, 800)
    await assertLocalOnly(ctx)
    await capture(ctx.app, 'site/extension/app-signin-done')
    // Nothing in this run left the machine
    const external = chromeUrls.filter((u) => !/^(http:\/\/(localhost|127\.0\.0\.1)[:/]|chrome-extension:|about:|data:|chrome:)/.test(u))
    expect(external, external.join('\n')).toEqual([])
    await writeFile(join(dir, 'crops.json'), JSON.stringify({ scale: 2, banner: bannerBox, header: headerBox }, null, 2))
  } finally {
    await chromeCtx?.close().catch(() => undefined)
    await teardown(ctx)
    await signin.close()
    await rm(tmp, { recursive: true, force: true })
  }
})
