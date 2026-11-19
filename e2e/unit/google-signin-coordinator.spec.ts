import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { GoogleSignInCoordinator, type BroadcastWindow } from '../../src/main/google-signin/coordinator'
import { PENDING_TTL_MS } from '../../src/main/google-signin/pending-store'
import type { ImportStatusInput, SignInWindowPort } from '../../src/main/google-signin/types'
import type { PaneId } from '../../src/main/types'

const LOCAL = 'http://localhost:41234'
const SITE = 'http://127.0.0.1:41234'
const GMAIL = 'https://accounts.google.com/v3/signin/identifier?continue=https://mail.google.com/mail/u/0/&service=mail'

class FakeWindows implements SignInWindowPort {
  tabs = new Map<string, { sessionId: string; url: string }>()
  panes = new Map<string, PaneId>()
  active: PaneId = 'pane-1'
  calls: string[] = []
  getTabState(id: string) {
    return this.tabs.get(id) ?? null
  }
  getPaneOfTab(id: string) {
    return this.panes.get(id) ?? null
  }
  getLayoutState() {
    return { activePaneId: this.active }
  }
  navigateTo(id: string, url: string) {
    this.calls.push(`navigate ${id} ${url}`)
    const t = this.tabs.get(id)
    if (t) t.url = url
  }
  async createTab(sessionId: string, url: string) {
    const id = randomUUID()
    this.tabs.set(id, { sessionId, url })
    this.calls.push(`create ${id}`)
    return { id }
  }
  assignTab(pane: PaneId, id: string) {
    for (const [t, p] of this.panes) if (p === pane) this.panes.delete(t)
    this.panes.set(id, pane)
    this.calls.push(`assign ${pane} ${id}`)
  }
  focusPane(pane: PaneId) {
    this.calls.push(`focus ${pane}`)
  }
  closeTab(id: string) {
    this.tabs.delete(id)
    this.panes.delete(id)
    this.calls.push(`close ${id}`)
  }
  bringToFront() {
    this.calls.push('front')
  }
}

function setup(opts: { status?: ImportStatusInput; openFails?: boolean } = {}) {
  let now = 1_000_000
  const windows = new FakeWindows()
  const sessions = new Map([
    ['s1', { id: 's1', name: 'Gmail', color: '#ef4444' }],
    ['s2', { id: 's2', name: 'Site', color: '#3b82f6' }]
  ])
  const opened: string[] = []
  let status: ImportStatusInput = opts.status ?? { port: 34567, listening: true }
  const c = new GoogleSignInCoordinator({
    windows,
    sessions: { getSession: (id) => sessions.get(id) },
    testOrigins: [LOCAL],
    open: async (url) => {
      opened.push(url)
      if (opts.openFails) throw new Error('Could not open a browser')
      return { browser: 'Google Chrome', via: 'test-log' }
    },
    importStatus: () => status,
    e2e: false,
    storeOptions: { timers: false, now: () => now }
  })
  const sent: Array<{ channel: string; payload: any }> = []
  let destroyed = false
  const win: BroadcastWindow = {
    isDestroyed: () => destroyed,
    webContents: { send: (channel, payload) => void sent.push({ channel, payload }) }
  }
  const tab = (id: string, sessionId: string, url: string, pane?: PaneId) => {
    windows.tabs.set(id, { sessionId, url })
    if (pane) windows.panes.set(id, pane)
  }
  const nav = (tabId: string, url: string, chain: string[] = [], openerTabId: string | null = null) => {
    const t = windows.tabs.get(tabId)
    if (t) t.url = url
    c.onNavigate({ tabId, sessionId: t?.sessionId ?? 's1', url, chain, openerTabId })
  }
  return {
    c,
    windows,
    sessions,
    opened,
    sent,
    win,
    tab,
    nav,
    advance: (ms: number) => (now += ms),
    setStatus: (s: ImportStatusInput) => (status = s),
    destroy: () => (destroyed = true)
  }
}

