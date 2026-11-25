import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { launchApp, teardown, waitFor, type AppCtx } from './fixtures/app'
import { capture, screenshotDir } from './fixtures/capture'
import { intersects, rectOf, setContentSize } from './fixtures/ui'

// The empty state has a centre "New session" button and the session bar has a labelled one;
// both open the same New Session dialog. The centre button is not reachable through the tour.
test.describe.configure({ mode: 'serial' })
let ctx: AppCtx | undefined
const c = (): AppCtx => {
  if (!ctx) throw new Error('no app')
  return ctx
}
const byId = (id: string) => c().page.getByTestId(id)

test.afterAll(async () => {
  await teardown(ctx)
  ctx = undefined
})

async function viewport(): Promise<{ w: number; h: number }> {
  return c().page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
}

async function renderer(width: number, height: number): Promise<void> {
  await setContentSize(c().app, width, height)
  await waitFor(
    () =>
      c().page.evaluate(
        ([w, h]) => (window.innerWidth <= w && window.innerHeight <= h ? true : null),
        [width, height]
      ),
    5_000,
    `renderer ${width}x${height}`
  )
}

test('the empty state shows a centred New session button', async () => {
  ctx = await launchApp()
  await expect(byId('empty-state')).toBeVisible()
  await expect(byId('empty-state')).toContainText('Welcome to SessionForge')
  await expect(byId('empty-state')).toContainText('Create a session to get started')
  const button = byId('empty-new-session')
  await expect(button).toBeVisible()
  await expect(button).toHaveText('New session')
  await expect(byId('empty-state').getByRole('button', { name: 'New session' })).toBeVisible()
  const b = (await button.boundingBox())!
  const vp = await viewport()
  expect(Math.abs(b.x + b.width / 2 - vp.w / 2)).toBeLessThanOrEqual(40)
  await capture(c().app, 'new-session-empty-state')
})

test('the session bar button shows its label at the default width', async () => {
  const button = byId('new-session')
  await expect(button).toBeVisible()
  await expect(button).toHaveText('New session')
  await expect(button).toHaveAttribute('aria-label', 'New session')
  await expect(button).toHaveAttribute('title', 'New session')
  await expect(byId('new-session-label')).toBeVisible()
  await expect(byId('session-bar').getByRole('button', { name: 'New session' })).toBeVisible()
  await byId('session-bar').screenshot({ path: join(screenshotDir, 'new-session-topbar.png') })
})

test('the centre button works from the keyboard', async () => {
  await byId('empty-new-session').focus()
  await c().page.keyboard.press('Enter')
  await expect(c().page.locator('#name')).toBeVisible()
  await c().page.keyboard.press('Escape')
  await expect(c().page.locator('#name')).toHaveCount(0)
})

test('the session bar button opens the same dialog', async () => {
  await byId('new-session').click()
  await expect(c().page.locator('#name')).toBeVisible()
  await c().page.keyboard.press('Escape')
  await expect(c().page.locator('#name')).toHaveCount(0)
})

test('creating a session from the centre button hides the empty state', async () => {
  const page = c().page
  await byId('empty-new-session').click()
  await page.fill('#name', 'From Empty State')
  await page.click('button:has-text("Create Session")')
  await page.waitForSelector('#name', { state: 'detached' })
  await expect(byId('empty-state')).toHaveCount(0)
  await expect(byId('empty-new-session')).toHaveCount(0)
  await expect(byId('split-view')).toBeVisible()
  const names = await page.evaluate(async () => (await window.api.session.getAll()).map((s) => s.name))
  expect(names).toContain('From Empty State')
  await expect(byId('session-bar')).toContainText('From Empty State')
})

test('on a narrow window the session bar button is icon-only but still a named button', async () => {
  try {
    await renderer(700, 600)
    const vp = await viewport()
    const button = byId('new-session')
    await expect(button).toBeVisible()
    await expect(byId('new-session-label')).toBeHidden()
    await expect(byId('session-bar').getByRole('button', { name: 'New session' })).toBeVisible()
    const b = (await button.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(vp.w)
    await byId('session-bar').screenshot({ path: join(screenshotDir, 'new-session-topbar-narrow.png') })
    await capture(c().app, 'new-session-narrow')
  } finally {
    await setContentSize(c().app, 1400, 900)
  }
})

test('the tour covers the centre button and its cards still sit beside their anchors', async () => {
  await teardown(ctx)
  ctx = undefined
  ctx = await launchApp({ env: { SESSIONFORGE_TEST_TOUR: '1' } })
  const card = byId('tour-card')
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card).toHaveAttribute('data-step', 'welcome')
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  await expect(byId('empty-new-session')).toBeVisible()
  await capture(c().app, 'new-session-tour-welcome')
  await expect(byId('empty-new-session').click({ trial: true, timeout: 1_500 })).rejects.toThrow()
  await expect(c().page.locator('#name')).toHaveCount(0)

  const vp = await viewport()
  const placed = async (anchor: string) => {
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    await expect
      .poll(async () => {
        const b = await rectOf(c().page, 'tour-card')
        const a = await rectOf(c().page, anchor)
        return b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.w && b.y + b.height <= vp.h && !intersects(a, b)
      })
      .toBe(true)
  }
  await byId('tour-start').click()
  await expect(card).toHaveAttribute('data-step', 'split-view')
  await placed('layout-switcher')
  await capture(c().app, 'new-session-tour-step-1')
  await byId('tour-next').click()
  await expect(card).toHaveAttribute('data-step', 'settings')
  await placed('open-settings')
  await capture(c().app, 'new-session-tour-step-2')
  await byId('tour-skip').click()
  await expect(card).toHaveCount(0)
})
