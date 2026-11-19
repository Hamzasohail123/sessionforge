import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { closeApp, launchApp, relaunch, teardown, type AppCtx } from './fixtures/app'
import { capture } from './fixtures/capture'

// Fixture sanity: temp profile, renderer lookup, composite capture, clean quit
test('launches with a temp profile, captures the shell and relaunches', async () => {
  let ctx: AppCtx | undefined
  try {
    ctx = await launchApp()
    const userData = await ctx.app.evaluate(({ app }) => app.getPath('userData'))
    expect(userData).toBe(ctx.userDataDir)

    const file = await capture(ctx.app, 'launch-shell')
    expect(existsSync(file)).toBe(true)

    const started = Date.now()
    ctx = await relaunch(ctx)
    expect(Date.now() - started).toBeLessThan(30_000)
    await expect(ctx.page.locator('[data-testid="session-bar"]')).toBeVisible()
    await closeApp(ctx)
    expect(ctx.logs.join('')).not.toContain('Tab not found')
  } finally {
    await teardown(ctx)
  }
})
