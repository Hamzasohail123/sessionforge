// New-release notice end to end against a local stub of GitHub's releases/latest
// (SESSIONFORGE_TEST_UPDATE_URL, honoured only under SESSIONFORGE_E2E=1).
import { test, expect, type ElectronApplication } from '@playwright/test'
import { launchApp, relaunch, teardown, waitFor, wm, type AppCtx } from './fixtures/app'
import { capture } from './fixtures/capture'
import { startReleaseServer, type ReleaseServer } from './fixtures/release-server'
import { startTestServer, type TestServer } from './fixtures/test-server'
import { createHiddenTab, openSession, rectOf, viewInfo, waitViewOnSlot } from './fixtures/ui'
import { RELEASES_PAGE_URL } from '../src/main/constants'
import { UPDATE_SETTING_KEYS } from '../src/main/updates'
import { version as APP_VERSION } from '../package.json'

test.describe.configure({ mode: 'serial' })

const DAY_PLUS = 25 * 3_600_000
let release: ReleaseServer
let pages: TestServer
let ctx: AppCtx | undefined

const env = (extra: Record<string, string> = {}) => ({ SESSIONFORGE_TEST_UPDATE_URL: release.url, ...extra })
const launch = (extra: Record<string, string> = {}) => launchApp({ env: env(extra) })
const reopen = async (c: AppCtx) => (ctx = await relaunch(c, { env: env() }))
const bar = (c: AppCtx) => c.page.getByTestId('update-notice')
const toasts = (c: AppCtx) => c.page.locator('[aria-label^="Notifications"] li')
const setting = (c: AppCtx, key: string) => wm(c.app, (sf, k) => sf.db.getSetting(k), key)
const ageLastCheck = (c: AppCtx) =>
  wm(c.app, (sf, { key, ms }) => sf.db.setSetting(key, String(Date.now() - ms)), {
    key: UPDATE_SETTING_KEYS.lastCheckedAt,
    ms: DAY_PLUS
  })
const waitHits = (n: number) => waitFor(() => release.hits.length >= n, 10_000, `${n} update request(s)`)

async function openGeneral(c: AppCtx) {
  if ((await c.page.getByTestId('settings-dialog').count()) === 0) await c.page.click('[data-testid="open-settings"]')
  await c.page.click('[data-testid="settings-nav-general"]')
  await expect(c.page.getByTestId('update-check-enabled')).toBeVisible()
}

