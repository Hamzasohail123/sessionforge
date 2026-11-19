// A database from before closed_items still opens: sessions, tabs and the layout come back, the table
// is created, and a close left half done by a crash is cleaned up on the next start.
// better-sqlite3 is built for Electron's ABI, so the old schema is made from inside main.
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { launchApp, relaunch, teardown, waitFor, wm, type AppCtx } from './fixtures/app'
import { startTestServer, type TestServer } from './fixtures/test-server'
import { createHiddenTab, createSessions, getLayout, openSession, tabOf, waitLoaded, waitViewOnSlot } from './fixtures/ui'

test.describe.configure({ mode: 'serial' })

let ctx: AppCtx | undefined
let server: TestServer

type RawDb = { db: { exec(sql: string): void; prepare(sql: string): { get(...a: unknown[]): unknown } } }

const hasClosedTable = (c: AppCtx) =>
  wm(c.app, (sf) =>
    Boolean(
      (sf.db as unknown as RawDb).db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'closed_items'")
        .get()
    )
  )

test.beforeAll(async () => {
  server = await startTestServer()
})

test.afterAll(async () => {
  await teardown(ctx)
  await server?.close()
})

test('an older DB without closed_items opens, and a crash mid-close is cleaned up', async () => {
  ctx = await launchApp()
  const [old, crash] = await createSessions(ctx.page, [
    { name: 'Old', color: '#3b82f6' },
    { name: 'Crash', color: '#ef4444' }
  ])
  const oldTab = await createHiddenTab(ctx.app, old.id, `${server.base}/page?label=A`)
  const crashTab = await createHiddenTab(ctx.app, crash.id, `${server.base}/page?label=B`)
  await openSession(ctx.page, 'pane-1', old.id)
  await waitLoaded(ctx.page, oldTab, `${server.base}/page?label=A`, 'Page A')

  // Back to the schema before this change: the only difference is the new table and its indexes
  await wm(ctx.app, (sf) =>
    (sf.db as unknown as RawDb).db.exec(
      'DROP INDEX IF EXISTS idx_closed_session; DROP INDEX IF EXISTS idx_closed_items_session; DROP TABLE closed_items'
    )
  )
  expect(await hasClosedTable(ctx)).toBe(false)

  ctx = await relaunch(ctx)
  await ctx.page.waitForSelector(`[data-testid="session-${old.id}"]`)
  expect(await hasClosedTable(ctx)).toBe(true)
  expect((await ctx.page.evaluate((id) => window.api.tab.getBySession(id), old.id)).map((t) => t.id)).toEqual([oldTab])
  expect(tabOf(await getLayout(ctx.page), 'pane-1')).toBe(oldTab)
  await waitViewOnSlot(ctx.app, ctx.page, oldTab, 'pane-1')

  // Close and reopen work on the upgraded DB
  const closed = await ctx.page.evaluate((id) => window.api.session.close(id), old.id)
  expect(closed.name).toBe('Old')
  expect((await ctx.page.evaluate(() => window.api.session.getAll())).map((s) => s.name)).toEqual(['Crash'])
  const reopened = await ctx.page.evaluate(() => window.api.closed.reopenLast())
  expect(reopened).toMatchObject({ kind: 'session', sessionId: old.id, sessionName: 'Old' })
  const oldTabs = await ctx.page.evaluate((id) => window.api.tab.getBySession(id), old.id)
  expect(oldTabs.map((t) => t.url)).toEqual([`${server.base}/page?label=A`])
  await waitFor(async () => tabOf(await getLayout(ctx!.page), 'pane-1') === oldTabs[0].id, 5_000, 'pane-1 on Old')

  // Crash between "recorded" and "tabs closed": the entry exists but the tab row is still there
  await wm(
    ctx.app,
    (sf, a) =>
      sf.db.addClosedItem({
        id: a.id,
        kind: 'session',
        sessionId: a.sessionId,
        url: null,
        title: null,
        tabs: [],
        closedAt: Date.now()
      }),
    { id: randomUUID(), sessionId: crash.id }
  )
  expect(await ctx.page.evaluate((id) => window.api.tab.getBySession(id), crash.id)).toHaveLength(1)

  ctx = await relaunch(ctx)
  expect((await ctx.page.evaluate(() => window.api.session.getAll())).map((s) => s.name)).toEqual(['Old'])
  expect((await wm(ctx.app, (sf) => sf.windowManager.listTabs())).map((t) => t.id)).not.toContain(crashTab)
  expect(await ctx.page.evaluate((id) => window.api.tab.getBySession(id), crash.id)).toEqual([])
  expect(await wm(ctx.app, (sf, id) => sf.sessionManager.isClosed(id), crash.id)).toBe(true)
})
