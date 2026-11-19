import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, projectRoot, teardown, waitFor, wm, type AppCtx } from './fixtures/app'
import { capture } from './fixtures/capture'
import { startTestServer, type TestServer } from './fixtures/test-server'
import { attachedViews, createHiddenTab, MOD, openSession, pressInShell, pressInTab, waitViewOnSlot } from './fixtures/ui'
import { closeSettings, openSettings, setGrant } from './fixtures/mcp'
import { SHORTCUT_ROWS } from '../src/main/shortcut-table'
import type { Session } from '../src/main/types'
// Settings sheet: navigation, the Cmd/Ctrl+, shortcut, the overlay rule and the read-only tabs.
test.describe.configure({ mode: 'serial' })
let ctx: AppCtx
let server: TestServer
let local: Session
let prod: Session
let tabId: string
const dialog = () => ctx.page.locator('[data-testid="settings-dialog"]')
const viewsHidden = async () => (await attachedViews(ctx.app)).every((v) => !v.visible)
const viewsVisible = async () => {
  const v = await attachedViews(ctx.app)
  return v.length > 0 && v.every((x) => x.visible)
}
async function setContentSize(width: number, height: number): Promise<void> {
  // macOS keeps a window inside the screen's work area, even with enableLargerThanScreen
  // (https://github.com/electron/electron/issues/47632), and the GitHub macOS runner's virtual
  // display is smaller than 1400x900. On macOS, ask for the largest content size that fits there;
  // Linux and Windows get the exact size. The checks below are size-relative (no sideways overflow).
  const target = await wm(
    ctx.app,
    (sf, s, { screen }) => {
      if (process.platform !== 'darwin') return s
      const win = sf.window
      const work = screen.getDisplayMatching(win.getBounds()).workAreaSize
      const outer = win.getBounds()
      const inner = win.getContentBounds()
      return {
        width: Math.min(s.width, work.width - (outer.width - inner.width)),
        height: Math.min(s.height, work.height - (outer.height - inner.height))
      }
    },
    { width, height }
  )
  if (target.width !== width || target.height !== height) {
    console.log(`[settings] screen too small for ${width}x${height}; using ${target.width}x${target.height}`)
  }
  await wm(ctx.app, (sf, s) => sf.window.setContentSize(s.width, s.height), target)
  // The native content bounds are the contract for setContentSize. On macOS they can differ by a
  // pixel because of native frame and scale rounding.
  const tolerance = process.platform === 'darwin' ? 1 : 0
  await waitFor(
    async () => {
      const bounds = await wm(ctx.app, (sf) => {
        const { width: contentWidth, height: contentHeight } = sf.window.getContentBounds()
        return { width: contentWidth, height: contentHeight }
      })
      return Math.abs(bounds.width - target.width) <= tolerance && Math.abs(bounds.height - target.height) <= tolerance
    },
    5_000,
    `content bounds ${target.width}x${target.height}`
  )
}
test.beforeAll(async () => {
  server = await startTestServer()
  ctx = await launchApp()
  local = await ctx.page.evaluate(() => window.api.session.create({ name: 'Local QA', color: '#3b82f6', env: 'local' }))
  prod = await ctx.page.evaluate(() => window.api.session.create({ name: 'Prod Admin', color: '#ef4444', env: 'production' }))
  tabId = await createHiddenTab(ctx.app, local.id, `${server.base}/`)
  await ctx.page.reload()
  await ctx.page.waitForSelector(`[data-testid="session-${prod.id}"]`)
  await openSession(ctx.page, 'pane-1', local.id)
  await waitViewOnSlot(ctx.app, ctx.page, tabId, 'pane-1')
})
test.afterAll(async () => {
  await teardown(ctx)
  await server?.close()
})
test('Ctrl+, from the shell opens Settings with the page views hidden; Escape closes it', async () => {
  await ctx.page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="open-settings"]')?.focus())
  await pressInShell(ctx.app, ',', [MOD])
  await expect(dialog()).toBeVisible()
  await waitFor(viewsHidden, 5_000, 'views hidden')
  // Pressing it again while open changes nothing
  await pressInShell(ctx.app, ',', [MOD])
  await expect(dialog()).toHaveCount(1)
  await pressInShell(ctx.app, 'Escape')
  await expect(dialog()).toHaveCount(0)
  await waitFor(viewsVisible, 5_000, 'views visible again')
  expect(await ctx.page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('open-settings')
})
test('Ctrl+, from inside a page opens Settings; the page never sees it', async () => {
  await pressInTab(ctx.app, tabId, ',', [MOD])
  await expect(dialog()).toBeVisible()
  await waitFor(viewsHidden, 5_000, 'views hidden')
  await closeSettings(ctx)
})
test('Ctrl+, while the command palette is open leaves only Settings on screen', async () => {
  await pressInShell(ctx.app, 'K', [MOD])
  await expect(ctx.page.locator('[cmdk-input]')).toBeVisible()
  await pressInShell(ctx.app, ',', [MOD])
  await expect(dialog()).toBeVisible()
  await expect(ctx.page.locator('[cmdk-input]')).toHaveCount(0)
  await closeSettings(ctx)
  await waitFor(viewsVisible, 5_000, 'views visible again')
})
test('sidebar: tabs with roles, arrow keys move between them, the last tab is remembered', async () => {
  await ctx.page.click('[data-testid="open-settings"]')
  await expect(ctx.page.locator('[role="tablist"][aria-orientation="vertical"]')).toHaveCount(1)
  await ctx.page.click('[data-testid="settings-nav-general"]')
  await expect(ctx.page.locator('[data-testid="settings-nav-general"]')).toHaveAttribute('aria-selected', 'true')
  await ctx.page.keyboard.press('ArrowDown')
  await expect(ctx.page.locator('[data-testid="settings-nav-sessions"]')).toHaveAttribute('aria-selected', 'true')
  await expect(ctx.page.locator('[data-testid="settings-nav-sessions"]')).toBeFocused()
  await ctx.page.keyboard.press('ArrowDown')
  await expect(ctx.page.locator('[data-testid="settings-nav-agent"]')).toHaveAttribute('aria-selected', 'true')
  await ctx.page.keyboard.press('End')
  await expect(ctx.page.locator('[data-testid="settings-nav-about"]')).toHaveAttribute('aria-selected', 'true')
  await expect(ctx.page.locator('[data-testid="settings-title"]')).toHaveText('About & Privacy')
  await closeSettings(ctx)
  await ctx.page.click('[data-testid="open-settings"]')
  await expect(ctx.page.locator('[data-testid="settings-nav-about"]')).toHaveAttribute('aria-selected', 'true')
  await closeSettings(ctx)
})
test('General shows the version and the temp data folder', async () => {
  await ctx.page.click('[data-testid="open-settings"]')
  await ctx.page.click('[data-testid="settings-nav-general"]')
  const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version
  await expect(ctx.page.locator('[data-testid="app-version"]')).toHaveText(version)
  await expect(ctx.page.locator('[data-testid="user-data-path"]')).toHaveText(ctx.userDataDir)
  await closeSettings(ctx)
})
test('Sessions lists each session with env, tab count and effective access', async () => {
  await setGrant(ctx, local.id, 'control')
  await ctx.page.click('[data-testid="open-settings"]')
  await ctx.page.click('[data-testid="settings-nav-sessions"]')
  const row = ctx.page.locator(`[data-testid="session-row-${local.id}"]`)
  await expect(row).toContainText('Local QA')
  await expect(row).toContainText('local')
  await expect(row).toContainText('1 tab')
  await expect(ctx.page.locator(`[data-testid="session-access-${local.id}"]`)).toHaveText('Control')
  const p = ctx.page.locator(`[data-testid="session-row-${prod.id}"]`)
  await expect(p).toContainText('production')
  await expect(ctx.page.locator(`[data-testid="session-access-${prod.id}"]`)).toHaveText('Read')
  await closeSettings(ctx)
})
test('Chrome Import shows the import server on the test port and the extension folder', async () => {
  await ctx.page.click('[data-testid="open-settings"]')
  await ctx.page.click('[data-testid="settings-nav-import"]')
  await expect(ctx.page.locator('[data-testid="import-status"]')).toHaveText(`Listening on 127.0.0.1:${ctx.importPort}`)
  await expect(ctx.page.locator('[data-testid="extension-path"]')).toHaveText(join(projectRoot, 'chrome-extension'))
  await closeSettings(ctx)
})
test('Shortcuts lists every row of the shortcut table, including Cmd/Ctrl+,', async () => {
  await ctx.page.click('[data-testid="open-settings"]')
  await ctx.page.click('[data-testid="settings-nav-shortcuts"]')
  await expect(ctx.page.locator('[data-testid="shortcuts-table"] tbody tr')).toHaveCount(SHORTCUT_ROWS.length)
  await expect(ctx.page.locator('[data-testid="shortcuts-table"]')).toContainText('Open Settings')
  await closeSettings(ctx)
})
test('settings search finds real tabs, supports keyboard navigation, and stays readable', async () => {
  test.setTimeout(120_000)
  await setContentSize(1400, 900)
  await ctx.page.click('[data-testid="open-settings"]')
  await expect(dialog()).toBeVisible()
  await ctx.page.click('[data-testid="settings-nav-agent"]')
  await ctx.page.click('[data-testid="settings-subtab-overview"]')
  await expect(ctx.page.locator('[data-testid="settings-subtab-overview"]')).toHaveAttribute('data-state', 'active')
  await expect(ctx.page.locator('[data-testid="settings-nav-agent"]')).toContainText('MCP Server')
  await expect(ctx.page.locator('[data-testid="settings-nav-agent"]')).toContainText('Agent Bridge')
  await expect(ctx.page.locator('[data-testid="settings-title"]')).toHaveText('MCP Server (Agent Bridge)')
  await expect(dialog()).toContainText('Connect Cursor, Codex or Claude Code to your logged-in sessions through MCP.')
  await expect(ctx.page.getByRole('heading', { name: 'Connect an MCP client', exact: true })).toBeVisible()
  await capture(ctx.app, 'settings-search-overview')

  const search = ctx.page.locator('[data-testid="settings-dialog"] [role="searchbox"]')
  await search.fill('Chrome Import')
  const importResult = ctx.page.locator('[data-testid="settings-search-result-import"]')
  await expect(importResult).toContainText('Chrome Import')
  await expect(importResult).toContainText('Bring a logged-in Chrome tab into SessionForge.')
  await expect(importResult).toHaveAttribute('aria-describedby', 'settings-search-result-import-category settings-search-result-import-description')
  await expect(ctx.page.locator('#settings-search-result-import-category')).toHaveText('Chrome Import')
  await expect(ctx.page.locator('#settings-search-result-import-description')).toHaveText('Bring a logged-in Chrome tab into SessionForge.')
  await importResult.click()
  await expect(ctx.page.locator('[data-testid="settings-nav-import"]')).toHaveAttribute('aria-selected', 'true')
  await expect(ctx.page.locator('[data-testid="settings-title"]')).toHaveText('Chrome Import')

  await search.fill('permissions')
  await expect(ctx.page.locator('[data-testid^="settings-search-result-"]')).toHaveCount(1)
  await search.press('Enter')
  await expect(ctx.page.locator('[data-testid="settings-nav-agent"]')).toHaveAttribute('aria-selected', 'true')
  await expect(ctx.page.locator('[data-testid="settings-subtab-access"]')).toHaveAttribute('data-state', 'active')

  await search.fill('token')
  await expect(ctx.page.locator('[data-testid="settings-nav-agent"]')).toBeVisible()
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(dialog()).toBeVisible()
  await expect(search).toBeFocused()
  await search.fill('   ')
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(dialog()).toBeVisible()
  await expect(search).toBeFocused()
  await search.press('Escape')
  await expect(dialog()).toHaveCount(0)

  await openSettings(ctx, 'overview')
  await ctx.page.click('[data-testid="connect-mcp-client"]')
  await expect(ctx.page.locator('[data-testid="settings-subtab-editors"]')).toHaveAttribute('data-state', 'active')
  await expect(ctx.page.locator('[data-testid="settings-title"]')).toHaveText('MCP Server (Agent Bridge)')
  await search.fill('MCP')
  await expect(ctx.page.locator('[data-testid="settings-search-result-agent-editors"]')).toBeVisible()
  await ctx.page.locator('[data-testid="settings-search-result-agent-editors"]').click()
  await expect(ctx.page.locator('[data-testid="settings-subtab-editors"]')).toHaveAttribute('data-state', 'active')
  await expect(ctx.page.locator('[data-testid="settings-scroll"]')).toHaveJSProperty('scrollWidth', await ctx.page.locator('[data-testid="settings-scroll"]').evaluate((el) => el.clientWidth))
  await capture(ctx.app, 'settings-search-mcp')

  await setContentSize(1024, 700)
  await search.fill('something that is not a setting')
  await expect(ctx.page.locator('[data-testid="settings-search-no-results"]')).toContainText('No settings found')
  await expect(ctx.page.locator('[data-testid="settings-search-no-results-suggestion"]')).toContainText('MCP, Cursor, sessions, or shortcuts')
  const smallSettingsScroll = ctx.page.locator('[data-testid="settings-scroll"]')
  await expect(smallSettingsScroll).toHaveJSProperty('scrollWidth', await smallSettingsScroll.evaluate((el) => el.clientWidth))
  await capture(ctx.app, 'settings-search-no-results')
  await closeSettings(ctx)
  await setContentSize(1400, 900)
})

