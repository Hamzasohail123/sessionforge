import { test, expect } from '@playwright/test'
import { request } from 'node:http'
import { launchApp, relaunch, tabEval, teardown, waitFor, wm, type AppCtx } from './fixtures/app'
import { capture, colorMatches, sampleTab } from './fixtures/capture'
import { LABEL_COLORS, startTestServer, type TestServer } from './fixtures/test-server'
import { attachedViews, getLayout, logsHaveTabNotFound, tabOf, waitLoaded, waitViewOnSlot } from './fixtures/ui'
import type { LayoutMode, PaneId, Session } from '../src/main/types'

test.describe.configure({ mode: 'serial' })

let ctx: AppCtx
let server: TestServer

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  json: Record<string, unknown> | null
}

/** POST /import through node:http (so Origin, Content-Length and chunked bodies are under test control). */
function post(
  body: string | Buffer | Buffer[],
  opts: { headers?: Record<string, string>; method?: string } = {}
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...opts.headers }
    // An array is sent chunk by chunk without Content-Length (Transfer-Encoding: chunked)
    if (!Array.isArray(body)) headers['content-length'] = String(Buffer.byteLength(body))
    const req = request(
      { host: '127.0.0.1', port: ctx.importPort, path: '/import', method: opts.method ?? 'POST', headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json: Reply['json'] = null
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
    if (Array.isArray(body)) {
      for (const c of body) req.write(c)
      req.end()
    } else {
      req.end(body)
    }
  })
}

function payload(label: string, extra: { cookies?: unknown[]; origins?: unknown[] } = {}) {
  return {
    action: 'import',
    storageState: { cookies: extra.cookies ?? [], origins: extra.origins ?? [] },
    metadata: { url: `${server.base}/page?label=${label}`, title: `Page ${label}` }
  }
}

const sessions = (): Promise<Session[]> => ctx.page.evaluate(() => window.api.session.getAll())

test.beforeAll(async () => {
  server = await startTestServer()
  ctx = await launchApp()
})

test.afterAll(async () => {
  await teardown(ctx)
  await server?.close()
})

test('import opens the page in a pane with its cookies and localStorage seeded before page scripts', async () => {
  const nowSec = Math.floor(Date.now() / 1000)
  const res = await post(
    JSON.stringify(
      payload('A', {
        cookies: [
          { name: 'host1', value: 'h', domain: '127.0.0.1', path: '/', expires: nowSec + 3600 },
          { name: 'ho', value: 'secret', domain: '127.0.0.1', path: '/', httpOnly: true },
          { name: 'strict', value: 's', domain: '127.0.0.1', path: '/', sameSite: 'Strict' },
          { name: 'expired', value: 'e', domain: '127.0.0.1', path: '/', expires: nowSec - 3600 }
        ],
        // Trailing slash exercises origin normalization
        origins: [{ origin: `${server.base}/`, localStorage: [{ name: 'seeded', value: 'yes' }] }]
      })
    )
  )
  expect(res.status).toBe(200)
  const body = res.json as {
    success: boolean
    sessionId: string
    tabId: string
    paneId: PaneId
    cookies: { imported: number; failed: number; skipped: number }
    localStorageOrigins: number
  }
  expect(body.success).toBe(true)
  expect(body.cookies).toEqual({ imported: 3, failed: 0, skipped: 1 })
  expect(body.localStorageOrigins).toBe(1)

  const all = await sessions()
  const created = all.find((s) => s.id === body.sessionId)
  expect(created?.name).toBe('127.0.0.1')

  const layout = await getLayout(ctx.page)
  expect(body.paneId).toBe('pane-1')
  expect(tabOf(layout, body.paneId)).toBe(body.tabId)
  expect(layout.panes.find((p) => p.paneId === body.paneId)?.sessionId).toBe(body.sessionId)

  const cookies = await wm(
    ctx.app,
    async (sf, id) => (await sf.sessionManager.getElectronSession(id)!.cookies.get({})).map((c) => ({
      name: c.name,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      hostOnly: c.hostOnly
    })),
    body.sessionId
  )
  const byName = Object.fromEntries(cookies.map((c) => [c.name, c]))
  expect(Object.keys(byName).sort()).toEqual(['ho', 'host1', 'strict'])
  expect(byName.ho.httpOnly).toBe(true)
  expect(byName.strict.sameSite).toBe('strict')
  expect(byName.host1.hostOnly).toBe(true)

  await waitLoaded(ctx.page, body.tabId, `${server.base}/page`, 'Page A')
  // httpOnly cookies are sent with the request too
  const sent = String(server.lastHeaders.get('/page')?.cookie ?? '')
  for (const name of ['host1', 'ho', 'strict']) expect(sent).toContain(`${name}=`)
  expect(sent).not.toContain('expired=')
  // Recorded by the page's first inline script: the value was there before any page code ran
  expect(await tabEval(ctx.app, body.tabId, 'window.__firstLocalStorage')).toBe('yes')

  // The renderer heard about it: session button and toast
  await ctx.page.waitForSelector(`[data-testid="session-${body.sessionId}"]`)
  await expect(ctx.page.getByText('Imported 127.0.0.1', { exact: true })).toBeVisible()
  await waitViewOnSlot(ctx.app, ctx.page, body.tabId, 'pane-1')
  expect(colorMatches(await sampleTab(ctx.app, body.tabId), LABEL_COLORS.A)).toBe(true)
  // A short toast does not hide the just-imported page
  const views = await attachedViews(ctx.app)
  expect(views.length).toBe(1)
  expect(views.every((v) => v.visible)).toBe(true)
  await capture(ctx.app, 'import-pane')
})

