// Real screenshots and demo video frames of SessionForge for the website (site/assets/).
// Temp profile, free ports, SESSIONFORGE_E2E=1 and the local "Acme Admin" demo app only. Never the real
// profile, never a real site, never the real bridge token on screen.
// Run: npm run electron:build && npm run rebuild:native && npx playwright test -c site/tools/capture/playwright.config.ts
import { test, expect } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { launchApp, tabEval, teardown, waitFor, wm, type AppCtx } from '../../../e2e/fixtures/app'
import { capture, screenshotDir } from '../../../e2e/fixtures/capture'
import { setContentSize } from '../../../e2e/fixtures/ui'
import {
  bridgeToken,
  call,
  closeSettings,
  enableBridgeViaUi,
  httpClient,
  makeSession,
  openSettings,
  setGrant
} from '../../../e2e/fixtures/mcp'
import type { LayoutMode, PaneId, Session } from '../../../src/main/types'
import { startDemoApp, type DemoApp } from './demo-app'

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
  const prod = await makeSession(ctx, demo.base, 'Admin (prod)', 'Morgan%20Lee', 'admin', 'production', COLOR.red)
  await tabEval(ctx.app, prod.tabId, `location.href = ${JSON.stringify(`${demo.base}/app?env=prod`)}`)
  await waitFor(
    () => wm(ctx.app, (sf, id) => sf.windowManager.getTabState(id)?.url.endsWith('/app?env=prod'), prod.tabId),
    20_000,
    'prod tab on /app?env=prod'
  )
  return { guest, prod }
}

test('screenshots', async () => {
  await rm(SHOTS, { recursive: true, force: true })
  await mkdir(SHOTS, { recursive: true })
  await fetch(`${demo.base}/reset`, { method: 'POST' })
  const crops: Crop[] = []
  let client: Client | undefined
  const ctx = await launchApp(onCaptureDisplay(['--force-device-scale-factor=2']))
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
    client = await httpClient(ctx)
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

    // 5-6. Settings > MCP Server, Overview and Editors (token masked)
    await openSettings(ctx, 'overview')
    await ctx.page.waitForSelector('[data-testid="agent-status"]:has-text("Listening on")')
    await sleep(500)
    await assertNoToken(ctx)
    await shot(ctx, 'settings-mcp')
    await closeSettings(ctx)
    await openSettings(ctx, 'editors')
    await sleep(500)
    await assertNoToken(ctx)
    await shot(ctx, 'settings-editors')
    await closeSettings(ctx)

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
    client = await httpClient(ctx)
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
