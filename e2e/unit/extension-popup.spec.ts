// access.js, handoff.js and popup.js run together in one vm context, as in popup.html, with a fake document,
// chrome.* and fetch. Catches a redeclared top-level name (SyntaxError) and checks consent, site access and
// the hand-off flow. Every fake chrome call and fetch is logged in order in `api`.
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

const extDir = join(__dirname, '..', '..', 'chrome-extension')
const ACCESS_SRC = readFileSync(join(extDir, 'access.js'), 'utf8')
const HANDOFF_SRC = readFileSync(join(extDir, 'handoff.js'), 'utf8')
const POPUP_SRC = readFileSync(join(extDir, 'popup.js'), 'utf8')
const POPUP_HTML = readFileSync(join(extDir, 'popup.html'), 'utf8')

class El {
  children: El[] = []
  textContent = ''
  className = ''
  disabled = false
  style = { display: '', props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v } }
  private listeners: Record<string, Array<() => void>> = {}
  constructor(readonly tag: string, readonly id = '') {}
  set innerHTML(v: string) {
    this.textContent = v.replace(/<[^>]*>/g, '')
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn)
  }
  appendChild(c: El) {
    this.children.push(c)
    return c
  }
  replaceChildren(...c: El[]) {
    this.children = c
  }
  click() {
    for (const fn of this.listeners.click ?? []) fn()
  }
  /** textContent including children (like the DOM's) */
  get text(): string {
    return this.textContent + this.children.map((c) => c.text).join('')
  }
}

interface FetchCall {
  url: string
  method: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the parsed POST body; specs assert on it field by field
  body: any
}
type Reply = { status: number; body: unknown } | 'network-error'

const REQUEST = {
  id: '8f0c2a4e-1b3d-4c5e-9f60-000000000001',
  sessionName: 'Gmail',
  sessionColor: '#ef4444',
  cookieDomains: ['google.com', 'youtube.com'],
  expiresAt: Date.now() + 600_000
}
const JAR: Record<string, unknown[]> = {
  'google.com': [
    { name: 'SID', value: 'g', domain: '.google.com', hostOnly: false, path: '/', session: false, expirationDate: 2e9, httpOnly: true, secure: true, sameSite: 'no_restriction' }
  ],
  'youtube.com': [
    { name: 'LOGIN_INFO', value: 'y', domain: '.youtube.com', hostOnly: false, path: '/', session: true, httpOnly: true, secure: true, sameSite: 'lax' }
  ]
}
function cookie(name: string, domain: string, hostOnly: boolean) {
  return { name, value: name + '-v', domain, hostOnly, path: '/', session: true, httpOnly: true, secure: true, sameSite: 'lax' }
}
/** The cookie fields the fake chrome.cookies.getAll filters on */
type JarCookie = { domain: string; hostOnly: boolean }
const cookieHost = (c: JarCookie) => String(c.domain).replace(/^\./, '')
/** h is d or a subdomain of d */
const underDomain = (h: string, d: string) => h === d || h.endsWith('.' + d)
/** Whether a granted origin pattern (*://*.d/* or *://d/*) covers host h */
function patternCovers(pattern: string, h: string): boolean {
  const m = /^\*:\/\/(\*\.)?([^/]+)\/\*$/.exec(pattern)
  if (!m) return false
  return m[1] ? underDomain(h, m[2]) : h === m[2]
}
const GMAIL_TAB = { id: 1, url: 'https://mail.google.com/mail/u/0/', title: 'Inbox - me@example.com' }
const GOOGLE = ['*://*.google.com/*']
const GOOGLE_YOUTUBE = ['*://*.google.com/*', '*://*.youtube.com/*']
const DENIED = '❌ Chrome did not allow access to google.com, so nothing was sent.'
const SENT = '✅ Sent to SessionForge — opened in a pane'

interface BootOpts {
  pending?: Reply | Reply[]
  importReply?: Reply
  /** Pre-fill chrome.storage.local with {consentVersion: 1} (default true; ignored when `local` is given) */
  consent?: boolean
  /** Origins Chrome already granted (default 'all') */
  granted?: 'all' | string[]
  /** What chrome.permissions.request does: resolve true/false, never settle, or reject */
  request?: true | false | 'never' | 'throw'
  tab?: { id: number; url?: string; title?: string }
  /** Shared stores, so a second boot simulates reopening the popup */
  local?: Map<string, unknown>
  session?: Map<string, unknown>
  /** chrome.storage.local.set rejects with this message */
  localSetError?: string
  /** Every cookie in the profile (default: the JAR cookies) */
  jar?: JarCookie[]
}