test('broadcasts: nothing before init, then changes only, nothing to a destroyed window', () => {
  const r = setup()
  r.tab('t1', 's1', 'https://mail.google.com/', 'pane-1')
  r.nav('t1', GMAIL)
  expect(r.sent).toEqual([])
  expect(r.c.getState('t1')?.status).toBe('offer')

  r.c.init(r.win)
  r.c.dismiss('t1')
  expect(r.sent).toEqual([{ channel: 'signin:state', payload: { tabId: 't1', state: null } }])
  r.c.dismiss('t1')
  expect(r.sent).toHaveLength(1)

  r.destroy()
  r.nav('t1', 'https://mail.google.com/mail/u/0/')
  r.nav('t1', GMAIL)
  expect(r.sent).toHaveLength(1)
})

test('onNavigate: a sign-in page offers; a site records lastSiteUrl and shows nothing; unknown tabs are ignored', () => {
  const r = setup()
  r.tab('t1', 's2', `${SITE}/site`, 'pane-1')
  r.nav('t1', `${SITE}/site`)
  expect(r.c.getState('t1')).toBeNull()
  expect(r.c.isGoogleSignInTab('t1')).toBe(false)
  r.nav('t1', 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x')
  expect(r.c.getState('t1')).toMatchObject({ status: 'offer', kind: 'oauth', targetHost: '127.0.0.1:41234', notice: null })

  // A tab WindowManager no longer knows leaves no track behind
  r.c.onNavigate({ tabId: 'gone', sessionId: 's1', url: GMAIL, chain: [], openerTabId: null })
  expect(r.c.getState('gone')).toBeNull()
  expect(r.c.isGoogleSignInTab('gone')).toBe(false)
})

test('a fresh tab on a bare OAuth URL is unavailable', () => {
  const r = setup()
  r.tab('t1', 's1', `${LOCAL}/v3/signin/identifier`, 'pane-1')
  r.nav('t1', `${LOCAL}/v3/signin/identifier`, [`${LOCAL}/o/oauth2/v2/bare`, `${LOCAL}/v3/signin/identifier`])
  expect(r.c.getState('t1')).toMatchObject({ status: 'unavailable', kind: 'oauth', targetHost: null })
})

test('start: opens the plan URL and waits; blockers and launch failures create nothing', async () => {
  const r = setup()
  r.c.init(r.win)
  r.tab('t1', 's1', GMAIL, 'pane-1')
  r.nav('t1', GMAIL)
  const state = await r.c.start('t1')
  expect(r.opened).toHaveLength(1)
  expect(new URL(r.opened[0]).pathname).toBe('/ServiceLogin')
  expect(state).toMatchObject({ status: 'waiting', browser: 'Google Chrome', expiresAt: 1_000_000 + PENDING_TTL_MS })
  expect(r.c.pending.list()).toHaveLength(1)
  expect(r.sent.at(-1)?.payload.state.status).toBe('waiting')

  r.setStatus({ port: 34567, listening: false, error: 'port 34567 is in use' })
  r.c.cancel('t1')
  await expect(r.c.start('t1')).rejects.toThrow('port 34567 is in use')
  expect(r.opened).toHaveLength(1)
  expect(r.c.pending.list()).toEqual([])

  const f = setup({ openFails: true })
  f.tab('t1', 's1', GMAIL, 'pane-1')
  f.nav('t1', GMAIL)
  await expect(f.c.start('t1')).rejects.toThrow('Could not open a browser')
  expect(f.c.pending.list()).toEqual([])
  expect(f.c.getState('t1')).toMatchObject({ status: 'offer', notice: 'failed' })

  const n = setup()
  n.tab('t1', 's1', `${SITE}/x`)
  n.nav('t1', `${SITE}/x`)
  await expect(n.c.start('t1')).rejects.toThrow('This tab is not on a Google sign-in page.')
})

test('the state is "offer" while the browser is still opening (browser null)', async () => {
  const r = setup()
  let release: () => void = () => undefined
  const c2 = new GoogleSignInCoordinator({
    windows: r.windows,
    sessions: { getSession: (id) => r.sessions.get(id) },
    testOrigins: [],
    open: () => new Promise((ok) => (release = () => ok({ browser: 'Chromium', via: 'spawn' }))),
    importStatus: () => ({ port: 34567, listening: true }),
    e2e: false,
    storeOptions: { timers: false }
  })
  r.tab('t1', 's1', GMAIL, 'pane-1')
  c2.onNavigate({ tabId: 't1', sessionId: 's1', url: GMAIL, chain: [], openerTabId: null })
  const p = c2.start('t1')
  expect(c2.pending.list()).toHaveLength(1)
  expect(c2.getState('t1')).toMatchObject({ status: 'offer', browser: null })
  release()
  expect(await p).toMatchObject({ status: 'waiting', browser: 'Chromium' })
})

test('expiry noticed by a purge: notice "expired", state "offer", one broadcast', async () => {
  const r = setup()
  r.c.init(r.win)
  r.tab('t1', 's1', GMAIL, 'pane-1')
  r.nav('t1', GMAIL)
  await r.c.start('t1')
  const before = r.sent.length
  r.advance(PENDING_TTL_MS)
  expect(r.c.listForExtension()).toEqual([])
  expect(r.sent.length).toBe(before + 1)
  expect(r.sent.at(-1)?.payload.state).toMatchObject({ status: 'offer', notice: 'expired' })
  expect(r.c.getState('t1')).toMatchObject({ status: 'offer', notice: 'expired' })
})

test('dismiss hides the banner but the agent still sees a sign-in tab; leaving to a site resets it', () => {
  const r = setup()
  r.tab('t1', 's1', GMAIL, 'pane-1')
  r.nav('t1', GMAIL)
  r.c.dismiss('t1')
  expect(r.c.getState('t1')).toBeNull()
  expect(r.c.isGoogleSignInTab('t1')).toBe(true)
  r.nav('t1', 'https://accounts.google.com/v3/signin/rejected')
  expect(r.c.getState('t1')).toBeNull()
  r.nav('t1', 'https://mail.google.com/mail/u/0/')
  r.nav('t1', GMAIL)
  expect(r.c.getState('t1')?.status).toBe('offer')
})

test('listForExtension: exact summary keys; a request whose session is gone is dropped and cancelled', async () => {
  const r = setup()
  r.tab('t1', 's1', GMAIL, 'pane-1')
  r.nav('t1', GMAIL)
  await r.c.start('t1')
  const list = r.c.listForExtension()
  expect(list).toHaveLength(1)
  expect(Object.keys(list[0]).sort()).toEqual(['cookieDomains', 'expiresAt', 'id', 'sessionColor', 'sessionName'])
  expect(list[0]).toMatchObject({ sessionName: 'Gmail', sessionColor: '#ef4444', cookieDomains: ['google.com'] })

  r.sessions.delete('s1')
  expect(r.c.listForExtension()).toEqual([])
  expect(r.c.pending.list()).toEqual([])
})

test('takeRequest is one-time and needs a live session', async () => {
  const r = setup()
  r.tab('t1', 's1', GMAIL, 'pane-1')
  r.nav('t1', GMAIL)
  await r.c.start('t1')
  const id = r.c.pending.list()[0].id
  expect(r.c.takeRequest(id)?.id).toBe(id)
  expect(r.c.takeRequest(id)).toBeNull()

  r.nav('t1', GMAIL)
  await r.c.start('t1')
  const id2 = r.c.pending.list()[0].id
  r.sessions.delete('s1')
  expect(r.c.takeRequest(id2)).toBeNull()
})

test('complete, OAuth popup: navigates the opener, assigns and focuses its pane, closes the popup', async () => {
  const r = setup()
  r.c.init(r.win)
  r.tab('opener', 's2', `${SITE}/site`)
  r.nav('opener', `${SITE}/site`)
  r.tab('popup', 's2', 'about:blank', 'pane-2')
  r.nav('popup', `${LOCAL}/v3/signin/identifier?client_id=test`, [`${LOCAL}/o/oauth2/v2/auth?client_id=test`], 'opener')
  expect(r.c.getState('popup')).toMatchObject({ status: 'offer', kind: 'oauth', targetHost: '127.0.0.1:41234' })
  await r.c.start('popup')
  expect(r.opened.at(-1)).toBe(`${SITE}/site`)
  const req = r.c.takeRequest(r.c.pending.list()[0].id)!
  expect(req).toMatchObject({ returnTabId: 'opener', cookieDomains: ['127.0.0.1'] })
  r.windows.calls = []
  expect(await r.c.complete(req)).toEqual({ tabId: 'opener', paneId: 'pane-2' })
  expect(r.windows.calls).toEqual([
    `navigate opener ${SITE}/site`,
    'assign pane-2 opener',
    'focus pane-2',
    'close popup',
    'front'
  ])
})

test('complete: a tab that moved elsewhere is left alone; a new tab opens in the pane', async () => {
  const r = setup()
  r.tab('t1', 's1', GMAIL, 'pane-1')
  r.nav('t1', GMAIL)
  await r.c.start('t1')
  const req = r.c.takeRequest(r.c.pending.list()[0].id)!
  r.nav('t1', 'https://news.example/')
  r.windows.calls = []
  const res = await r.c.complete(req)
  expect(res.tabId).not.toBe('t1')
  expect(res.paneId).toBe('pane-1')
  expect(r.windows.calls[0]).toBe(`create ${res.tabId}`)
  expect(r.windows.tabs.get(res.tabId)?.url).toBe('https://mail.google.com/mail/u/0/')
  expect(r.windows.tabs.get('t1')?.url).toBe('https://news.example/')
})

test('onSessionRemoved cancels that session\'s requests at once; other sessions keep theirs', async () => {
  const r = setup()
  r.c.init(r.win)
  r.tab('t1', 's1', GMAIL, 'pane-1')
  r.nav('t1', GMAIL)
  r.tab('t2', 's2', GMAIL, 'pane-2')
  r.nav('t2', GMAIL)
  await r.c.start('t1')
  await r.c.start('t2')
  const id1 = r.c.pending.forTab('t1')!.id
  const id2 = r.c.pending.forTab('t2')!.id

  r.c.onSessionRemoved('s1')
  expect(r.c.pending.list().map((p) => p.id)).toEqual([id2])
  expect(r.c.listForExtension().map((p) => p.id)).toEqual([id2])
  expect(r.c.takeRequest(id1)).toBeNull()
  expect(r.c.getState('t1')).toMatchObject({ status: 'offer' })
  expect(r.sent.at(-1)?.payload).toMatchObject({ tabId: 't1', state: { status: 'offer' } })
  expect(r.c.getState('t2')).toMatchObject({ status: 'waiting' })
})

test('failed() marks the banner; onClosed forgets the tab and sends null', async () => {
  const r = setup()
  r.c.init(r.win)
  r.tab('t1', 's1', GMAIL, 'pane-1')
  r.nav('t1', GMAIL)
  await r.c.start('t1')
  const req = r.c.takeRequest(r.c.pending.list()[0].id)!
  r.c.failed(req)
  expect(r.c.getState('t1')).toMatchObject({ status: 'offer', notice: 'failed' })
  r.c.onClosed('t1')
  expect(r.sent.at(-1)?.payload).toEqual({ tabId: 't1', state: null })
  expect(r.c.getState('t1')).toBeNull()
})
