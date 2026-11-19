// Agent Bridge functional tests (design §21.3 F1–F13): the official MCP SDK client over HTTP and
// over the stdio bridge, against a local test app. Temp profile, free ports, no internet.
import { test, expect } from '@playwright/test'
import { connect } from 'node:net'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { launchApp, relaunch, teardown, waitFor, wm, type AppCtx } from './fixtures/app'
import { capture } from './fixtures/capture'
import { startAgentTestServer, type AgentTestServer } from './fixtures/agent-test-server'
import {
  TOOL_NAMES,
  bridgeToken,
  call,
  closeSettings,
  enableBridgeViaUi,
  httpClient,
  makeSession,
  openSettings,
  setGrant,
  stdioClient
} from './fixtures/mcp'
import type { Session } from '../src/main/types'

test.describe.configure({ mode: 'serial' })

let ctx: AppCtx
let server: AgentTestServer
let client: Client
let alice: Session
let bob: Session
let aliceTab: string

const SECRETS = ['page-secret', 'alice-secret-cookie', 'bob-secret-cookie']

const refOf = (snap: string, label: string): string => {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`"${esc}[^"]*" \\[ref=(e\\d+)\\]`).exec(snap)
  if (!m) throw new Error(`No ref for "${label}" in:\n${snap}`)
  return m[1]
}

const tabsOf = (sessionId: string) =>
  wm(ctx.app, (sf, id) => sf.windowManager.listTabs().filter((t) => t.sessionId === id).map((t) => t.id), sessionId)

const pngWidth = (b64: string) => {
  const b = Buffer.from(b64, 'base64')
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return b.readUInt32BE(16)
}

const portRefused = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = connect(port, '127.0.0.1')
    s.once('connect', () => {
      s.destroy()
      resolve(false)
    })
    s.once('error', () => resolve(true))
  })

async function snapshot(session = 'Alice'): Promise<string> {
  const r = await call(client, 'snapshot', { session })
  expect(r.isError, r.text).toBe(false)
  return r.text
}

test.beforeAll(async () => {
  server = await startAgentTestServer()
  ctx = await launchApp()
  alice = (await makeSession(ctx, server.base, 'Alice', 'alice', 'admin', 'local', '#ef4444')).session
  bob = (await makeSession(ctx, server.base, 'Bob', 'bob', 'customer', 'local', '#3b82f6')).session
  await ctx.page.reload()
  await ctx.page.waitForSelector(`[data-testid="session-${bob.id}"]`)
})

test.afterAll(async () => {
  await client?.close().catch(() => undefined)
  await teardown(ctx)
  await server?.close()
})

test('F1: disabled by default', async () => {
  expect(await ctx.page.evaluate(() => window.api.agent.getStatus().then((s) => s.enabled))).toBe(false)
  expect(await portRefused(ctx.mcpPort)).toBe(true)
  await openSettings(ctx)
  await expect(ctx.page.locator('[data-testid="agent-enable"]')).toHaveAttribute('aria-checked', 'false')
  await expect(ctx.page.locator('[data-testid="agent-status"]')).toHaveText('Off')
  await closeSettings(ctx)
  expect(await wm(ctx.app, (sf, id) => sf.agentBridge.hubSubscriberCountForTest(id), alice.id)).toBe(0)
})

test('F2: enable via the UI, connect, list tools and sessions', async () => {
  await enableBridgeViaUi(ctx)
  client = await httpClient(ctx)
  const { tools } = await client.listTools()
  expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort())
  for (const t of tools) expect(t.description!.length, t.name).toBeLessThan(300)
  // Codex's default `auto` mode must keep prompting for every tool that is not read-only
  for (const t of tools) {
    const a = t.annotations
    expect(a?.readOnlyHint === true || a?.openWorldHint !== false || a?.destructiveHint !== false, t.name).toBe(true)
  }
  // The read-only approval preset uses exactly the tools annotated readOnlyHint
  const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name)
  expect(readOnly.sort()).toEqual(
    ['console_logs', 'get_layout', 'list_sessions', 'network_log', 'screenshot', 'snapshot', 'wait_for'].sort()
  )
  const r = await call(client, 'list_sessions')
  expect(r.text).toContain('<untrusted_page_content>')
  const names = r.json.sessions.map((s: { name: string; agent_access: string }) => [s.name, s.agent_access])
  expect(names).toEqual([
    ['Alice', 'read'],
    ['Bob', 'read']
  ])
  expect(await wm(ctx.app, (sf, id) => sf.agentBridge.hubSubscriberCountForTest(id), alice.id)).toBe(1)
})