test('further imports grow single → columns → grid, then replace the active pane', async () => {
  const steps: Array<{ label: string; mode: LayoutMode; pane: PaneId; name: string }> = [
    { label: 'B', mode: 'columns', pane: 'pane-2', name: '127.0.0.1 2' },
    { label: 'C', mode: 'grid', pane: 'pane-3', name: '127.0.0.1 3' },
    { label: 'D', mode: 'grid', pane: 'pane-4', name: '127.0.0.1 4' },
    { label: 'A', mode: 'grid', pane: 'pane-4', name: '127.0.0.1 5' } // pane-4 is active after the 4th
  ]
  const tabs: Record<string, string> = { 'pane-1': tabOf(await getLayout(ctx.page), 'pane-1')! }
  for (const [i, step] of steps.entries()) {
    const res = await post(JSON.stringify(payload(step.label)))
    expect(res.status, step.name).toBe(200)
    const body = res.json as { sessionId: string; tabId: string; paneId: PaneId }
    expect(body.paneId, step.name).toBe(step.pane)
    const layout = await getLayout(ctx.page)
    expect(layout.mode, step.name).toBe(step.mode)
    expect(tabOf(layout, step.pane)).toBe(body.tabId)
    expect(layout.activePaneId).toBe(step.pane)
    // Panes that were not the target keep their tabs
    for (const [pane, tab] of Object.entries(tabs)) {
      if (pane !== step.pane) expect(tabOf(layout, pane as PaneId), `${step.name} ${pane}`).toBe(tab)
    }
    const replaced = tabs[step.pane]
    tabs[step.pane] = body.tabId
    await waitLoaded(ctx.page, body.tabId, `${server.base}/page`, `Page ${step.label}`)
    expect((await sessions()).find((s) => s.id === body.sessionId)?.name).toBe(step.name)

    await expect(ctx.page.getByText(`Imported ${step.name}`, { exact: true })).toBeVisible()
    await waitViewOnSlot(ctx.app, ctx.page, body.tabId, step.pane)
    const views = await attachedViews(ctx.app)
    expect(views.every((v) => v.visible), `views visible with the toast open (${step.name})`).toBe(true)

    if (i === 2) {
      // Four panes A | B / C | D
      for (const [pane, label] of [['pane-1', 'A'], ['pane-2', 'B'], ['pane-3', 'C'], ['pane-4', 'D']]) {
        expect(colorMatches(await sampleTab(ctx.app, tabs[pane]), LABEL_COLORS[label]), pane).toBe(true)
      }
      await capture(ctx.app, 'import-grid-full')
    }
    if (i === 3) {
      // The replaced tab stays open in its session, just not shown
      expect(Object.values(tabs)).not.toContain(replaced)
      expect(await ctx.page.evaluate((id) => window.api.tab.getState(id), replaced)).not.toBeNull()
    }
  }

  const all = await sessions()
  expect(all).toHaveLength(5)
  expect(new Set(all.map((s) => s.name)).size).toBe(5)
  expect(new Set(all.map((s) => s.color)).size).toBe(5)
})

test('extension preflight: chrome-extension origin is echoed, never *', async () => {
  const res = await post('', { method: 'OPTIONS', headers: { origin: 'chrome-extension://abcdef' } })
  expect(res.status).toBe(204)
  expect(res.headers['access-control-allow-origin']).toBe('chrome-extension://abcdef')
  expect(res.headers['access-control-allow-methods']).toBe('POST, OPTIONS')
})

test('rejected requests answer 400/400/403/403/413/413 and create no session', async () => {
  const before = (await sessions()).length
  const big = Buffer.alloc(6 * 1024 * 1024, 'a')

  const invalidJson = await post('{not json')
  expect(invalidJson.status).toBe(400)
  expect(invalidJson.json?.error).toBe('Invalid JSON')

  const noUrl = await post(JSON.stringify({ storageState: { cookies: [] }, metadata: {} }))
  expect(noUrl.status).toBe(400)
  expect(String(noUrl.json?.error)).toContain('metadata.url')

  const evil = await post(JSON.stringify(payload('A')), { headers: { origin: 'https://evil.example' } })
  expect(evil.status).toBe(403)
  expect(evil.json?.error).toBe('Origin not allowed')
  expect(evil.headers['access-control-allow-origin']).toBeUndefined()

  // Names that only resolve to loopback (nip.io, localtest.me, DNS rebinding) are refused by Host
  for (const host of [`127.0.0.1.nip.io:${ctx.importPort}`, `localtest.me:${ctx.importPort}`, '127.0.0.1:1']) {
    const res = await post(JSON.stringify(payload('A')), { headers: { host } })
    expect(res.status, host).toBe(403)
    expect(res.json?.error).toBe('Host not allowed')
  }
  const literal = await post('{not json', { headers: { host: `localhost:${ctx.importPort}` } })
  expect(literal.status).toBe(400)

  // Draining lets the client read the 413 instead of seeing a reset
  const withLength = await post(big)
  expect(withLength.status).toBe(413)
  expect(withLength.json?.error).toBe('Payload too large (max 5 MB)')

  const chunks = Array.from({ length: 6 }, () => Buffer.alloc(1024 * 1024, 'a'))
  const chunked = await post(chunks)
  expect(chunked.status).toBe(413)

  expect(await post('{}', { method: 'GET' }).then((r) => r.status)).toBe(404)
  expect((await sessions()).length).toBe(before)
})

