import { test, expect } from '@playwright/test'
import { launchApp, relaunch, teardown, waitFor, wm, type AppCtx } from './fixtures/app'
import { capture } from './fixtures/capture'
import { closeSettings } from './fixtures/mcp'
import {
  attachedViews,
  createSessions,
  getLayout,
  MOD,
  openSession,
  pressInShell,
  rectOf,
  setContentSize,
  setMode
} from './fixtures/ui'
import { TOUR_STEPS } from '../src/renderer/src/components/tour/tour-steps'

// First-run tour: suppressed in E2E unless SESSIONFORGE_TEST_TOUR=1, only for new profiles, skippable,
// replayable from Settings → General, and it restores Settings and focus when it ends.
test.describe.configure({ mode: 'serial' })
let ctx: AppCtx | undefined
const FLAG = { env: { SESSIONFORGE_TEST_TOUR: '1' } }
const STEPS = TOUR_STEPS.slice(1)
const c = (): AppCtx => {
  if (!ctx) throw new Error('no app')
  return ctx
}
const card = () => c().page.getByTestId('tour-card')
const byId = (id: string) => c().page.getByTestId(id)
const stored = (x: AppCtx) => wm(x.app, (sf) => sf.db.getSetting('onboardingTour.status'))

test.afterAll(async () => {
  await teardown(ctx)
  ctx = undefined
})

async function fresh(withFlag: boolean): Promise<void> {
  await teardown(ctx)
  ctx = undefined
  ctx = await launchApp(withFlag ? FLAG : {})
}

/** The spotlight is drawn around the anchor (±6 px) and the card is placed (fully opaque). */
async function settled(anchor: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const a = await rectOf(c().page, anchor)
        const s = await rectOf(c().page, 'tour-spotlight')
        const opacity = await card().evaluate((el) => getComputedStyle(el).opacity)
        const tol = 6
        return (
          opacity === '1' &&
          s.x <= a.x + tol &&
          s.y <= a.y + tol &&
          s.x + s.width >= a.x + a.width - tol &&
          s.y + s.height >= a.y + a.height - tol &&
          Math.abs(s.width - a.width) <= 8 + tol &&
          Math.abs(s.height - a.height) <= 8 + tol
        )
      },
      { timeout: 5_000 }
    )
    .toBe(true)
}

async function welcomeVisible(): Promise<void> {
  await expect(card()).toBeVisible({ timeout: 10_000 })
  await expect(card()).toHaveAttribute('data-step', 'welcome')
  await expect(byId('tour-title')).toHaveText('Welcome to SessionForge')
  await expect(byId('tour-start')).toBeFocused()
  await expect.poll(() => card().evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
}

async function focusedTestId(): Promise<{ id: string | null; tag: string; connected: boolean }> {
  return c().page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return { id: el?.dataset.testid ?? null, tag: el?.tagName ?? '', connected: el?.isConnected ?? false }
  })
}
const gearOrBody = (f: { id: string | null; tag: string; connected: boolean }) =>
  f.connected && (f.id === 'open-settings' || f.tag === 'BODY')

/** Settings → General → "Show tour again" */
async function replay(): Promise<void> {
  const page = c().page
  if ((await page.getByTestId('settings-dialog').count()) === 0) await page.click('[data-testid="open-settings"]')
  await page.click('[data-testid="settings-nav-general"]')
  await expect(byId('replay-tour')).toBeVisible()
  await page.click('[data-testid="replay-tour"]')
  await welcomeVisible()
}

async function zIndex(testId: string): Promise<number> {
  return Number(await byId(testId).evaluate((el) => getComputedStyle(el).zIndex))
}

/** Next from the current step until `id` is shown */
async function nextUntil(id: string): Promise<void> {
  for (let i = 0; i < STEPS.length; i++) {
    if ((await card().getAttribute('data-step')) === id) return
    await byId('tour-next').click()
    await expect(card()).toBeVisible()
  }
  await expect(card()).toHaveAttribute('data-step', id)
}

test('1. the tour does not auto-start under E2E without SESSIONFORGE_TEST_TOUR', async () => {
  await fresh(false)
  await c().page.waitForSelector('[data-testid="session-bar"]')
  await c().page.waitForTimeout(1_000)
  await expect(card()).toHaveCount(0)
  expect(await stored(c())).toBeNull()
})