test('F3: open, snapshot, click a React, a shadow-DOM and an iframe button', async () => {
  await setGrant(ctx, alice.id, 'control')
  const before = server.hits.filter((h) => h.path === '/api/clicked').length
  const o = await call(client, 'open', { session: 'Alice', url: `${server.base}/app` })
  expect(o.isError, o.text).toBe(false)
  expect(o.json).toMatchObject({ pane: 1, load: 'loaded', visible: true })
  aliceTab = o.json.tab_id

  const s1 = await snapshot()
  for (const label of ['React clicks: 0', 'Shadow button', 'Frame button']) {
    const c = await call(client, 'click', { session: 'Alice', ref: refOf(s1, label) })
    expect(c.isError, c.text).toBe(false)
    expect(c.json.clicked).toBe(true)
  }
  const s2 = await snapshot()
  expect(s2).toContain('React clicks: 1')
  expect(s2).toContain('shadow:1')
  expect(s2).toContain('frame:1')
  // Refs stay stable for the same element
  expect(refOf(s2, 'Shadow button')).toBe(refOf(s1, 'Shadow button'))
  await waitFor(
    () => server.hits.filter((h) => h.path === '/api/clicked' && h.user === 'alice').length > before,
    5000,
    'click reached the test server'
  )
})

test('F3: attach race, tab reuse and new_tab', async () => {
  await setGrant(ctx, bob.id, 'control')
  const l = await call(client, 'set_layout', { mode: 'single', panes: [{ pane: 1, session: 'Bob' }] })
  expect(l.isError, l.text).toBe(false)
  const o = await call(client, 'open', { session: 'Alice', url: `${server.base}/app`, wait_until: 'none' })
  expect(o.isError, o.text).toBe(false)
  expect(o.json).toMatchObject({ pane: 2, visible: true, reused: true, tab_id: aliceTab })
  // No sleep: the view is attached, so input is accepted (the page may still be loading)
  const c = await call(client, 'click', { session: 'Alice', selector: 'h1' })
  expect(c.text).not.toContain('not_visible')
  expect(c.text).not.toContain('ui_busy')
  await call(client, 'wait_for', { session: 'Alice', text: 'React clicks', timeout_ms: 10_000 })

  const again = await call(client, 'open', { session: 'Alice', url: `${server.base}/app` })
  expect(again.json).toMatchObject({ reused: true, tab_id: aliceTab })
  expect(await tabsOf(alice.id)).toHaveLength(1)
  const extra = await call(client, 'open', { session: 'Alice', url: `${server.base}/login`, new_tab: true })
  expect(extra.json.reused).toBe(false)
  expect(await tabsOf(alice.id)).toHaveLength(2)

  // navigate / back / reload (F3b) run on the new tab, then it is closed again
  const nav = await call(client, 'navigate', { session: 'Alice', tab: extra.json.tab_id, url: `${server.base}/frame` })
  expect(nav.json.load).toBe('loaded')
  expect(nav.json.url).toMatch(/\/frame$/)
  const back = await call(client, 'back', { session: 'Alice', tab: extra.json.tab_id })
  expect(back.json).toMatchObject({ navigated: true })
  expect(back.json.url).toMatch(/\/login$/)
  const rel = await call(client, 'reload', { session: 'Alice', tab: extra.json.tab_id })
  expect(rel.json.load).toBe('loaded')
  await ctx.page.evaluate((id) => window.api.tab.close(id), extra.json.tab_id as string)

  const fresh = await call(client, 'open', { session: 'Alice', url: `${server.base}/login`, new_tab: true })
  const noBack = await call(client, 'back', { session: 'Alice', tab: fresh.json.tab_id })
  expect(noBack.json.navigated).toBe(false)
  await ctx.page.evaluate((id) => window.api.tab.close(id), fresh.json.tab_id as string)
  await call(client, 'open', { session: 'Alice', url: `${server.base}/app` })
  expect(await tabsOf(alice.id)).toEqual([aliceTab])
})

