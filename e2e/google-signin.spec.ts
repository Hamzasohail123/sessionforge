// "Sign in with Chrome" hand-off, end to end without Google: the test server's localhost origin plays
// accounts.google.com (SESSIONFORGE_TEST_GOOGLE_ORIGIN, e2e only), its 127.0.0.1 origin plays the
// third-party site, and the browser launch is written to SESSIONFORGE_TEST_BROWSER_LOG.
import { test, expect } from '@playwright/test'
import { request } from 'node:http'
import { createServer, type Server } from 'node:net'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freePort, launchApp, projectRoot, tabEval, teardown, waitFor, wm, type AppCtx, type SfGlobal } from './fixtures/app'
import { capture } from './fixtures/capture'
import { startTestServer, type TestServer } from './fixtures/test-server'
import { httpClient } from './fixtures/mcp'
import {
  createHiddenTab,
  createSessions,
  getLayout,
  intersects,
  logsHaveTabNotFound,
  MOD,
  pressInTab,
  rectOf,
  setMode,
  tabOf,
  viewInfo,
  waitLoaded,
  waitViewOnSlot
} from './fixtures/ui'
import type { GoogleSignInCoordinator } from '../src/main/google-signin/coordinator'
import { GOOGLE_SIGNIN_AGENT_NOTE } from '../src/main/google-signin/match'
import type { LayoutMode, PaneId, Session } from '../src/main/types'
import { CHROME_EXTENSION_STORE_URL } from '../src/main/constants'

test.describe.configure({ mode: 'serial' })

type SfWithSignIn = SfGlobal & { googleSignIn: GoogleSignInCoordinator }

const OFFER_TEXT =
  "Google doesn't allow signing in inside embedded browsers like SessionForge. Sign in with Chrome and send the login back, two clicks."
const EXTENSION_TEXT = 'The SessionForge Import extension brings your existing Chrome login into this session.'
// Distinctive values, so the log check cannot match by accident
const SIGNIN_VALUE = 'SF-SIGNIN-7c1e9b'
const EVIL_VALUE = 'SF-EVIL-41d2'
const SITE_VALUE = 'SF-SITE-5a3f'

let ctx: AppCtx
let server: TestServer
let logDir: string
let browserLog: string
let gmail: Session
let other: Session
let site: Session
let gmailTab: string
let otherTab: string
let siteTab: string
let firstRequestId: string

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each endpoint replies with its own JSON; specs assert on it field by field
  json: any
}

/** node:http, so Host, Origin and Sec-Fetch-Mode are under test control. */
function http(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown; port?: number } = {}
): Promise<Reply> {
  const port = opts.port ?? ctx.importPort
  const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        setHost: false,
        headers: {
          host: `127.0.0.1:${port}`,
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}),
          ...opts.headers
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json: unknown = null
          try {
            json = text ? JSON.parse(text) : null
          } catch {
            json = null
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json })
        })
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}

const EXT = { origin: 'chrome-extension://abcdefghijklmnop', 'sec-fetch-mode': 'cors' }
const getPending = (headers: Record<string, string> = EXT) => http('GET', '/pending', { headers })
const postHandOff = (requestId: unknown, cookies: unknown[]) =>
  http('POST', '/import', { headers: EXT, body: { action: 'import', requestId, storageState: { cookies, origins: [] } } })

const signInUrl = (label: string) =>
  `${server.localBase}/ServiceLogin?service=mail&continue=${encodeURIComponent(`${server.localBase}/page?label=${label}`)}`

const banner = (paneId: PaneId) => ctx.page.locator(`[data-testid="signin-banner-${paneId}"]`)

