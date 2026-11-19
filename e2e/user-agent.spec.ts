import { test, expect } from '@playwright/test'
import { launchApp, tabEval, teardown, wm, type AppCtx } from './fixtures/app'
import { capture } from './fixtures/capture'
import { startTestServer, type TestServer } from './fixtures/test-server'
import { createHiddenTab, createSessions, openSession, waitLoaded, waitViewOnSlot } from './fixtures/ui'

test.describe.configure({ mode: 'serial' })

const CHROME_UA =
  /^Mozilla\/5\.0 \(.+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/
const NOT_APP = /Electron|sessionforge/i

let ctx: AppCtx
let server: TestServer
let tabId: string

function expectChromeUa(ua: string | undefined, where: string) {
  expect(ua, where).toMatch(CHROME_UA)
  expect(ua, where).toContain('Chrome/134.')
  expect(ua, where).not.toMatch(NOT_APP)
}

test.beforeAll(async () => {
  server = await startTestServer()
  ctx = await launchApp()
  const [A] = await createSessions(ctx.page, [{ name: 'UA session', color: '#3b82f6' }])
  tabId = await createHiddenTab(ctx.app, A.id, `${server.base}/headers`)
  await openSession(ctx.page, 'pane-1', A.id)
  await waitLoaded(ctx.page, tabId, `${server.base}/headers`, 'Headers')
})

test.afterAll(async () => {
  await teardown(ctx)
  await server?.close()
})

test('server-seen User-Agent and navigator.userAgent are the reduced Chrome UA', async () => {
  const seen = server.lastHeaders.get('/headers')?.['user-agent']
  expectChromeUa(seen, 'server-seen User-Agent')
  const nav = await tabEval<string>(ctx.app, tabId, 'navigator.userAgent')
  expectChromeUa(nav, 'navigator.userAgent')
  expect(nav).toBe(seen)
  // The page echoes the header it received
  expect(await tabEval<string>(ctx.app, tabId, 'document.getElementById("ua").textContent')).toBe(seen)

  await waitViewOnSlot(ctx.app, ctx.page, tabId, 'pane-1')
  await capture(ctx.app, 'user-agent-headers')
})

test('window.__ua recorded by the first page script matches too', async () => {
  await ctx.page.evaluate(([id, url]) => window.api.tab.navigate(id, url), [tabId, `${server.base}/page?label=B`])
  await waitLoaded(ctx.page, tabId, `${server.base}/page`, 'Page B')
  expectChromeUa(await tabEval<string>(ctx.app, tabId, 'window.__ua'), 'window.__ua')
  expectChromeUa(server.lastHeaders.get('/page')?.['user-agent'], 'server-seen /page User-Agent')
})

test('the shell and the default session use the same UA (app.userAgentFallback)', async () => {
  expectChromeUa(await ctx.page.evaluate(() => navigator.userAgent), 'shell navigator.userAgent')
  expectChromeUa(await wm(ctx.app, (_sf, _a, { app }) => app.userAgentFallback), 'app.userAgentFallback')
})

// Task Addendum 5: client hints are checked as well. They come from Chromium and are not rewritten
// (no webRequest listener), so this records what they advertise and asserts Electron is not among them.
// Electron 35 sends no Sec-CH-UA request header at all (also without any UA override), so the header
// may be absent; if a later Electron sends it, it must not name Electron either.
test('Sec-CH-UA header and navigator.userAgentData.brands do not advertise Electron', async () => {
  const header = server.lastHeaders.get('/page')?.['sec-ch-ua']
  const brands = await tabEval<Array<{ brand: string; version: string }> | null>(
    ctx.app,
    tabId,
    'navigator.userAgentData ? navigator.userAgentData.brands : null'
  )
  console.log('[ua] Sec-CH-UA:', header ?? '(not sent)', '| userAgentData.brands:', JSON.stringify(brands))
  if (header !== undefined) expect(header).not.toMatch(NOT_APP)
  expect(brands).not.toBeNull()
  expect(brands!.map((b) => b.brand)).toContain('Chromium')
  expect(JSON.stringify(brands)).not.toMatch(NOT_APP)
})