test('F4: type, select and press', async () => {
  const s = await snapshot()
  const input = refOf(s, 'Name')
  const t = await call(client, 'type', { session: 'Alice', ref: input, text: 'hello', submit: true })
  expect(t.isError, t.text).toBe(false)
  expect(await snapshot()).toContain('typed:hello enters:1')
  const sel = await call(client, 'select', { session: 'Alice', ref: refOf(s, 'Plan'), values: ['Beta'] })
  expect(sel.json.selected).toEqual(['b'])
  expect(await snapshot()).toContain('sel:b')
  const p1 = await call(client, 'press', { session: 'Alice', key: 'a', modifiers: ['Control'], ref: input })
  expect(p1.isError, p1.text).toBe(false)
  await call(client, 'press', { session: 'Alice', key: 'Backspace' })
  expect(await snapshot()).toContain('typed: enters:1')
  const count = (await tabsOf(alice.id)).length
  const bad = await call(client, 'press', { session: 'Alice', key: 'w', modifiers: ['Control'] })
  expect(bad.isError).toBe(true)
  expect(bad.text).toContain('ERROR invalid_key')
  expect((await tabsOf(alice.id)).length).toBe(count)
})

test('F5: wait_for success and timeout', async () => {
  await call(client, 'reload', { session: 'Alice' })
  const t0 = Date.now()
  const ok = await call(client, 'wait_for', { session: 'Alice', text: 'ready' })
  expect(ok.isError, ok.text).toBe(false)
  expect(ok.json.matched).toBe(true)
  expect(Date.now() - t0).toBeLessThan(3000)
  const to = await call(client, 'wait_for', { session: 'Alice', text: 'never', timeout_ms: 500 })
  expect(to.isError).toBe(true)
  expect(to.text).toContain('ERROR timeout')
})

test('F6: console_logs and network_log', async () => {
  const c = await call(client, 'console_logs', { session: 'Alice' })
  const entries = c.json.entries as Array<{ level: string; message: string }>
  expect(entries.some((e) => e.level === 'info' && e.message === 'hello from agent page')).toBe(true)
  expect(entries.some((e) => e.level === 'error' && e.message === 'agent page error')).toBe(true)
  const none = await call(client, 'console_logs', { session: 'Alice', since: c.json.next_cursor })
  expect(none.json.entries).toEqual([])

  const s = await snapshot()
  await call(client, 'click', { session: 'Alice', ref: refOf(s, 'React clicks') })
  const n = await waitFor(async () => {
    const r = await call(client, 'network_log', { session: 'Alice', include_headers: true })
    return r.json.entries.some((e: { url: string }) => e.url.endsWith('/api/clicked')) ? r : null
  })
  const all = n.json.entries as Array<Record<string, any>>
  expect(all.some((e) => e.method === 'GET' && e.url === `${server.base}/app` && e.status === 200 && e.type === 'mainFrame')).toBe(true)
  const clicked = all.filter((e) => e.url.endsWith('/api/clicked')).pop()!
  expect(clicked.request_headers.authorization).toBe('Bearer [redacted]')
  expect(clicked.request_headers.cookie).toContain('sid=[redacted]')
  expect(clicked.request_headers.cookie).toContain('role=[redacted]')
  for (const secret of SECRETS) expect(n.text).not.toContain(secret)
})

test('F7: send_request_as as two sessions and no session', async () => {
  const who = await call(client, 'send_request_as', {
    sessions: ['Alice', 'Bob'],
    include_no_session: true,
    method: 'GET',
    url: `${server.base}/api/whoami`
  })
  expect(who.isError, who.text).toBe(false)
  const cols = who.json.columns as Array<Record<string, any>>
  expect(cols.map((c) => JSON.parse(c.body).user)).toEqual(['alice', 'bob', null])
  expect(who.text).toContain('body differs')
  expect(String(cols[0].headers['set-cookie'])).toContain('seen=[redacted]')
  const whoHits = server.hits.filter((h) => h.path === '/api/whoami').slice(-3).map((h) => h.user)
  expect(whoHits.sort()).toEqual(['alice', 'bob', null].sort())

  const admin = await call(client, 'send_request_as', { sessions: ['Alice', 'Bob'], url: `${server.base}/api/admin` })
  expect(admin.json.columns.map((c: { status: number }) => c.status)).toEqual([200, 403])
  expect(admin.text).toContain('status differs from Alice (403 vs 200)')

  const redir = await call(client, 'send_request_as', { sessions: ['Alice'], url: `${server.base}/redirect` })
  expect(redir.text).toContain('302 -> /login')
  const follow = await call(client, 'send_request_as', { sessions: ['Alice'], url: `${server.base}/redirect`, follow_redirects: true })
  expect(follow.json.columns[0].status).toBe(200)
  expect(follow.json.columns[0].hops).toHaveLength(1)

  await setGrant(ctx, bob.id, 'read')
  const post = await call(client, 'send_request_as', {
    sessions: ['Alice', 'Bob'],
    method: 'POST',
    url: `${server.base}/api/echo`,
    headers: { 'Content-Type': 'application/json' },
    body: '{"a":1}'
  })
  expect(post.json.columns[0].status).toBe(200)
  expect(post.json.columns[1].error).toBe('permission_denied')
  for (const s of SECRETS) expect(who.text + admin.text + post.text).not.toContain(s)
})

