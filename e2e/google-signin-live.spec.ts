// Live check against the real https://accounts.google.com (skipped offline). No test origin and no
// browser log: nothing is typed or clicked, so no browser is ever started.
import { test, expect } from '@playwright/test'
import { internetAvailable, launchApp, teardown, waitFor, wm, type AppCtx } from './fixtures/app'
import { capture } from './fixtures/capture'
import { createHiddenTab, createSessions, intersects, rectOf, waitViewOnSlot } from './fixtures/ui'
import type { PaneId } from '../src/main/types'

let ctx: AppCtx | undefined

test.afterAll(async () => {
  await teardown(ctx)
})

test('accounts.google.com shows the Sign in with Chrome banner', async () => {
  test.skip(!(await internetAvailable()), 'offline')
  ctx = await launchApp()
  const [s] = await createSessions(ctx.page, [{ name: 'Google', color: '#ef4444' }])
  const tab = await createHiddenTab(ctx.app, s.id, 'https://accounts.google.com/')
  await ctx.page.evaluate(([p, t]) => window.api.layout.assignTab(p as PaneId, t), ['pane-1', tab] as const)

  await ctx.page.waitForSelector('[data-testid="signin-banner-pane-1"][data-kind="google-account"]', { timeout: 20_000 })
  const reached = await wm(ctx.app, (sf, id) => sf.windowManager.getTabState(id)?.url ?? '', tab)
  expect(new URL(reached).hostname).toBe('accounts.google.com')
  const view = await waitFor(
    async () => {
      const v = await waitViewOnSlot(ctx!.app, ctx!.page, tab, 'pane-1')
      return !intersects(v, await rectOf(ctx!.page, 'signin-banner-pane-1')) ? v : null
    },
    10_000,
    'view below the banner'
  )
  expect(view.height).toBeGreaterThan(100)
  // Let Google's page paint before the screenshot
  await waitFor(() => wm(ctx!.app, (sf, id) => !sf.windowManager.getTabState(id)?.isLoading, tab), 20_000, 'page loaded')
  await ctx.page.waitForTimeout(1500)
  const file = await capture(ctx.app, 'google-signin-banner')
  console.log('[live] reached', new URL(reached).origin + new URL(reached).pathname, 'screenshot', file)
  await expect(ctx.page.getByTestId('signin-banner-pane-1')).toHaveAttribute('data-state', 'offer')
})