test('2. a new profile walks the whole tour; Finish stores completed and it never auto-starts again', async () => {
  await fresh(true)
  const page = c().page
  await welcomeVisible()
  expect(await wm(c().app, (sf) => sf.windowManager.isOverlayOpen())).toBe(true)
  await expect(byId('tour-counter')).toHaveCount(0)
  await capture(c().app, 'tour-start')
  await byId('tour-start').click()

  for (const [i, s] of STEPS.entries()) {
    const n = i + 1
    await expect(card()).toHaveAttribute('data-step', s.id)
    await expect(byId('tour-title')).toHaveText(s.title)
    await expect(byId('tour-body')).toHaveText(s.body)
    await expect(byId('tour-counter')).toHaveText(`Step ${n} of 8`)
    await expect(byId('tour-next')).toHaveText(n === 8 ? 'Finish' : 'Next')
    await expect(byId('tour-back')).toHaveCount(n === 1 ? 0 : 1)
    if (s.view.kind === 'closed') await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
    if (s.view.kind === 'settings') {
      await expect(byId(`settings-nav-${s.view.tab}`)).toHaveAttribute('aria-selected', 'true')
      if (s.view.agentTab) await expect(byId(`settings-subtab-${s.view.agentTab}`)).toHaveAttribute('data-state', 'active')
    }
    await settled(s.anchor!)
    await expect(byId('tour-next')).toBeFocused()
    await expect(byId('tour-skip')).toBeVisible()
    await page.waitForTimeout(250) // let Settings' open animation finish for a clean screenshot
    await capture(c().app, `tour-step-${s.id}`)
    if (s.id === 'split-view') await capture(c().app, 'tour-skip-control')

    if (s.id === 'sessions') {
      // Spotlight above Settings, card above the spotlight (all are body portals: one stacking context)
      const spot = await zIndex('tour-spotlight')
      const settings = await zIndex('settings-dialog')
      const top = await zIndex('tour-card')
      expect(spot).toBe(55)
      expect(settings).toBe(50)
      expect(top).toBe(60)
      expect(spot).toBeGreaterThan(settings)
      expect(top).toBeGreaterThan(spot)

      // Back returns to General
      await byId('tour-back').click()
      await expect(card()).toHaveAttribute('data-step', 'general')
      await expect(byId('settings-nav-general')).toHaveAttribute('aria-selected', 'true')
      await byId('tour-next').click()
      await expect(card()).toHaveAttribute('data-step', 'sessions')
    }
    await byId('tour-next').click()
  }

  await expect(card()).toHaveCount(0)
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect.poll(() => stored(c())).toBe('completed')
  // The remembered tab is the default again (agent / overview)
  await page.click('[data-testid="open-settings"]')
  await expect(byId('settings-nav-agent')).toHaveAttribute('aria-selected', 'true')
  await expect(byId('settings-subtab-overview')).toHaveAttribute('data-state', 'active')
  await closeSettings(c())

  ctx = await relaunch(c(), FLAG)
  await c().page.waitForTimeout(1_000)
  await expect(card()).toHaveCount(0)
})