test('F8: set_layout to 2 panes and get_layout', async () => {
  await setGrant(ctx, bob.id, 'control')
  const r = await call(client, 'set_layout', {
    mode: 'columns',
    panes: [
      { pane: 1, session: 'Alice' },
      { pane: 2, session: 'Bob' }
    ]
  })
  expect(r.isError, r.text).toBe(false)
  expect(r.json.visible).toEqual({ '1': true, '2': true })
  // Alice's tab moved from pane 2 to pane 1; no extra tab (and no internet page) was created
  expect(await tabsOf(alice.id)).toEqual([aliceTab])
  const g = await call(client, 'get_layout')
  expect(g.json.mode).toBe('columns')
  expect(g.json.panes.map((p: { pane: number; session: string }) => [p.pane, p.session])).toEqual([
    [1, 'Alice'],
    [2, 'Bob']
  ])
  await expect(ctx.page.locator('[data-testid="pane-header-pane-1"]')).toContainText('Alice')
  await expect(ctx.page.locator('[data-testid="pane-header-pane-2"]')).toContainText('Bob')
})

test('F9: screenshot returns a PNG of a pane and of all panes', async () => {
  const views = await wm(ctx.app, (sf) => sf.windowManager.getAttachedPaneViews().map((v) => v.bounds))
  const single = await call(client, 'screenshot', { session: 'Alice', max_width: 2560 })
  expect(single.isError, single.text).toBe(false)
  expect(single.images[0].mimeType).toBe('image/png')
  const aliceView = await wm(ctx.app, (sf) => sf.windowManager.getAttachedPaneViews().find((v) => v.paneId === 'pane-1')!.bounds)
  expect(Math.abs(pngWidth(single.images[0].data) - aliceView.width)).toBeLessThanOrEqual(2)

  const all = await call(client, 'screenshot', { all_panes: true, max_width: 2560 })
  const union = Math.max(...views.map((v) => v.x + v.width)) - Math.min(...views.map((v) => v.x))
  expect(Math.abs(pngWidth(all.images[0].data) - union)).toBeLessThanOrEqual(2)
  expect(all.text).toContain('pane 1: Alice')

  const def = await call(client, 'screenshot', { all_panes: true })
  expect(pngWidth(def.images[0].data)).toBe(Math.min(union, 1280))
  const defSingle = await call(client, 'screenshot', { session: 'Alice' })
  expect(Math.abs(pngWidth(defSingle.images[0].data) - Math.min(aliceView.width, 1280))).toBeLessThanOrEqual(2)
})

test('F10: stdio bridge lists tools, reports "not running", replays after re-enable', async () => {
  const token = await bridgeToken(ctx)
  const stdio = await stdioClient(ctx, token)
  try {
    expect((await stdio.listTools()).tools).toHaveLength(17)
    const r = await call(stdio, 'list_sessions')
    expect(r.json.sessions).toHaveLength(2)

    await ctx.page.evaluate(() => window.api.agent.setEnabled(false))
    let msg = ''
    await stdioClient(ctx, token).then(
      (c) => c.close(),
      (e: Error) => (msg = e.message)
    )
    expect(msg).toContain('not running, or the Agent Bridge is turned off')

    await ctx.page.evaluate(() => window.api.agent.setEnabled(true))
    await waitFor(() => ctx.page.evaluate(() => window.api.agent.getStatus().then((s) => s.state === 'listening')))
    const after = await call(stdio, 'list_sessions')
    expect(after.isError, after.text).toBe(false)
    expect(after.json.sessions).toHaveLength(2)
  } finally {
    await stdio.close()
  }
  // The HTTP client's MCP session ended with the restart; make a new one
  await client.close().catch(() => undefined)
  client = await httpClient(ctx)
})