function boot(opts: BootOpts = {}) {
  const ids = [
    'status', 'btn-text', 'import-btn', 'current-url', 'site-access', 'session-info', 'pending', 'main',
    'consent', 'agree-btn', 'not-now-btn', 'consent-status', 'grant-btn'
  ]
  const els = new Map(ids.map((id) => [id, new El('div', id)]))
  const calls: FetchCall[] = []
  const api: string[] = []
  const requests: string[][] = []
  const contains: string[][] = []
  const created: string[] = []
  const local = opts.local ?? new Map<string, unknown>(opts.consent === false ? [] : [['consentVersion', 1]])
  const session = opts.session ?? new Map<string, unknown>()
  const granted = opts.granted === undefined || opts.granted === 'all' ? null : new Set(opts.granted)
  const requestMode = opts.request ?? true
  const tab = opts.tab ?? GMAIL_TAB
  const pending = opts.pending ?? 'network-error'
  const pendingReplies = Array.isArray(pending) ? [...pending] : null
  const reply = (r: Reply) => {
    if (r === 'network-error') return Promise.reject(new TypeError('Failed to fetch'))
    return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body })
  }
  const jar = opts.jar ?? (Object.values(JAR).flat() as JarCookie[])
  // Like Chrome: only cookies whose own domain a granted host permission covers are returned
  const visible = (c: JarCookie) => granted === null || [...granted].some((p) => patternCovers(p, cookieHost(c)))
  const area = (name: string, store: Map<string, unknown>) => ({
    get: async (key: string | string[]) => {
      api.push(`storage.${name}.get`)
      const out: Record<string, unknown> = {}
      for (const k of Array.isArray(key) ? key : [key]) if (store.has(k)) out[k] = store.get(k)
      return out
    },
    set: async (items: Record<string, unknown>) => {
      api.push(`storage.${name}.set`)
      if (name === 'local' && opts.localSetError) throw new Error(opts.localSetError)
      for (const [k, v] of Object.entries(items)) store.set(k, JSON.parse(JSON.stringify(v)))
    },
    remove: async (key: string | string[]) => {
      api.push(`storage.${name}.remove`)
      for (const k of Array.isArray(key) ? key : [key]) store.delete(k)
    }
  })
  const sandbox: Record<string, unknown> = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    AbortController,
    AbortSignal,
    URL,
    alert() {},
    document: {
      getElementById: (id: string) => els.get(id) ?? null,
      createElement: (tag: string) => new El(tag)
    },
    chrome: {
      tabs: {
        query: async () => {
          api.push('tabs.query')
          return [tab]
        },
        create: async (p: { url: string }) => {
          api.push('tabs.create')
          created.push(p.url)
        }
      },
      cookies: {
        getAll: async (q: { domain?: string; url?: string }) => {
          api.push('cookies.getAll')
          let list = jar
          // {domain}: cookies of that domain and its subdomains
          if (q.domain) list = list.filter((c) => underDomain(cookieHost(c), q.domain!))
          // {url}: cookies the page is sent (host-only on that host, else on the host or a parent domain)
          if (q.url) {
            const h = new URL(q.url).hostname
            list = list.filter((c) => (c.hostOnly ? cookieHost(c) === h : underDomain(h, cookieHost(c))))
          }
          return list.filter(visible)
        }
      },
      scripting: {
        executeScript: async () => {
          api.push('scripting.executeScript')
          return [{ result: { k: 'v' } }]
        }
      },
      permissions: {
        contains: async (p: { origins: string[] }) => {
          api.push('permissions.contains')
          contains.push([...p.origins])
          return granted === null || p.origins.every((o) => granted.has(o))
        },
        request: (p: { origins: string[] }) => {
          api.push('permissions.request')
          requests.push([...p.origins])
          if (requestMode === 'throw') return Promise.reject(new Error('This function must be called during a user gesture'))
          if (requestMode === 'never') return new Promise(() => {})
          if (requestMode && granted) for (const o of p.origins) granted.add(o)
          return Promise.resolve(requestMode)
        }
      },
      storage: { local: area('local', local), session: area('session', session) },
      runtime: { getURL: (p: string) => 'chrome-extension://test-id/' + p }
    },
    fetch: (url: string, init: { method?: string; body?: string } = {}) => {
      const method = init.method ?? 'GET'
      api.push(`fetch ${method} ${new URL(url).pathname}`)
      calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined })
      if (url.endsWith('/pending')) {
        return reply(pendingReplies ? (pendingReplies.shift() ?? 'network-error') : (pending as Reply))
      }
      return reply(opts.importReply ?? { status: 200, body: { success: true, cookies: { imported: 1, failed: 0, skipped: 0 } } })
    }
  }
  sandbox.self = sandbox
  vm.createContext(sandbox)
  vm.runInContext(ACCESS_SRC, sandbox, { filename: 'access.js' })
  vm.runInContext(HANDOFF_SRC, sandbox, { filename: 'handoff.js' })
  vm.runInContext(POPUP_SRC, sandbox, { filename: 'popup.js' })
  const el = (id: string) => els.get(id)!
  const posts = () => calls.filter((c) => c.method === 'POST')
  return { el, calls, api, requests, contains, created, local, session, posts, sandbox, handOff: sandbox.SessionForgeHandOff as { buildHandOffPayload(requestId: string, cookies: unknown[]): unknown } }
}