test('screenshots of every tab at 1400x900 and Editors at 1024x700', async () => {
  test.setTimeout(120_000)
  await setContentSize(1400, 900)
  const shot = async (name: string) => {
    await ctx.page.waitForTimeout(250) // open animation and fonts settle
    await capture(ctx.app, name)
  }
  await ctx.page.click('[data-testid="open-settings"]')
  for (const t of ['general', 'sessions', 'import', 'shortcuts', 'about'] as const) {
    await ctx.page.click(`[data-testid="settings-nav-${t}"]`)
    await shot(`settings-${t}`)
  }
  await closeSettings(ctx)
  for (const sub of ['overview', 'access', 'editors', 'token', 'activity'] as const) {
    await openSettings(ctx, sub)
    await shot(`settings-agent-${sub}`)
    await closeSettings(ctx)
  }
  await openSettings(ctx, 'editors')
  await ctx.page.locator('[data-testid="approval-card-cursor"]').scrollIntoViewIfNeeded()
  await shot('settings-agent-editors-approvals')
  await ctx.page.click('[data-testid="approval-preset-cursor-all"]')
  await ctx.page.click('[data-testid="approval-apply-cursor"]')
  await expect(ctx.page.locator('[data-testid="approval-ack"]')).toBeVisible()
  await shot('settings-agent-editors-apply-preview')
  await ctx.page.click('[data-testid="approval-dialog"] >> text=Cancel')
  await expect(ctx.page.locator('[data-testid="approval-dialog"]')).toHaveCount(0)
  await ctx.page.click('[data-testid="agent-editor-claude"]')
  await ctx.page.locator('[data-testid="approval-card-claude"]').scrollIntoViewIfNeeded()
  await shot('settings-agent-editors-claude')
  await ctx.page.click('[data-testid="agent-editor-codex"]')
  await ctx.page.locator('[data-testid="approval-card-codex"]').scrollIntoViewIfNeeded()
  await shot('settings-agent-editors-codex')
  // The existing .dark palette
  await ctx.page.evaluate(() => document.documentElement.classList.add('dark'))
  await ctx.page.click('[data-testid="agent-editor-cursor"]')
  await shot('settings-agent-editors-dark')
  await ctx.page.evaluate(() => document.documentElement.classList.remove('dark'))
  await closeSettings(ctx)
  await setContentSize(1024, 700)
  await openSettings(ctx, 'editors')
  // Nothing scrolls sideways at the small size
  const overflow = await ctx.page.evaluate(() => {
    const el = document.querySelector('[data-testid="settings-scroll"]')!
    return el.scrollWidth - el.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)
  await shot('settings-agent-editors-1024x700')
  await closeSettings(ctx)
  await setContentSize(1400, 900)
})