type StubGlobal = { __opened: string[]; __realOpenExternal?: typeof import('electron').shell.openExternal }
async function stubOpenExternal(app: ElectronApplication) {
  await wm(app, (_sf, _a, { shell }) => {
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
  return () => wm(app, () => (globalThis as unknown as StubGlobal).__opened)
}
async function restoreOpenExternal(app: ElectronApplication) {
  await wm(app, (_sf, _a, { shell }) => {
    const g = globalThis as unknown as StubGlobal
    if (g.__realOpenExternal) {
      Object.defineProperty(shell, 'openExternal', { value: g.__realOpenExternal, configurable: true, writable: true })
    }
    delete g.__realOpenExternal
  })
}

test.beforeAll(async () => {
  release = await startReleaseServer()
  pages = await startTestServer()
})
test.afterEach(async () => {
  await teardown(ctx)
  ctx = undefined
})
test.afterAll(async () => {
  await release?.close()
  await pages?.close()
})

test('1: without a test endpoint (every other spec) there is no request and no bar', async () => {
  release.set({ tag: 'v9.9.9' })
  const before = release.hits.length
  const c = (ctx = await launchApp())
  await c.page.waitForTimeout(1_500)
  await expect(bar(c)).toHaveCount(0)
  const state = await c.page.evaluate(() => window.api.update.getState())
  expect(state.lastCheckedAt).toBeNull()
  expect(state.available).toBeNull()
  expect(release.hits.length).toBe(before)
})

test('2: a newer release shows the bar above the session bar; one cookie-less request', async () => {
  release.set({ tag: 'v0.2.0' })
  const before = release.hits.length
  const c = (ctx = await launch())
  await expect(bar(c)).toBeVisible()
  await expect(bar(c)).toHaveAttribute('data-version', '0.2.0')
  await expect(c.page.getByTestId('update-notice-text')).toHaveText(`SessionForge 0.2.0 is available. You have ${APP_VERSION}.`)
  expect(release.hits.length).toBe(before + 1)
  const { headers } = release.hits[before]
  expect(headers.cookie).toBeUndefined()
  expect(headers['user-agent']).toMatch(new RegExp(`^SessionForge/${APP_VERSION.replace(/\./g, '\\.')}`))
  expect(c.logs.join('')).not.toContain('Action failed')

  // The bar is in normal flow: the session bar and the page view sit below it
  const session = await c.page.evaluate(() => window.api.session.create({ name: 'Update QA', color: '#3b82f6', env: 'local' }))
  const tabId = await createHiddenTab(c.app, session.id, `${pages.base}/page?label=A`)
  await c.page.reload()
  await c.page.waitForSelector(`[data-testid="session-${session.id}"]`)
  await openSession(c.page, 'pane-1', session.id)
  await expect(bar(c)).toBeVisible()
  const view = await waitViewOnSlot(c.app, c.page, tabId, 'pane-1')
  const noticeRect = await rectOf(c.page, 'update-notice')
  const sessionBar = await rectOf(c.page, 'session-bar')
  expect(noticeRect.y).toBe(0)
  expect(noticeRect.y + noticeRect.height).toBeLessThanOrEqual(sessionBar.y + 0.5)
  expect(view.y).toBeGreaterThanOrEqual(noticeRect.y + noticeRect.height)
  await capture(c.app, 'update-notice-bar')

  // Later: the bar goes and the page view moves up into the freed space
  await c.page.click('[data-testid="update-later"]')
  await expect(bar(c)).toHaveCount(0)
  const moved = await waitFor(async () => {
    const v = await viewInfo(c.app, tabId)
    return v && v.bounds.y < view.y ? v.bounds : null
  }, 5_000, 'view to move up')
  expect(view.y - moved.y).toBeCloseTo(noticeRect.height, 0)
})

test('3: Download opens the release page; the renderer cannot choose the URL', async () => {
  release.set({ tag: 'v0.2.0' })
  const c = (ctx = await launch())
  await expect(bar(c)).toBeVisible()
  const opened = await stubOpenExternal(c.app)
  try {
    const tagUrl = `${RELEASES_PAGE_URL}/tag/v0.2.0`
    await c.page.click('[data-testid="update-download"]')
    await expect.poll(opened).toEqual([tagUrl])
    await expect(bar(c)).toBeVisible() // Download does not dismiss
    // A URL passed from the renderer is dropped by the preload; main opens its own
    await c.page.evaluate(() => (window.api.update.openRelease as unknown as (u: string) => Promise<void>)('https://evil.example'))
    await expect.poll(opened).toEqual([tagUrl, tagUrl])
    // An html_url outside the releases page falls back to the releases page
    release.set({ tag: 'v0.2.0', htmlUrl: 'https://evil.example/x' })
    await c.page.evaluate(() => window.api.update.checkNow())
    await c.page.click('[data-testid="update-download"]')
    await expect.poll(opened).toEqual([tagUrl, tagUrl, RELEASES_PAGE_URL])
  } finally {
    await restoreOpenExternal(c.app)
  }
})

test('4: Later is remembered for that version across relaunches; a newer one shows again', async () => {
  release.set({ tag: 'v0.2.0' })
  let c = (ctx = await launch())
  await expect(bar(c)).toBeVisible()
  await c.page.click('[data-testid="update-later"]')
  await expect(bar(c)).toHaveCount(0)
  expect(await setting(c, UPDATE_SETTING_KEYS.dismissedVersion)).toBe('0.2.0')

  const hits = release.hits.length
  c = await reopen(c)
  await c.page.waitForTimeout(1_500)
  expect(release.hits.length).toBe(hits) // inside 24 h: cached, no request
  await expect(bar(c)).toHaveCount(0)

  await ageLastCheck(c)
  release.set({ tag: 'v0.3.0' })
  c = await reopen(c)
  await expect(bar(c)).toBeVisible()
  await expect(bar(c)).toHaveAttribute('data-version', '0.3.0')
  expect(release.hits.length).toBe(hits + 1)
})

test('5: the same or an older version shows nothing', async () => {
  release.set({ tag: 'v0.1.0' })
  const before = release.hits.length
  const c = (ctx = await launch())
  await waitHits(before + 1)
  await c.page.waitForTimeout(500)
  await expect(bar(c)).toHaveCount(0)
  release.set({ tag: 'v0.0.9' })
  await openGeneral(c)
  await c.page.click('[data-testid="update-check-now"]')
  await expect(c.page.getByTestId('update-check-result')).toHaveText("You're up to date.")
  await expect(bar(c)).toHaveCount(0)
  expect(await setting(c, UPDATE_SETTING_KEYS.latest)).toContain('"0.0.9"')
})

test('6: Check now reports up to date, then a new version with a Download button', async () => {
  release.set({ tag: 'v0.1.0' })
  const before = release.hits.length
  const c = (ctx = await launch())
  await waitHits(before + 1)
  await openGeneral(c)
  await expect(c.page.getByTestId('update-check-enabled')).toHaveAttribute('data-state', 'checked')
  await expect(c.page.getByTestId('update-check-result')).toHaveText('')
  await c.page.click('[data-testid="update-check-now"]')
  await expect(c.page.getByTestId('update-check-result')).toHaveText("You're up to date.")
  release.set({ tag: 'v0.2.0' })
  await c.page.click('[data-testid="update-check-now"]')
  await expect(c.page.getByTestId('update-check-result')).toContainText('SessionForge 0.2.0 is available.')
  await expect(c.page.getByTestId('update-check-download')).toBeVisible()
  expect(release.hits.length).toBe(before + 3)
  await capture(c.app, 'update-settings-check-now')
})

test('7: with the switch off SessionForge sends no request; turning it on checks again', async () => {
  release.set({ tag: 'v0.2.0' })
  let c = (ctx = await launch())
  await expect(bar(c)).toBeVisible()
  await openGeneral(c)
  await c.page.click('[data-testid="update-check-enabled"]')
  await expect(c.page.getByTestId('update-check-enabled')).toHaveAttribute('data-state', 'unchecked')
  await expect.poll(() => setting(c, UPDATE_SETTING_KEYS.enabled)).toBe('false')
  await expect(bar(c)).toHaveCount(0)
  await expect(c.page.getByTestId('update-check-now')).toBeDisabled()

  await ageLastCheck(c)
  const hits = release.hits.length
  c = await reopen(c)
  await c.page.waitForTimeout(2_000)
  expect(release.hits.length).toBe(hits)
  await expect(bar(c)).toHaveCount(0)
  await c.page.evaluate(() => window.api.update.checkNow())
  expect(release.hits.length).toBe(hits)
  await openGeneral(c)
  await expect(c.page.getByTestId('update-check-enabled')).toHaveAttribute('data-state', 'unchecked')
  await expect(c.page.getByTestId('update-check-now')).toBeDisabled()

  await c.page.click('[data-testid="update-check-enabled"]')
  await waitHits(hits + 1)
  expect(release.hits.length).toBe(hits + 1)
  await expect(c.page.getByTestId('update-check-now')).toBeEnabled()
  await expect(bar(c)).toHaveCount(1)
})

test('8: failures are silent (no bar, no toast) and only logged', async () => {
  release.set({ status: 500 })
  const before = release.hits.length
  const c = (ctx = await launch())
  await waitHits(before + 1)
  await expect.poll(() => c.logs.join('')).toContain('[update] GitHub answered HTTP 500')
  for (const reply of [{ status: 500 }, { status: 403 }, 'bad-json', 'drop'] as const) {
    release.set(reply)
    await ageLastCheck(c)
    const aged = await setting(c, UPDATE_SETTING_KEYS.lastCheckedAt)
    const n = release.hits.length
    await wm(c.app, (sf) => sf.updates.maybeCheck())
    expect(release.hits.length, JSON.stringify(reply)).toBeGreaterThan(n)
    await c.page.waitForTimeout(300)
    await expect(bar(c)).toHaveCount(0)
    await expect(toasts(c)).toHaveCount(0)
    const after = await setting(c, UPDATE_SETTING_KEYS.lastCheckedAt)
    // Any HTTP answer counts as a check; a dropped connection does not
    if (reply === 'drop') expect(after).toBe(aged)
    else expect(after).not.toBe(aged)
  }
  const logs = c.logs.join('')
  expect(logs).toContain('[update] GitHub answered HTTP 403')
  expect(logs).toContain('[update] GitHub answered with a body that is not JSON')
  expect(logs).toContain('[update] could not reach GitHub')

  // Only Check now, which the user asked for, reports the failure
  await openGeneral(c)
  await c.page.click('[data-testid="update-check-now"]')
  await expect(c.page.getByTestId('update-check-result')).toHaveText("Couldn't reach GitHub. Try again later.")
  await expect(toasts(c)).toHaveCount(0)
})

test('9: the bar waits until the first-run tour ends', async () => {
  release.set({ tag: 'v0.2.0' })
  const before = release.hits.length
  const c = (ctx = await launch({ SESSIONFORGE_TEST_TOUR: '1' }))
  await expect(c.page.getByTestId('tour-card')).toBeVisible()
  await waitHits(before + 1)
  await expect.poll(() => c.page.evaluate(() => window.api.update.getState().then((s) => s.notice?.version))).toBe('0.2.0')
  await c.page.waitForTimeout(500)
  await expect(bar(c)).toHaveCount(0)
  await c.page.getByTestId('tour-skip').click()
  await expect(c.page.getByTestId('tour-card')).toHaveCount(0)
  await expect(bar(c)).toBeVisible()
})

test('10: About & Privacy says what the update check does', async () => {
  const c = (ctx = await launchApp())
  await c.page.click('[data-testid="open-settings"]')
  await c.page.click('[data-testid="settings-nav-about"]')
  const line = c.page.getByTestId('about-update-check')
  await expect(line).toHaveText(
    'Update check. Checks GitHub once a day for new versions (no data about you is sent). You can turn this off in General.'
  )
  await expect(c.page.getByText('Local-first.')).toBeVisible()
  await capture(c.app, 'about-privacy-update-line')
})