test('F11: agent indicator and Stop in the pane header, and the settings panel', async () => {
  await setGrant(ctx, alice.id, 'control')
  await setGrant(ctx, bob.id, 'control')
  const waiting = call(client, 'wait_for', { session: 'Alice', text: 'never', timeout_ms: 8000 })
  await expect(ctx.page.locator('[data-testid="agent-indicator-pane-1"]')).toHaveText('🤖 Agent')
  await expect(ctx.page.locator('[data-testid="agent-stop-pane-1"]')).toBeVisible()

  const slow = call(client, 'send_request_as', { sessions: ['Bob'], method: 'POST', url: `${server.base}/slow` })
  await expect(ctx.page.locator('[data-testid="agent-indicator-pane-2"]')).toBeVisible()
  await expect(ctx.page.locator('[data-testid="agent-stop-pane-2"]')).toBeVisible()
  await capture(ctx.app, 'agent-bridge-indicator')
  expect((await slow).json.columns[0].status).toBe(200)

  await openSettings(ctx, 'activity')
  await ctx.page.waitForSelector('[data-testid="agent-activity-row"]')
  await ctx.page.waitForTimeout(300) // dialog open animation and autofocus settle first
  await expect(ctx.page.locator('[data-testid="agent-activity-row"]').first()).toBeVisible()
  await capture(ctx.app, 'agent-bridge-settings')
  await ctx.page.click('[data-testid="settings-subtab-overview"]')
  await expect(ctx.page.locator('[data-testid="agent-status"]')).toContainText('Listening on')
  await capture(ctx.app, 'agent-bridge-settings-top')
  await closeSettings(ctx)
  // Closing Settings returns focus to the gear button, so no session button gets a focus ring
  expect(await ctx.page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('open-settings')
  expect((await waiting).text).toContain('ERROR timeout')
})

test('F12: activity rows have outcomes and no secrets', async () => {
  const entries = await ctx.page.evaluate(() => window.api.agent.getActivity())
  expect(entries.length).toBeGreaterThan(10)
  expect(entries.some((e) => e.outcome === 'ok')).toBe(true)
  expect(entries.some((e) => e.outcome === 'error')).toBe(true)
  await openSettings(ctx, 'activity')
  const rows = await ctx.page.locator('[data-testid="agent-activity-row"]').allTextContents()
  // Argument rows are always in the DOM (hidden until expanded), so their text is checked too
  const args = await ctx.page.locator('[data-testid="agent-activity-args"]').allTextContents()
  expect(args.length).toBe(rows.length)
  rows.push(...args)
  await closeSettings(ctx)
  expect(rows.length).toBeGreaterThan(20)
  expect(entries.some((e) => e.client === 'e2e-http 1.0.0')).toBe(true)
  const token = await bridgeToken(ctx)
  const all = JSON.stringify(entries) + rows.join('\n')
  for (const s of [...SECRETS, token]) expect(all).not.toContain(s)
})

test('F13: rotation gives 401 to an existing client and the new token works', async () => {
  const token = await bridgeToken(ctx)
  expect((await call(client, 'list_sessions')).isError).toBe(false)
  await ctx.page.evaluate(() => window.api.agent.rotateToken())
  await expect(call(client, 'list_sessions')).rejects.toThrow(/401|Unauthorized|token/i)
  const fresh = await bridgeToken(ctx)
  expect(fresh).not.toBe(token)
  expect(fresh).toMatch(/^sfa_[A-Za-z0-9_-]{43}$/)
  client = await httpClient(ctx, fresh)
  expect((await call(client, 'list_sessions')).isError).toBe(false)
  await expect(httpClient(ctx, token)).rejects.toThrow()
})

test('F13: the token survives a relaunch (needs the OS keyring)', async () => {
  const available = await wm(ctx.app, (_sf, _a, { safeStorage }) => safeStorage.isEncryptionAvailable())
  // Playwright launches Electron with XDG_CURRENT_DESKTOP=Unity, and Chromium then uses the basic_text
  // store; a normal desktop launch on this machine uses gnome_libsecret (see verification.md)
  if (!available) console.log('[F13] skipped: safeStorage (OS keyring) is not available in this launch')
  test.skip(!available, 'safeStorage (OS keyring) is not available in this launch')
  const token = await bridgeToken(ctx)
  await client.close().catch(() => undefined)
  ctx = await relaunch(ctx)
  await waitFor(() => ctx.page.evaluate(() => window.api.agent.getStatus().then((s) => s.state === 'listening')))
  client = await httpClient(ctx, token)
  expect((await call(client, 'list_sessions')).isError).toBe(false)
})