test('extension-shaped metadata (10 KB data: favicon, long title) still imports', async () => {
  const body = payload('B') as ReturnType<typeof payload> & { metadata: { favicon?: string } }
  body.metadata.title = 'T'.repeat(800)
  body.metadata.favicon = 'data:image/png;base64,' + 'A'.repeat(10 * 1024)
  const res = await post(JSON.stringify(body), { headers: { origin: 'chrome-extension://abcdef' } })
  expect(res.status, String(res.json?.error)).toBe(200)
  const { sessionId, tabId } = res.json as { sessionId: string; tabId: string }
  expect((await sessions()).some((s) => s.id === sessionId)).toBe(true)
  await waitLoaded(ctx.page, tabId, `${server.base}/page`, 'Page B')
})

test('a failed createTab answers 500 and leaves no session behind', async () => {
  const before = (await sessions()).map((s) => s.id)
  await wm(ctx.app, (sf) => {
    // Own property shadows the prototype method until it is deleted again
    (sf.windowManager as unknown as Record<string, unknown>).createTab = async () => {
      throw new Error('Shutting down')
    }
  })
  try {
    const res = await post(JSON.stringify(payload('C')))
    expect(res.status).toBe(500)
    expect(res.json?.error).toBe('Shutting down')
  } finally {
    await wm(ctx.app, (sf) => {
      delete (sf.windowManager as unknown as Record<string, unknown>).createTab
    })
  }
  expect((await sessions()).map((s) => s.id)).toEqual(before)
  expect(await wm(ctx.app, (sf) => sf.db.getAllSessions().length)).toBe(before.length)
})

test('file-dialog path: a Playwright file parsed with StorageStateSchema maps sameSite None', async () => {
  const fileJson = {
    cookies: [{ name: 'pw', value: 'x', domain: 'secure.example', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'None' }],
    origins: []
  }
  const stored = await wm(
    ctx.app,
    async (sf, file) => {
      const { session, cookies } = await sf.sessionManager.importFromPlaywright('From file', sf.StorageStateSchema.parse(file))
      const all = await sf.sessionManager.getElectronSession(session.id)!.cookies.get({ name: 'pw' })
      return { counts: cookies, sameSite: all[0]?.sameSite, secure: all[0]?.secure }
    },
    fileJson
  )
  expect(stored.counts).toEqual({ imported: 1, failed: 0, skipped: 0 })
  expect(stored.sameSite).toBe('no_restriction')
  expect(stored.secure).toBe(true)
})

test('no "Tab not found" and no cookie values in the app logs', async () => {
  const logs = ctx.logs.join('')
  expect(logsHaveTabNotFound(ctx.logs)).toBe(false)
  expect(logs).not.toContain('secret')
})

test('imported cookies after a relaunch: session (expires -1) and persistent', async () => {
  const nowSec = Math.floor(Date.now() / 1000)
  const res = await post(
    JSON.stringify(
      payload('D', {
        cookies: [
          { name: 'sessonly', value: 's', domain: '127.0.0.1', path: '/', expires: -1 },
          { name: 'persist', value: 'p', domain: '127.0.0.1', path: '/', expires: nowSec + 3600 }
        ]
      })
    )
  )
  expect(res.status).toBe(200)
  const { sessionId, tabId } = res.json as { sessionId: string; tabId: string }
  ctx = await relaunch(ctx)
  const names = await wm(
    ctx.app,
    async (sf, id) => (await sf.sessionManager.getElectronSession(id)!.cookies.get({})).map((c) => c.name).sort(),
    sessionId
  )
  // Session cookies get a 30-day expiry on import, so they survive the restart
  expect(names).toEqual(['persist', 'sessonly'])
  await wm(ctx.app, (sf, a) => sf.windowManager.navigateTo(a.tabId, a.url), { tabId, url: server.base + '/headers' })
  const text = await waitFor(
    async () => {
      const t = await tabEval<string>(ctx.app, tabId, "document.getElementById('cookie')?.textContent ?? ''").catch(
        () => ''
      )
      return t.includes('sessonly=s') ? t : null
    },
    10_000,
    'session cookie sent after relaunch'
  )
  expect(text).toContain('persist=p')
})