test('3. Skip on the welcome card stores skipped and leaves focus on the gear or body', async () => {
  await fresh(true)
  await welcomeVisible()
  await byId('tour-skip').click()
  await expect(card()).toHaveCount(0)
  await expect(c().page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect.poll(() => stored(c())).toBe('skipped')
  expect(gearOrBody(await focusedTestId())).toBe(true)
})

test('4. Skip mid-tour closes Settings again and stores skipped', async () => {
  await fresh(true)
  await welcomeVisible()
  await byId('tour-start').click()
  await nextUntil('sessions')
  await expect(c().page.getByTestId('settings-dialog')).toBeVisible()
  await byId('tour-skip').click()
  await expect(card()).toHaveCount(0)
  await expect(c().page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect.poll(() => stored(c())).toBe('skipped')
  await expect.poll(async () => gearOrBody(await focusedTestId())).toBe(true)
})

test('5. Esc skips mid-tour and on the replayed welcome card', async () => {
  await fresh(true)
  await welcomeVisible()
  await byId('tour-start').click()
  await nextUntil('mcp')
  await settled('agent-enable')
  await c().page.keyboard.press('Escape')
  await expect(card()).toHaveCount(0)
  // Esc ended the tour only; the restore closed Settings
  await expect(c().page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect.poll(() => stored(c())).toBe('skipped')

  await replay()
  await pressInShell(c().app, 'Escape')
  await expect(card()).toHaveCount(0)
  await expect(c().page.getByTestId('settings-dialog')).toBeVisible()
  await expect(byId('settings-nav-general')).toHaveAttribute('aria-selected', 'true')
  expect(await stored(c())).toBe('skipped')
})

test('6. replay restores Settings (tab and sub-tab), focus and leaves the layout alone', async () => {
  const page = c().page
  await closeSettings(c())
  const [s] = await createSessions(page, [{ name: 'Tour', color: '#3b82f6' }])
  await openSession(page, 'pane-1', s.id)
  await setMode(page, 'columns')
  await expect.poll(async () => (await getLayout(page)).mode).toBe('columns')
  await expect.poll(async () => (await attachedViews(c().app)).some((v) => v.visible)).toBe(true)

  await page.click('[data-testid="open-settings"]')
  await page.click('[data-testid="settings-nav-agent"]')
  await page.click('[data-testid="settings-subtab-token"]')
  await expect(byId('settings-subtab-token')).toHaveAttribute('data-state', 'active')
  await page.click('[data-testid="settings-nav-general"]')
  await expect(byId('replay-tour')).toBeVisible()
  await page.waitForTimeout(250)
  await capture(c().app, 'tour-replay-entry')

  await page.click('[data-testid="replay-tour"]')
  await welcomeVisible()
  // The welcome dim sits above Settings
  expect(await zIndex('tour-dim')).toBeGreaterThan(await zIndex('settings-dialog'))
  await byId('tour-start').click()
  await expect(card()).toHaveAttribute('data-step', 'split-view')
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  await nextUntil('general')
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
  await nextUntil('about')
  await byId('tour-next').click()

  await expect(card()).toHaveCount(0)
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
  await expect(byId('settings-nav-general')).toHaveAttribute('aria-selected', 'true')
  await expect(byId('replay-tour')).toBeFocused()
  await expect.poll(() => stored(c())).toBe('completed')
  expect((await getLayout(page)).mode).toBe('columns')
  await page.click('[data-testid="settings-nav-agent"]')
  await expect(byId('settings-subtab-token')).toHaveAttribute('data-state', 'active')
  await closeSettings(c())
  await expect.poll(async () => {
    const v = await attachedViews(c().app)
    return v.length > 0 && v.some((x) => x.visible)
  }).toBe(true)
})

test('7. app shortcuts are ignored while the tour runs', async () => {
  await replay()
  await byId('tour-start').click()
  await expect(card()).toHaveAttribute('data-step', 'split-view')
  await pressInShell(c().app, 'K', [MOD])
  await c().page.waitForTimeout(500)
  await expect(c().page.locator('[cmdk-input]')).toHaveCount(0)
  await expect(card()).toBeVisible()
  await byId('tour-skip').click()
  await expect(card()).toHaveCount(0)
})

test('8. on a narrow window every card stays inside the viewport', async () => {
  try {
    await setContentSize(c().app, 820, 600)
    await waitFor(
      () => c().page.evaluate(() => (window.innerWidth <= 820 && window.innerHeight <= 600 ? true : null)),
      5_000,
      'renderer 820x600'
    )
    const vp = await c().page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    const inside = async () => {
      const b = await card().boundingBox()
      return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.w && b.y + b.height <= vp.h
    }
    await replay()
    await expect.poll(inside).toBe(true)
    await byId('tour-start').click()
    for (const s of STEPS) {
      await expect(card()).toHaveAttribute('data-step', s.id)
      await settled(s.anchor!)
      await expect.poll(inside).toBe(true)
      await expect(byId('tour-next')).toBeVisible()
      await expect(byId('tour-skip')).toBeVisible()
      await byId('tour-next').click()
    }
    await expect(card()).toHaveCount(0)
  } finally {
    await setContentSize(c().app, 1400, 900)
  }
})

test('9. the card is a labelled dialog and Tab stays inside it', async () => {
  await replay()
  await byId('tour-start').click()
  await byId('tour-next').click()
  await expect(card()).toHaveAttribute('data-step', 'settings')
  await expect(card()).toHaveAttribute('role', 'dialog')
  const labelledBy = await card().getAttribute('aria-labelledby')
  expect(labelledBy).toBeTruthy()
  expect(await c().page.evaluate((id) => document.getElementById(id)?.dataset.testid ?? null, labelledBy!)).toBe(
    'tour-title'
  )
  const describedBy = await card().getAttribute('aria-describedby')
  expect(await c().page.evaluate((id) => document.getElementById(id)?.dataset.testid ?? null, describedBy!)).toBe(
    'tour-body'
  )
  await expect(byId('tour-next')).toBeFocused()
  for (let i = 0; i < 3; i++) {
    await c().page.keyboard.press('Tab')
    expect(await card().evaluate((el) => el.contains(document.activeElement))).toBe(true)
  }
  await byId('tour-skip').click()
  await expect(card()).toHaveCount(0)
})

test('10. a profile with an existing session does not auto-start but can replay', async () => {
  await fresh(false)
  await createSessions(c().page, [{ name: 'Existing', color: '#3b82f6' }])
  ctx = await relaunch(c(), FLAG)
  await c().page.waitForSelector('[data-testid="session-bar"]')
  await c().page.waitForTimeout(1_000)
  await expect(card()).toHaveCount(0)
  expect(await stored(c())).toBeNull()

  await replay()
  await byId('tour-start').click()
  for (const s of STEPS) {
    await expect(card()).toHaveAttribute('data-step', s.id)
    await byId('tour-next').click()
  }
  await expect(card()).toHaveCount(0)
  await expect.poll(() => stored(c())).toBe('completed')
})