async function until(fn: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('timed out waiting for ' + what)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** initMain is done once it has asked /pending (its last step) */
const ready = (p: ReturnType<typeof boot>) => until(() => p.calls.some((c) => c.url.endsWith('/pending')), '/pending fetch')
const READS = ['cookies.getAll', 'scripting.executeScript', 'fetch POST /import']

test('loads without throwing; handoff.js adds only SessionForgeHandOff', () => {
  const sandbox: Record<string, unknown> = {}
  sandbox.self = sandbox
  vm.createContext(sandbox)
  vm.runInContext(HANDOFF_SRC, sandbox)
  expect(Object.keys(sandbox).filter((k) => k !== 'self')).toEqual(['SessionForgeHandOff'])
  expect(() => boot({ pending: 'network-error' })).not.toThrow()
})

test('no /pending (SessionForge not running or older): the popup is as before', async () => {
  const p = boot({ pending: 'network-error' })
  await until(() => p.calls.some((c) => c.url.endsWith('/pending')), '/pending fetch')
  await new Promise((r) => setTimeout(r, 20))
  expect(p.el('pending').children).toEqual([])
  // Nothing relabelled the button, so popup.html's "Send to SessionForge" stays
  expect(p.el('btn-text').textContent).toBe('')
  const q = boot({ pending: { status: 404, body: { success: false } } })
  await new Promise((r) => setTimeout(r, 20))
  expect(q.el('pending').children).toEqual([])
})

test('one request: "Send to Gmail (SessionForge asked for this)" in its colour next to "Send to new session"', async () => {
  const p = boot({ pending: { status: 200, body: { requests: [REQUEST] } } })
  await until(() => p.el('pending').children.length === 1, 'request button')
  const btn = p.el('pending').children[0]
  const [label, scope] = btn.children[1].children
  expect(label.text).toBe('Send to Gmail (SessionForge asked for this)')
  // The cookie domains are visible before the click
  expect(scope.text).toBe('Sends cookies for google.com, youtube.com only')
  expect(btn.className).toBe('pending-btn')
  expect(btn.style.props['--c']).toBe('#ef4444')
  expect(p.el('btn-text').textContent).toBe('Send to new session')

  const empty = boot({ pending: { status: 200, body: { requests: [] } } })
  await until(() => empty.calls.length > 0, 'fetch')
  await new Promise((r) => setTimeout(r, 20))
  expect(empty.el('btn-text').textContent).toBe('Send to SessionForge')
})

test('click POSTs buildHandOffPayload with the cookies of every request domain; 200 text', async () => {
  const p = boot({ pending: { status: 200, body: { requests: [REQUEST] } } })
  await until(() => p.el('pending').children.length === 1, 'request button')
  p.el('pending').children[0].click()
  await until(() => p.el('status').className === 'status success', 'success')
  const post = p.calls.find((c) => c.method === 'POST')!
  expect(post.url).toBe('http://127.0.0.1:34567/import')
  const expected = JSON.parse(
    JSON.stringify(p.handOff.buildHandOffPayload(REQUEST.id, [...JAR['google.com'], ...JAR['youtube.com']]))
  )
  expect(post.body).toEqual(expected)
  expect(post.body.storageState.origins).toEqual([])
  expect(post.body.metadata).toBeUndefined()
  expect(p.el('status').textContent).toBe('✅ Sent to Gmail. Check the SessionForge pane.')
  expect(p.el('pending').children[0].disabled).toBe(false)
  expect(p.el('import-btn').disabled).toBe(false)
})

test('410: explains, and fetches /pending again', async () => {
  const p = boot({
    pending: [
      { status: 200, body: { requests: [REQUEST] } },
      { status: 200, body: { requests: [] } }
    ],
    importReply: { status: 410, body: { success: false, code: 'request_invalid', error: 'expired' } }
  })
  await until(() => p.el('pending').children.length === 1, 'request button')
  p.el('pending').children[0].click()
  await until(() => p.calls.filter((c) => c.url.endsWith('/pending')).length === 2, 'second /pending')
  await until(() => p.el('pending').children.length === 0, 'list refreshed')
  expect(p.el('status').textContent).toBe(
    '❌ This request expired or was already used. Click “Sign in with Chrome” in SessionForge again.'
  )
  expect(p.el('btn-text').textContent).toBe('Send to SessionForge')
})

test('the "Send to new session" label survives a regular send', async () => {
  const p = boot({ pending: { status: 200, body: { requests: [REQUEST] } } })
  await until(() => p.el('btn-text').textContent === 'Send to new session', 'relabel')
  p.el('import-btn').click()
  await until(() => p.el('status').className === 'status success', 'regular send')
  const post = p.calls.find((c) => c.method === 'POST')!
  expect(post.body.requestId).toBeUndefined()
  expect(post.body.metadata.url).toBe('https://mail.google.com/mail/u/0/')
  expect(p.el('btn-text').textContent).toBe('Send to new session')
})

// ---------------------------------------------------------------- consent

test('no consent: only the consent screen; nothing but storage.local.get runs, and every data path refuses', async () => {
  const p = boot({ consent: false, pending: { status: 200, body: { requests: [REQUEST] } } })
  await until(() => p.el('consent').style.display === 'block', 'consent screen')
  await sleep(30)
  expect(p.el('main').style.display).toBe('none')
  expect(p.api).toEqual(['storage.local.get'])
  expect(p.calls).toEqual([])
  // The (hidden) buttons do nothing either
  p.el('import-btn').click()
  p.el('grant-btn').click()
  await sleep(20)
  expect(p.api).toEqual(['storage.local.get'])
  // The guarded readers and the POST refuse before touching chrome.* or fetch
  const fns = p.sandbox as Record<string, (...a: unknown[]) => Promise<unknown>>
  await expect(fns.getCookies({ domain: 'google.com' })).rejects.toThrow('Consent required')
  await expect(fns.collectCookies(GMAIL_TAB)).rejects.toThrow('Consent required')
  await expect(fns.getLocalStorage(1)).rejects.toThrow('Consent required')
  await expect(fns.postToSessionForge({ action: 'import' })).rejects.toThrow('Consent required')
  await expect(fns.loadPending()).rejects.toThrow('Consent required')
  expect(p.api).toEqual(['storage.local.get'])
  expect(p.calls).toEqual([])
})

test('an older or newer consentVersion shows the consent screen again', async () => {
  for (const v of [0, 2]) {
    const p = boot({ local: new Map([['consentVersion', v]]) })
    await until(() => p.el('consent').style.display === 'block', 'consent screen')
    expect(p.el('main').style.display).toBe('none')
  }
})

test('Not now: says nothing was read or sent, stores nothing, stays on the consent screen', async () => {
  const p = boot({ consent: false })
  await until(() => p.el('consent').style.display === 'block', 'consent screen')
  p.el('not-now-btn').click()
  expect(p.el('consent-status').textContent).toBe(
    'Nothing was read or sent. Open SessionForge Import again when you want to use it.'
  )
  await sleep(20)
  expect([...p.local.keys()]).toEqual([])
  expect(p.el('main').style.display).toBe('none')
  expect(p.api).toEqual(['storage.local.get'])
})

test('Agree: stores consentVersion 1 and consentAt, shows the main UI, then asks /pending; reopening skips the notice', async () => {
  const p = boot({ consent: false, pending: { status: 200, body: { requests: [REQUEST] } } })
  await until(() => p.el('consent').style.display === 'block', 'consent screen')
  p.el('agree-btn').click()
  await until(() => p.el('main').style.display === 'block', 'main UI')
  expect(p.local.get('consentVersion')).toBe(1)
  expect(typeof p.local.get('consentAt')).toBe('number')
  expect(p.el('consent').style.display).toBe('none')
  // The consent was stored before anything else ran
  expect(p.api.slice(0, 2)).toEqual(['storage.local.get', 'storage.local.set'])
  await until(() => p.el('pending').children.length === 1, 'request button')
  expect(p.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET http://127.0.0.1:34567/pending'])

  const again = boot({ local: p.local })
  await until(() => again.el('main').style.display === 'block', 'main UI on reopen')
  expect(again.el('consent').style.display).toBe('none')
})

test('Agree when saving fails: the error shows, the consent screen stays, nothing is read or sent', async () => {
  const p = boot({ consent: false, localSetError: 'QUOTA_BYTES quota exceeded', pending: { status: 200, body: { requests: [REQUEST] } } })
  await until(() => p.el('consent').style.display === 'block', 'consent screen')
  p.el('agree-btn').click()
  await until(() => p.el('consent-status').textContent !== '', 'error message')
  expect(p.el('consent-status').textContent).toBe('❌ Could not save your choice: QUOTA_BYTES quota exceeded')
  expect(p.el('consent').style.display).toBe('block')
  expect(p.el('main').style.display).toBe('none')
  expect(p.el('agree-btn').disabled).toBe(false)
  expect([...p.local.keys()]).toEqual([])
  // The hidden buttons still do nothing: no tabs, cookies, scripting or fetch
  p.el('import-btn').click()
  p.el('grant-btn').click()
  await sleep(20)
  expect(p.api).toEqual(['storage.local.get', 'storage.local.set'])
  expect(p.calls).toEqual([])
})

test('opening with consent reads no cookies, runs no script and POSTs nothing before a click', async () => {
  const p = boot({ pending: { status: 200, body: { requests: [REQUEST] } } })
  await until(() => p.el('pending').children.length === 1, 'request button')
  await sleep(20)
  expect(p.api.filter((a) => READS.includes(a) || a === 'permissions.request')).toEqual([])
  expect(p.el('current-url').textContent).toBe('mail.google.com')
  expect(p.el('site-access').textContent).toBe('Allowed')
  expect(p.el('session-info').style.display).toBe('block')
})

// ---------------------------------------------------------------- site access

test('access already granted: contains is asked with the exact patterns, and a click sends without a request', async () => {
  const p = boot({ granted: GOOGLE_YOUTUBE, pending: { status: 200, body: { requests: [REQUEST] } } })
  await until(() => p.el('pending').children.length === 1, 'request button')
  expect(p.contains).toEqual([GOOGLE, GOOGLE_YOUTUBE])
  p.el('import-btn').click()
  await until(() => p.el('status').className === 'status success', 'regular send')
  p.el('pending').children[0].click()
  await until(() => p.posts().length === 2 && p.el('status').className === 'status success', 'hand-off send')
  expect(p.requests).toEqual([])
  expect(p.api).not.toContain('permissions.request')
  expect(p.posts()[1].body.requestId).toBe(REQUEST.id)
})

test('not granted, regular send: permissions.request is the first call of the click, for the site only', async () => {
  const p = boot({ granted: [] })
  await ready(p)
  expect(p.el('site-access').textContent).toBe('Chrome asks the first time you send')
  const before = p.api.length
  p.el('import-btn').click()
  // Synchronously, inside the click dispatch: nothing was awaited before the request
  expect(p.requests).toEqual([GOOGLE])
  expect(p.api[before]).toBe('permissions.request')
  await until(() => p.el('status').className === 'status success', 'send after grant')
  expect(p.el('status').textContent).toBe(SENT)
  const after = p.api.slice(before)
  expect(after.indexOf('cookies.getAll')).toBeGreaterThan(after.indexOf('permissions.request'))
  expect(after).toContain('fetch POST /import')
  expect(p.el('site-access').textContent).toBe('Allowed')
  // Granted now: the next click sends without asking again
  p.el('import-btn').click()
  await until(() => p.posts().length === 2, 'second POST')
  expect(p.requests).toEqual([GOOGLE])
})

test('not granted, hand-off: the request button asks synchronously for the cookieDomains, then POSTs with requestId', async () => {
  const p = boot({ granted: [], pending: { status: 200, body: { requests: [REQUEST] } } })
  await until(() => p.el('pending').children.length === 1, 'request button')
  const before = p.api.length
  p.el('pending').children[0].click()
  expect(p.requests).toEqual([GOOGLE_YOUTUBE])
  expect(p.api[before]).toBe('permissions.request')
  await until(() => p.el('status').className === 'status success', 'hand-off send')
  expect(p.posts()).toHaveLength(1)
  expect(p.posts()[0].body.requestId).toBe(REQUEST.id)
})

test('parent-domain cookies: access is asked for the parent site, so its login cookies are sent', async () => {
  const cases = [
    { url: 'https://console.x.ai/home', host: 'console.x.ai', site: 'x.ai' },
    { url: 'https://www.gmx.de/', host: 'www.gmx.de', site: 'gmx.de' },
    { url: 'https://www.bbc.co.uk/news', host: 'www.bbc.co.uk', site: 'bbc.co.uk' }
  ]
  for (const c of cases) {
    const jar = [cookie('login', '.' + c.site, false), cookie('pref', c.host, true), cookie('other', '.example.org', false)]
    const p = boot({ granted: [], tab: { id: 4, url: c.url, title: 'Home' }, jar })
    await ready(p)
    expect(p.el('current-url').textContent).toBe(c.host)
    expect(p.contains).toEqual([[`*://*.${c.site}/*`]])
    p.el('import-btn').click()
    expect(p.requests, c.host).toEqual([[`*://*.${c.site}/*`]])
    await until(() => p.el('status').className === 'status success', 'send after grant')
    const sent = p.posts()[0].body.storageState.cookies.map((x: { name: string; domain: string }) => `${x.name}@${x.domain}`).sort()
    expect(sent, c.host).toEqual([`login@.${c.site}`, `pref@${c.host}`])
  }
})

test('the cookie fake hides cookies of hosts that were not granted, like Chrome', async () => {
  // Only the subdomain granted: the parent-domain cookie is not returned
  const jar = [cookie('login', '.x.ai', false), cookie('pref', 'console.x.ai', true)]
  const p = boot({ granted: ['*://*.console.x.ai/*'], tab: { id: 4, url: 'https://console.x.ai/' }, jar })
  await ready(p)
  const fns = p.sandbox as Record<string, (...a: unknown[]) => Promise<Array<{ name: string }>>>
  expect((await fns.getCookies({ url: 'https://console.x.ai/' })).map((c) => c.name)).toEqual(['pref'])
  expect((await fns.getCookies({ domain: 'x.ai' })).map((c) => c.name)).toEqual(['pref'])
})

test('denied: clear message, "Allow access in a tab" shown, no cookie read, no script, no POST', async () => {
  const p = boot({ granted: [], request: false })
  await ready(p)
  const before = p.api.length
  p.el('import-btn').click()
  await until(() => p.el('status').className === 'status error', 'denied message')
  expect(p.el('status').textContent).toBe(DENIED)
  expect(p.el('grant-btn').style.display).toBe('block')
  expect(p.api.slice(before).filter((a) => READS.includes(a))).toEqual([])
  expect(p.posts()).toEqual([])
  expect(p.session.has('grantAttempt')).toBe(false)

  const h = boot({ granted: [], request: false, pending: { status: 200, body: { requests: [REQUEST] } } })
  await until(() => h.el('pending').children.length === 1, 'request button')
  const hBefore = h.api.length
  h.el('pending').children[0].click()
  await until(() => h.el('status').className === 'status error', 'denied message')
  expect(h.el('status').textContent).toBe('❌ Chrome did not allow access to google.com, youtube.com, so nothing was sent.')
  expect(h.api.slice(hBefore).filter((a) => READS.includes(a))).toEqual([])
  expect(h.posts()).toEqual([])
})

test('request rejects: message points to the tab page, nothing sent', async () => {
  const p = boot({ granted: [], request: 'throw' })
  await ready(p)
  p.el('import-btn').click()
  await until(() => p.el('status').className === 'status error', 'error message')
  expect(p.el('status').textContent).toBe('❌ Chrome could not ask for access here. Click “Allow access in a tab”.')
  expect(p.el('grant-btn').style.display).toBe('block')
  expect(p.api.filter((a) => READS.includes(a))).toEqual([])
  expect(p.session.has('grantAttempt')).toBe(false)
})

test('popup closed during the prompt: the next open explains and offers grant.html; once granted it says so', async () => {
  const local = new Map<string, unknown>([['consentVersion', 1]])
  const session = new Map<string, unknown>()
  const p = boot({ granted: [], request: 'never', local, session })
  await ready(p)
  p.el('import-btn').click()
  await until(() => session.has('grantAttempt'), 'grantAttempt marker')
  expect(session.get('grantAttempt')).toMatchObject({ domains: ['google.com'] })
  expect(typeof (session.get('grantAttempt') as { at: unknown }).at).toBe('number')
  await sleep(20)
  expect(p.api.filter((a) => READS.includes(a))).toEqual([])

  // Reopened, still not granted
  const q = boot({ granted: [], local, session })
  await until(() => q.el('grant-btn').style.display === 'block', 'grant button')
  expect(q.el('status').textContent).toBe(
    'Chrome closed this popup while asking for access to google.com. Click “Allow access in a tab”, then send again.'
  )
  expect(session.has('grantAttempt')).toBe(false)
  q.el('grant-btn').click()
  expect(q.created).toEqual(['chrome-extension://test-id/grant.html?domains=google.com&tab=1'])
  expect(q.api.filter((a) => READS.includes(a))).toEqual([])

  // Reopened after Chrome granted access
  session.set('grantAttempt', { domains: ['google.com'], at: Date.now() })
  const r = boot({ granted: GOOGLE, local, session })
  await until(() => r.el('status').className === 'status success', 'granted message')
  expect(r.el('status').textContent).toBe('✅ Access to google.com allowed. Click the Send button again.')
  expect(session.has('grantAttempt')).toBe(false)
  expect(r.el('grant-btn').style.display).not.toBe('block')

  // A marker older than 10 minutes is dropped without a message
  session.set('grantAttempt', { domains: ['google.com'], at: Date.now() - 11 * 60_000 })
  const old = boot({ granted: [], local, session })
  await ready(old)
  expect(old.el('status').textContent).toBe('')
  expect(old.el('grant-btn').style.display).not.toBe('block')
  expect(session.has('grantAttempt')).toBe(false)
})

test('a chrome:// tab (or no URL): http(s)-only message, no request, nothing read', async () => {
  for (const tab of [{ id: 2, url: 'chrome://extensions/', title: 'Extensions' }, { id: 3 }]) {
    const p = boot({ granted: [], tab })
    await ready(p)
    expect(p.el('current-url').textContent).toBe('—')
    expect(p.el('site-access').textContent).toBe('Not available on this page')
    expect(p.contains).toEqual([])
    p.el('import-btn').click()
    expect(p.el('status').textContent).toBe('❌ Only http(s) pages can be sent (not chrome:// pages, the Web Store or files).')
    await sleep(20)
    expect(p.requests).toEqual([])
    expect(p.api.filter((a) => READS.includes(a))).toEqual([])
  }
})

test('the "Import All Chrome Profiles" placeholder is gone', () => {
  expect(POPUP_HTML).not.toContain('import-all-btn')
  expect(POPUP_HTML).not.toContain('Import All')
  expect(POPUP_SRC).not.toContain('importAllProfiles')
  expect(POPUP_SRC).not.toContain('import-all-btn')
  expect(POPUP_SRC).not.toContain('Coming in next update')
  expect(POPUP_SRC).not.toContain('alert(')
})

test('popup.html has every element popup.js uses, and loads access.js, handoff.js, popup.js in that order', () => {
  const used = [...POPUP_SRC.matchAll(/(?:getElementById|show)\('([^']+)'/g)].map((m) => m[1])
  expect(used).toEqual(expect.arrayContaining(['consent', 'main', 'agree-btn', 'not-now-btn', 'grant-btn', 'site-access']))
  for (const id of new Set(used)) expect(POPUP_HTML, id).toContain(`id="${id}"`)
  const scripts = [...POPUP_HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])
  expect(scripts).toEqual(['access.js', 'handoff.js', 'popup.js'])
  // No pre-checked boxes: the notice has buttons only
  expect(POPUP_HTML).not.toMatch(/type="checkbox"|checked/)
})