async function browserLines(file = browserLog): Promise<Array<{ url: string; at: number }>> {
  const text = await readFile(file, 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

/** Every session with its cookie names and values, to prove a rejected hand-off changed nothing. */
async function snapshotSessions(): Promise<Record<string, string[]>> {
  return wm(ctx.app, async (sf) => {
    const out: Record<string, string[]> = {}
    for (const s of sf.sessionManager.getAllSessions()) {
      const cookies = await sf.sessionManager.getElectronSession(s.id)!.cookies.get({})
      out[`${s.name}|${s.id}`] = cookies.map((c) => `${c.domain}|${c.name}=${c.value}`).sort()
    }
    return out
  })
}

const assign = (paneId: PaneId, tabId: string) =>
  ctx.page.evaluate(([p, t]) => window.api.layout.assignTab(p as PaneId, t), [paneId, tabId] as const)

test.beforeAll(async () => {
  server = await startTestServer()
  logDir = await mkdtemp(join(tmpdir(), 'sessionforge-signin-'))
  browserLog = join(logDir, 'browser.log')
  ctx = await launchApp({
    env: { SESSIONFORGE_TEST_GOOGLE_ORIGIN: server.localBase, SESSIONFORGE_TEST_BROWSER_LOG: browserLog }
  })
  ;[gmail, other] = await createSessions(ctx.page, [
    { name: 'Gmail', color: '#ef4444' },
    { name: 'Other', color: '#3b82f6' }
  ])
  gmailTab = await createHiddenTab(ctx.app, gmail.id, `${server.base}/page?label=A`)
  otherTab = await createHiddenTab(ctx.app, other.id, `${server.base}/page?label=B`)
  await setMode(ctx.page, 'columns')
  await assign('pane-1', gmailTab)
  await assign('pane-2', otherTab)
  await waitLoaded(ctx.page, gmailTab, `${server.base}/page`, 'Page A')
  await waitLoaded(ctx.page, otherTab, `${server.base}/page`, 'Page B')
})

test.afterAll(async () => {
  await teardown(ctx)
  await server?.close()
  if (logDir?.startsWith(tmpdir())) await rm(logDir, { recursive: true, force: true })
})

test('1: the banner takes space from its own pane only, in every layout', async () => {
  const pane2Before = await waitViewOnSlot(ctx.app, ctx.page, otherTab, 'pane-2')
  const pane1Before = await waitViewOnSlot(ctx.app, ctx.page, gmailTab, 'pane-1')

  await ctx.page.evaluate(([t, u]) => window.api.tab.navigate(t, u), [gmailTab, signInUrl('A')] as const)
  await ctx.page.waitForSelector('[data-testid="signin-banner-pane-1"][data-kind="google-account"][data-state="offer"]')
  await expect(ctx.page.getByTestId('signin-text-pane-1')).toHaveText(OFFER_TEXT)
  expect(await banner('pane-2').count()).toBe(0)
  // The extension row: what it does, and a button to the store page
  await expect(ctx.page.getByTestId('signin-extension-pane-1')).toHaveText(EXTENSION_TEXT)
  const getExt = ctx.page.getByTestId('signin-get-extension-pane-1')
  expect(await getExt.evaluate((e) => e.tagName)).toBe('BUTTON')
  await expect(getExt).toHaveAccessibleName('Get the extension')
  await waitViewOnSlot(ctx.app, ctx.page, gmailTab, 'pane-1')
  await capture(ctx.app, 'google-signin-extension-prompt')

  const modes: LayoutMode[] = ['columns', 'single', 'rows', 'grid', 'columns']
  for (const mode of modes) {
    await setMode(ctx.page, mode)
    // Single mode drops pane-2's tab from the layout; show it again
    if (mode !== 'single' && tabOf(await getLayout(ctx.page), 'pane-2') !== otherTab) await assign('pane-2', otherTab)
    const view1 = await waitFor(
      async () => {
        const v = await waitViewOnSlot(ctx.app, ctx.page, gmailTab, 'pane-1')
        const b = await rectOf(ctx.page, 'signin-banner-pane-1')
        return !intersects(v, b) ? v : null
      },
      10_000,
      `pane-1 view below the banner (${mode})`
    )
    const b = await rectOf(ctx.page, 'signin-banner-pane-1')
    const pane1 = await rectOf(ctx.page, 'pane-pane-1')
    // Banner inside its pane, directly above the page view
    expect(b.x).toBeGreaterThanOrEqual(pane1.x - 1)
    expect(b.y).toBeGreaterThanOrEqual(pane1.y - 1)
    expect(b.x + b.width).toBeLessThanOrEqual(pane1.x + pane1.width + 1)
    expect(b.y + b.height).toBeLessThanOrEqual(view1.y + 1)
    expect(b.height).toBeGreaterThan(10)
    if (mode !== 'single') {
      const view2 = await waitViewOnSlot(ctx.app, ctx.page, otherTab, 'pane-2')
      expect(intersects(view2, b), mode).toBe(false)
      const pane2 = await rectOf(ctx.page, 'pane-pane-2')
      // The banner never changes the size of the panes themselves
      expect(Math.abs(pane1.height - pane2.height), `${mode} pane heights`).toBeLessThanOrEqual(1)
      expect(Math.abs(pane1.width - pane2.width), `${mode} pane widths`).toBeLessThanOrEqual(1)
      if (mode === 'columns') {
        expect(view2).toEqual(pane2Before)
        // Pane-1's page lost exactly the banner's height
        expect(Math.abs(view1.height + b.height - pane1Before.height)).toBeLessThanOrEqual(2)
      }
    }
  }

  // Google's in-page rejection keeps the banner and says so
  await tabEval(ctx.app, gmailTab, 'window.reject()')
  await ctx.page.waitForSelector('[data-testid="signin-banner-pane-1"][data-rejected="true"]')
  await expect(ctx.page.getByTestId('signin-text-pane-1')).toHaveText(`Google refused this sign-in. ${OFFER_TEXT}`)
  await capture(ctx.app, 'google-signin-banner-e2e')
  // A failed login keeps the extension row
  await expect(ctx.page.getByTestId('signin-extension-pane-1')).toBeVisible()
  await capture(ctx.app, 'google-signin-extension-prompt-rejected')
})

type StubGlobal = { __opened: string[]; __realOpenExternal?: typeof import('electron').shell.openExternal }
test('1b: "Get the extension" opens only the store URL in the system browser', async () => {
  // Stub before any click, so the real browser never opens
  await wm(ctx.app, (_sf, _a, { shell }) => {
    const g = globalThis as unknown as StubGlobal
    g.__opened = []
    g.__realOpenExternal = shell.openExternal
    const stub = async (u: string) => {
      g.__opened.push(u)
    }
    try {
      shell.openExternal = stub
    } catch {
      Object.defineProperty(shell, 'openExternal', { value: stub, configurable: true, writable: true })
    }
    if (shell.openExternal !== stub) {
      Object.defineProperty(shell, 'openExternal', { value: stub, configurable: true, writable: true })
    }
  })
  try {
    const opened = () => wm(ctx.app, () => (globalThis as unknown as StubGlobal).__opened)
    const state = await banner('pane-1').getAttribute('data-state')
    await ctx.page.click('[data-testid="signin-get-extension-pane-1"]')
    await expect.poll(opened).toEqual([CHROME_EXTENSION_STORE_URL])
    await expect(ctx.page.getByTestId('signin-get-extension-pane-1')).toHaveText('Get the extension')
    await expect(banner('pane-1')).toHaveAttribute('data-state', state!)

    // Preload contract: a URL passed from the renderer is dropped, main still opens only the store page
    await ctx.page.evaluate(() =>
      (window.api.app.openExtensionStore as unknown as (u: string) => Promise<void>)('https://evil.example')
    )
    await expect.poll(opened).toEqual([CHROME_EXTENSION_STORE_URL, CHROME_EXTENSION_STORE_URL])
  } finally {
    await wm(ctx.app, (_sf, _a, { shell }) => {
      const g = globalThis as unknown as StubGlobal
      if (g.__realOpenExternal) {
        Object.defineProperty(shell, 'openExternal', { value: g.__realOpenExternal, configurable: true, writable: true })
      }
      delete g.__realOpenExternal
    })
  }
})

test('2: no banner where none is due', async () => {
  // Same path on 127.0.0.1, which is not the test Google origin
  const cases: Array<[string, string]> = [
    [`${server.base}/v3/signin/identifier`, `${server.base}/v3/signin/identifier`],
    // Redirects to /v3/signin/identifier on 127.0.0.1
    [`${server.base}/ServiceLogin?continue=x`, `${server.base}/v3/signin/identifier`],
    [`${server.localBase}/page?label=B`, `${server.localBase}/page`]
  ]
  for (const [url, landed] of cases) {
    await ctx.page.evaluate(([t, u]) => window.api.tab.navigate(t, u), [otherTab, url] as const)
    await waitLoaded(ctx.page, otherTab, landed)
    await ctx.page.waitForTimeout(300)
    expect(await banner('pane-2').count(), url).toBe(0)
  }
  expect(await wm(ctx.app, (sf, id) => (sf as SfWithSignIn).googleSignIn.isGoogleSignInTab(id), otherTab)).toBe(false)
  await ctx.page.evaluate(([t, u]) => window.api.tab.navigate(t, u), [otherTab, `${server.base}/page?label=B`] as const)
  await waitLoaded(ctx.page, otherTab, `${server.base}/page`, 'Page B')
})

test('3: keyboard path to "Sign in with Chrome" logs the right URL and opens one request', async () => {
  const region = ctx.page.getByRole('region', { name: 'Google sign-in' })
  await expect(region).toHaveCount(1)
  await expect(region.getByRole('button', { name: 'Sign in with Chrome' })).toHaveCount(1)
  await expect(region.getByRole('button', { name: 'Dismiss' })).toHaveCount(1)
  expect(await ctx.page.locator('[data-testid="signin-start-pane-1"]').evaluate((e) => e.tagName)).toBe('BUTTON')
  expect(await ctx.page.locator('[data-testid="signin-dismiss-pane-1"]').evaluate((e) => e.tagName)).toBe('BUTTON')

  // From inside the page: Ctrl+L (focus address bar), then Tab through the DOM to the banner
  await pressInTab(ctx.app, gmailTab, 'L', [MOD])
  await waitFor(() => ctx.page.evaluate(() => document.activeElement?.tagName === 'INPUT'), 5_000, 'address bar focused')
  let reached = false
  for (let i = 0; i < 30 && !reached; i++) {
    await ctx.page.keyboard.press('Tab')
    reached = await ctx.page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset?.testid === 'signin-start-pane-1'
    )
  }
  expect(reached, 'Tab reaches the banner button').toBe(true)
  await ctx.page.keyboard.press('Enter')

  const lines = await waitFor(async () => {
    const l = await browserLines()
    return l.length > 0 ? l : null
  }, 10_000, 'browser log line')
  expect(lines).toHaveLength(1)
  const opened = new URL(lines[0].url)
  expect(opened.origin).toBe(server.localBase)
  expect(opened.pathname).toBe('/ServiceLogin')
  expect(opened.searchParams.get('service')).toBe('mail')
  expect(opened.searchParams.get('continue')).toBe(`${server.localBase}/page?label=A`)
  await ctx.page.waitForSelector('[data-testid="signin-banner-pane-1"][data-state="waiting"]')
  await expect(ctx.page.getByTestId('signin-text-pane-1')).toContainText('Finish signing in in Google Chrome')
  await expect(ctx.page.getByTestId('signin-text-pane-1')).toContainText('“Send to Gmail”')
  await expect(ctx.page.getByTestId('signin-text-pane-1')).toContainText('version 1.2.0 or later')
  await expect(ctx.page.getByTestId('signin-extension-pane-1')).toBeVisible()

  const res = await getPending()
  expect(res.status).toBe(200)
  expect(res.headers['cache-control']).toBe('no-store')
  expect(res.headers['x-content-type-options']).toBe('nosniff')
  expect(res.headers['access-control-allow-origin']).toBe(EXT.origin)
  expect(res.headers['access-control-allow-methods']).toBe('GET, OPTIONS')
  expect(res.json.requests).toHaveLength(1)
  const r = res.json.requests[0]
  expect(Object.keys(r).sort()).toEqual(['cookieDomains', 'expiresAt', 'id', 'sessionColor', 'sessionName'])
  expect(r).toMatchObject({ sessionName: 'Gmail', sessionColor: '#ef4444', cookieDomains: ['google.com', 'localhost'] })
  expect(Math.abs(r.expiresAt - (Date.now() + 10 * 60_000))).toBeLessThan(30_000)
  firstRequestId = r.id
  // A request without Origin (Node, curl) is answered too
  expect((await getPending({})).json.requests).toHaveLength(1)
})

test('4: POST /import with the requestId fills the EXISTING session and returns the tab', async () => {
  const before = (await ctx.page.evaluate(() => window.api.session.getAll())).length
  const res = await postHandOff(firstRequestId, [
    { name: 'sfsignin', value: SIGNIN_VALUE, domain: 'localhost', path: '/' },
    { name: 'evil', value: EVIL_VALUE, domain: 'evil.example', path: '/' }
  ])
  expect(res.status, JSON.stringify(res.json)).toBe(200)
  expect(res.json).toMatchObject({
    success: true,
    sessionId: gmail.id,
    tabId: gmailTab,
    paneId: 'pane-1',
    intoExistingSession: true,
    outOfScope: 1,
    localStorageOrigins: 0
  })
  expect(res.json.cookies.imported).toBe(1)
  expect((await ctx.page.evaluate(() => window.api.session.getAll())).length).toBe(before)

  await waitLoaded(ctx.page, gmailTab, `${server.localBase}/page?label=A`, 'Page A')
  expect(tabOf(await getLayout(ctx.page), 'pane-1')).toBe(gmailTab)
  expect(String(server.lastHeaders.get('/page')?.cookie ?? '')).toContain(`sfsignin=${SIGNIN_VALUE}`)

  const cookies = await wm(
    ctx.app,
    async (sf, id) =>
      (await sf.sessionManager.getElectronSession(id)!.cookies.get({})).map((c) => ({
        name: c.name,
        domain: c.domain,
        expirationDate: c.expirationDate
      })),
    gmail.id
  )
  const signin = cookies.find((c) => c.name === 'sfsignin')
  expect(signin?.domain).toBe('localhost')
  expect(Math.abs((signin?.expirationDate ?? 0) - (Date.now() / 1000 + 30 * 24 * 3600))).toBeLessThan(120)
  expect(cookies.some((c) => c.name === 'evil')).toBe(false)
  // No other session got anything
  const otherCookies = await wm(ctx.app, async (sf, id) => (await sf.sessionManager.getElectronSession(id)!.cookies.get({})).length, other.id)
  expect(otherCookies).toBe(0)

  await expect(banner('pane-1')).toHaveCount(0)
  await expect(ctx.page.getByText('Login sent from Chrome: Gmail', { exact: true })).toBeVisible()
  expect((await getPending()).json.requests).toEqual([])
})

test('5: reused, made-up, malformed, expired and orphaned ids create and overwrite nothing', async () => {
  const snapshot = await snapshotSessions()
  const cookie = [{ name: 'again', value: 'SF-AGAIN-9b2c', domain: 'localhost', path: '/' }]

  const reused = await postHandOff(firstRequestId, cookie)
  expect(reused.status).toBe(410)
  expect(reused.json).toMatchObject({ success: false, code: 'request_invalid' })
  const madeUp = await postHandOff('8f0c2a4e-1b3d-4c5e-9f60-718293a4b5c6', cookie)
  expect(madeUp.status).toBe(410)
  const malformed = await postHandOff('abc', cookie)
  expect(malformed.status).toBe(400)
  // An empty or null requestId is a hand-off payload too, never a new session
  expect((await postHandOff(null, cookie)).status).toBe(400)
  expect(await snapshotSessions()).toEqual(snapshot)

  // Expired: the banner says so and the id is refused
  await ctx.page.evaluate(([t, u]) => window.api.tab.navigate(t, u), [gmailTab, signInUrl('A')] as const)
  await ctx.page.waitForSelector('[data-testid="signin-banner-pane-1"][data-state="offer"]')
  await ctx.page.click('[data-testid="signin-start-pane-1"]')
  await ctx.page.waitForSelector('[data-testid="signin-banner-pane-1"][data-state="waiting"]')
  const expiringId = (await getPending()).json.requests[0].id as string
  await wm(ctx.app, (sf, id) => (sf as SfWithSignIn).googleSignIn.pending.expireForTest(id), expiringId)
  await ctx.page.waitForSelector('[data-testid="signin-banner-pane-1"][data-state="offer"]')
  await expect(ctx.page.getByTestId('signin-text-pane-1')).toContainText('The last request expired.')
  expect((await postHandOff(expiringId, cookie)).status).toBe(410)
  expect(await snapshotSessions()).toEqual(snapshot)

  // Session deleted while its request waits
  const [temp] = await createSessions(ctx.page, [{ name: 'Temp', color: '#10b981' }])
  const tempTab = await createHiddenTab(ctx.app, temp.id, signInUrl('C'))
  await waitFor(
    () => wm(ctx.app, (sf, id) => (sf as SfWithSignIn).googleSignIn.isGoogleSignInTab(id), tempTab),
    15_000,
    'Temp tab on the sign-in stub'
  )
  await ctx.page.evaluate((id) => window.api.signin.start(id), tempTab)
  const tempReq = (await getPending()).json.requests.find((r: { sessionName: string }) => r.sessionName === 'Temp')
  expect(tempReq).toBeTruthy()
  await ctx.page.evaluate((id) => window.api.session.delete(id), temp.id)
  expect((await postHandOff(tempReq.id, cookie)).status).toBe(410)
  expect((await getPending()).json.requests).toEqual([])
  expect(await snapshotSessions()).toEqual(snapshot)

  // Session closed while its request waits: cancelled at once, not at the next /pending
  const [temp2] = await createSessions(ctx.page, [{ name: 'Temp2', color: '#10b981' }])
  const temp2Tab = await createHiddenTab(ctx.app, temp2.id, signInUrl('C'))
  await waitFor(
    () => wm(ctx.app, (sf, id) => (sf as SfWithSignIn).googleSignIn.isGoogleSignInTab(id), temp2Tab),
    15_000,
    'Temp2 tab on the sign-in stub'
  )
  await ctx.page.evaluate((id) => window.api.signin.start(id), temp2Tab)
  const temp2Req = await wm(ctx.app, (sf) => (sf as SfWithSignIn).googleSignIn.pending.list()[0]?.id ?? null)
  expect(temp2Req).toBeTruthy()
  await ctx.page.evaluate((id) => window.api.session.close(id), temp2.id)
  expect(await wm(ctx.app, (sf) => (sf as SfWithSignIn).googleSignIn.pending.list().length)).toBe(0)
  expect((await getPending()).json.requests).toEqual([])
  expect((await postHandOff(temp2Req, cookie)).status).toBe(410)
  expect(await snapshotSessions()).toEqual(snapshot)
  expect((await browserLines()).length).toBe(4)
})

test('6: OAuth popup: the opener’s site opens in Chrome and gets the cookie back', async () => {
  [site] = await createSessions(ctx.page, [{ name: 'Site', color: '#eab308' }])
  siteTab = await createHiddenTab(ctx.app, site.id, `${server.base}/site`)
  await assign('pane-2', siteTab)
  await waitLoaded(ctx.page, siteTab, `${server.base}/site`, 'Site')

  // window.open returns a Window, which cannot be sent back
  await tabEval(ctx.app, siteTab, 'openGooglePopup(); true')
  const popupTab = await waitFor(async () => {
    const t = tabOf(await getLayout(ctx.page), 'pane-2')
    return t && t !== siteTab ? t : null
  }, 10_000, 'popup in pane-2')
  await ctx.page.waitForSelector('[data-testid="signin-banner-pane-2"][data-kind="oauth"][data-state="offer"]')
  await expect(ctx.page.getByTestId('signin-text-pane-2')).toContainText(`Sign in to 127.0.0.1:${server.port} with Chrome`)

  await ctx.page.click('[data-testid="signin-start-pane-2"]')
  await ctx.page.waitForSelector('[data-testid="signin-banner-pane-2"][data-state="waiting"]')
  const lines = await browserLines()
  expect(lines.at(-1)?.url).toBe(`${server.base}/site`)
  const pending = (await getPending()).json.requests
  expect(pending).toHaveLength(1)
  expect(pending[0]).toMatchObject({ sessionName: 'Site', cookieDomains: ['127.0.0.1'] })

  const res = await postHandOff(pending[0].id, [{ name: 'sfsite', value: SITE_VALUE, domain: '127.0.0.1', path: '/' }])
  expect(res.status, JSON.stringify(res.json)).toBe(200)
  expect(res.json).toMatchObject({ sessionId: site.id, tabId: siteTab, paneId: 'pane-2', outOfScope: 0 })
  await waitFor(async () => tabOf(await getLayout(ctx.page), 'pane-2') === siteTab, 10_000, 'opener back in pane-2')
  await waitFor(
    () => wm(ctx.app, (sf, id) => sf.windowManager.getTabState(id) === null, popupTab),
    10_000,
    'popup tab closed'
  )
  await waitFor(() => String(server.lastHeaders.get('/site')?.cookie ?? '').includes(`sfsite=${SITE_VALUE}`), 10_000, 'cookie on /site')
  await expect(banner('pane-2')).toHaveCount(0)
})

test('7: a popup known to be OAuth only from its redirect chain; a fresh bare OAuth tab is unavailable', async () => {
  await tabEval(ctx.app, siteTab, 'openBarePopup(); true')
  const popupTab = await waitFor(async () => {
    const t = tabOf(await getLayout(ctx.page), 'pane-2')
    return t && t !== siteTab ? t : null
  }, 10_000, 'bare popup in pane-2')
  await waitLoaded(ctx.page, popupTab, `${server.localBase}/v3/signin/identifier`)
  expect((await viewInfo(ctx.app, popupTab))?.url).toBe(`${server.localBase}/v3/signin/identifier`)
  await ctx.page.waitForSelector('[data-testid="signin-banner-pane-2"][data-kind="oauth"]')
  await expect(ctx.page.getByTestId('signin-text-pane-2')).toContainText(`127.0.0.1:${server.port}`)
  await expect(ctx.page.getByTestId('signin-extension-pane-2')).toBeVisible()
  await ctx.page.click('[data-testid="signin-dismiss-pane-2"]')
  await expect(banner('pane-2')).toHaveCount(0)
  await expect(ctx.page.getByTestId('signin-extension-pane-2')).toHaveCount(0)
  await ctx.page.evaluate((id) => window.api.tab.close(id), popupTab)

  // A fresh tab that starts on the OAuth URL has no site to go back to
  const bareTab = await createHiddenTab(ctx.app, other.id, `${server.localBase}/o/oauth2/v2/bare`)
  await assign('pane-2', bareTab)
  await ctx.page.waitForSelector('[data-testid="signin-banner-pane-2"][data-state="unavailable"][data-kind="oauth"]')
  expect(await ctx.page.locator('[data-testid="signin-start-pane-2"]').count()).toBe(0)
  await expect(ctx.page.getByTestId('signin-extension-pane-2')).toHaveCount(0)
  await expect(ctx.page.getByTestId('signin-text-pane-2')).toContainText("SessionForge can't tell which site started it")
  await ctx.page.evaluate((id) => window.api.tab.close(id), bareTab)
  await assign('pane-2', siteTab)
})

test('8: the /pending boundary', async () => {
  expect((await getPending({ origin: 'https://evil.example' })).status).toBe(403)
  expect((await getPending({ 'sec-fetch-mode': 'no-cors' })).status).toBe(403)
  const nav = await getPending({ 'sec-fetch-mode': 'navigate' })
  expect(nav.status).toBe(403)
  expect(nav.json).toEqual({ success: false, error: 'Request mode not allowed' })
  expect((await getPending({ host: `127.0.0.1.nip.io:${ctx.importPort}` })).status).toBe(403)
  const sameOrigin = await getPending({ 'sec-fetch-mode': 'same-origin' })
  expect(sameOrigin.status).toBe(200)
  // The extension tells users about newer desktop releases from this field; older ones ignore it
  expect(Array.isArray(sameOrigin.json.requests)).toBe(true)
  expect(sameOrigin.json.appVersion).toBe(JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version)
  expect((await http('POST', '/pending', { headers: EXT, body: {} })).status).toBe(404)
  expect((await http('GET', '/import', { headers: EXT })).status).toBe(404)
  const pre = await http('OPTIONS', '/pending', { headers: EXT })
  expect(pre.status).toBe(204)
  expect(pre.headers['access-control-allow-origin']).toBe(EXT.origin)
  expect(pre.headers['access-control-allow-methods']).toBe('GET, OPTIONS')
  const importPre = await http('OPTIONS', '/import', { headers: EXT })
  expect(importPre.headers['access-control-allow-methods']).toBe('POST, OPTIONS')
})

test('9: Agent Bridge results on a Google sign-in page carry the note', async () => {
  await wm(ctx.app, (sf) => sf.agentBridge.setEnabled(true))
  await ctx.page.evaluate(([t, u]) => window.api.tab.navigate(t, u), [gmailTab, signInUrl('A')] as const)
  await ctx.page.waitForSelector('[data-testid="signin-banner-pane-1"][data-state="offer"]')
  const client = await httpClient(ctx)
  try {
    const lastText = async (session: string) => {
      const r = (await client.callTool({ name: 'snapshot', arguments: { session } })) as {
        isError?: boolean
        content: Array<{ type: string; text?: string }>
      }
      expect(r.isError, JSON.stringify(r.content)).toBeFalsy()
      return r.content.at(-1)?.text
    }
    expect(await lastText('Gmail')).toBe(GOOGLE_SIGNIN_AGENT_NOTE)
    await ctx.page.evaluate((id) => window.api.signin.dismiss(id), gmailTab)
    await expect(banner('pane-1')).toHaveCount(0)
    expect(await lastText('Gmail')).toBe(GOOGLE_SIGNIN_AGENT_NOTE)
    expect(await lastText('Site')).not.toBe(GOOGLE_SIGNIN_AGENT_NOTE)
    const site = (await client.callTool({ name: 'snapshot', arguments: { session: 'Site' } })) as {
      content: Array<{ type: string; text?: string }>
    }
    expect(site.content.some((c) => c.text === GOOGLE_SIGNIN_AGENT_NOTE)).toBe(false)
  } finally {
    await client.close().catch(() => undefined)
    await wm(ctx.app, (sf) => sf.agentBridge.setEnabled(false))
  }
})

// Design step 11, run before step 10 replaces the app
test('11: logs hold no cookie values and no "Tab not found"', async () => {
  const logs = ctx.logs.join('')
  for (const v of [SIGNIN_VALUE, EVIL_VALUE, SITE_VALUE, 'SF-AGAIN-9b2c']) expect(logs, v).not.toContain(v)
  expect(logsHaveTabNotFound(ctx.logs)).toBe(false)
  expect(logs).toContain('[signin] request ')
  expect(logs).toContain('[import] signed in existing session')
})

test('10: no hand-off when the import server could not start (port in use)', async () => {
  await teardown(ctx)
  const port = await freePort()
  const blocker: Server = createServer()
  await new Promise<void>((r) => blocker.listen(port, '127.0.0.1', () => r()))
  const log2 = join(logDir, 'browser-2.log')
  let ctx2: AppCtx | undefined
  try {
    ctx2 = await launchApp({
      importPort: port,
      env: { SESSIONFORGE_TEST_GOOGLE_ORIGIN: server.localBase, SESSIONFORGE_TEST_BROWSER_LOG: log2 }
    })
    ctx = ctx2
    await waitFor(() => ctx2!.logs.join('').includes(`[import] port ${port} in use`), 10_000, 'port-in-use log')
    const [s] = await createSessions(ctx2.page, [{ name: 'Blocked', color: '#8b5cf6' }])
    const t = await createHiddenTab(ctx2.app, s.id, signInUrl('D'))
    await ctx2.page.evaluate(([p, id]) => window.api.layout.assignTab(p as PaneId, id), ['pane-1', t] as const)
    await ctx2.page.waitForSelector('[data-testid="signin-banner-pane-1"][data-state="offer"]')
    await ctx2.page.click('[data-testid="signin-start-pane-1"]')
    // The destructive "Action failed" toast (callMain) with the blocker text
    const toastText = ctx2.page.getByLabel('Notifications (F8)').getByText(`The import server isn't running (port ${port} is in use)`)
    await expect(toastText).toBeVisible()
    await expect(ctx2.page.getByLabel('Notifications (F8)').getByText('Action failed')).toBeVisible()
    expect(await browserLines(log2)).toEqual([])
    expect(await wm(ctx2.app, (sf) => (sf as SfWithSignIn).googleSignIn.pending.list().length)).toBe(0)
    await ctx2.page.waitForSelector('[data-testid="signin-banner-pane-1"][data-state="offer"]')
  } finally {
    await new Promise<void>((r) => blocker.close(() => r()))
  }
})
