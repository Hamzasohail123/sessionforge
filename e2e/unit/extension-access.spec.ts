// access.js (consent and site-access helpers) under Node, and grant.html's grant.js in a vm context with a
// fake document, location and chrome.*. The sandbox has no fetch and no chrome.cookies/scripting, so a call
// to any of them would throw and be reported.
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import vm from 'node:vm'

const extDir = join(__dirname, '..', '..', 'chrome-extension')
const require_ = createRequire(__filename)
const Access = require_(join(extDir, 'access.js')) as {
  CONSENT_VERSION: number
  hasConsent(area: unknown): Promise<boolean>
  recordConsent(area: unknown, now: number): Promise<void>
  baseDomain(hostname: string): string
  siteDomain(url: unknown): string | null
  isValidDomain(d: unknown): boolean
  originsForDomains(domains: string[]): string[]
  grantQuery(domains: string[], tabId?: unknown): string
  parseGrantParams(search: unknown): { domains: string[]; tabId: number | null } | null
}
const ACCESS_SRC = readFileSync(join(extDir, 'access.js'), 'utf8')
const GRANT_SRC = readFileSync(join(extDir, 'grant.js'), 'utf8')
const GRANT_HTML = readFileSync(join(extDir, 'grant.html'), 'utf8')

function fakeArea(init: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(init))
  return {
    store,
    get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) store.set(k, v)
    }
  }
}

test('originsForDomains: subdomain wildcard for domains, exact host for localhost, IPs and single labels', () => {
  expect(Access.originsForDomains(['google.com'])).toEqual(['*://*.google.com/*'])
  expect(Access.originsForDomains(['bbc.co.uk'])).toEqual(['*://*.bbc.co.uk/*'])
  expect(Access.originsForDomains(['localhost'])).toEqual(['*://localhost/*'])
  expect(Access.originsForDomains(['127.0.0.1'])).toEqual(['*://127.0.0.1/*'])
  expect(Access.originsForDomains(['[::1]'])).toEqual(['*://[::1]/*'])
  expect(Access.originsForDomains(['intranet'])).toEqual(['*://intranet/*'])
  expect(Access.originsForDomains(['google.com', 'youtube.com', 'google.com'])).toEqual([
    '*://*.google.com/*',
    '*://*.youtube.com/*'
  ])
})

test('siteDomain: the base domain of http(s) URLs, null for anything else', () => {
  expect(Access.siteDomain('https://mail.google.com/x')).toBe('google.com')
  expect(Access.siteDomain('http://localhost:3000/')).toBe('localhost')
  expect(Access.siteDomain('http://[::1]:3000/')).toBe('[::1]')
  expect(Access.siteDomain('chrome://extensions/')).toBeNull()
  expect(Access.siteDomain('file:///a')).toBeNull()
  expect(Access.siteDomain('not a url')).toBeNull()
  expect(Access.siteDomain(undefined)).toBeNull()
  expect(Access.siteDomain(42)).toBeNull()
})

test('baseDomain keeps three labels for co.uk-style suffixes', () => {
  expect(Access.baseDomain('bbc.co.uk')).toBe('bbc.co.uk')
  expect(Access.baseDomain('www.bbc.co.uk')).toBe('bbc.co.uk')
  expect(Access.baseDomain('x.google.com.au')).toBe('google.com.au')
  expect(Access.baseDomain('www.amazon.co.jp')).toBe('amazon.co.jp')
  expect(Access.baseDomain('www.example.ne.jp')).toBe('example.ne.jp')
  expect(Access.baseDomain('mail.google.com')).toBe('google.com')
  expect(Access.baseDomain('127.0.0.1')).toBe('127.0.0.1')
})

test('baseDomain: a short site name under a two-letter TLD is the site, so its parent-domain cookies are covered', () => {
  const cases: Array<[string, string]> = [
    ['console.x.ai', 'x.ai'],
    ['www.gmx.de', 'gmx.de'],
    ['www.web.de', 'web.de'],
    ['www.fly.io', 'fly.io'],
    ['app.dub.co', 'dub.co'],
    ['x.ai', 'x.ai'],
    // Country codes without second-level registrations: "ad"/"ed"/"co" here are site names
    ['www.ad.nl', 'ad.nl'],
    ['www.ed.nl', 'ed.nl'],
    ['shop.co.de', 'co.de']
  ]
  for (const [host, site] of cases) expect(Access.baseDomain(host), host).toBe(site)
  expect(Access.siteDomain('https://console.x.ai/home')).toBe('x.ai')
  expect(Access.siteDomain('https://www.gmx.de/')).toBe('gmx.de')
  expect(Access.siteDomain('https://www.bbc.co.uk/news')).toBe('bbc.co.uk')
  expect(Access.originsForDomains([Access.siteDomain('https://console.x.ai/')!])).toEqual(['*://*.x.ai/*'])
})

test('grantQuery and parseGrantParams round-trip; bad links are refused', () => {
  const q = Access.grantQuery(['google.com', 'youtube.com'], 7)
  expect(q).toBe('domains=google.com%2Cyoutube.com&tab=7')
  expect(Access.parseGrantParams('?' + q)).toEqual({ domains: ['google.com', 'youtube.com'], tabId: 7 })
  expect(Access.grantQuery(['google.com'], undefined)).toBe('domains=google.com')
  expect(Access.parseGrantParams('?domains=google.com')).toEqual({ domains: ['google.com'], tabId: null })
  expect(Access.parseGrantParams('?' + Access.grantQuery(['[::1]', 'localhost'], 1))).toEqual({
    domains: ['[::1]', 'localhost'],
    tabId: 1
  })

  const bad = [
    '',
    '?tab=1',
    '?domains=',
    '?domains=a.com%2Cb.com%2Cc.com%2Cd.com%2Ce.com',
    '?domains=' + encodeURIComponent('evil.com/<x>'),
    '?domains=Google.com',
    '?domains=google.com%2C',
    '?domains=google.com&tab=abc',
    '?domains=google.com&tab=-1',
    '?domains=%E0%A4%A'
  ]
  for (const s of bad) expect(Access.parseGrantParams(s), s).toBeNull()
  expect(Access.parseGrantParams(undefined)).toBeNull()
})

test('hasConsent is true only after recordConsent stores the current version', async () => {
  expect(Access.CONSENT_VERSION).toBe(1)
  expect(await Access.hasConsent(fakeArea())).toBe(false)
  expect(await Access.hasConsent(fakeArea({ consentVersion: 0 }))).toBe(false)
  expect(await Access.hasConsent(fakeArea({ consentVersion: 2 }))).toBe(false)
  expect(await Access.hasConsent(fakeArea({ consentVersion: '1' }))).toBe(false)
  const area = fakeArea()
  await Access.recordConsent(area, 1234)
  expect(Object.fromEntries(area.store)).toEqual({ consentVersion: 1, consentAt: 1234 })
  expect(await Access.hasConsent(area)).toBe(true)
})

test('in the browser, access.js adds only SessionForgeAccess', () => {
  const sandbox: Record<string, unknown> = {}
  sandbox.self = sandbox
  vm.createContext(sandbox)
  vm.runInContext(ACCESS_SRC, sandbox)
  expect(Object.keys(sandbox).filter((k) => k !== 'self')).toEqual(['SessionForgeAccess'])
})

// ---------------------------------------------------------------- grant.html / grant.js

class El {
  textContent = ''
  className = ''
  style = { display: '' }
  private listeners: Array<() => void> = []
  addEventListener(_type: string, fn: () => void) {
    this.listeners.push(fn)
  }
  click() {
    for (const fn of this.listeners) fn()
  }
}

function bootGrant(opts: { search: string; consent?: boolean; granted?: boolean; request?: boolean | 'throw' }) {
  const els = new Map(['grant-text', 'status', 'allow-btn', 'back-btn'].map((id) => [id, new El()]))
  const api: string[] = []
  const requests: string[][] = []
  const errors: string[] = []
  const tabs: { updated: Array<[number, unknown]>; removed: number[] } = { updated: [], removed: [] }
  let granted = opts.granted ?? false
  const local = fakeArea(opts.consent === false ? {} : { consentVersion: 1 })
  const sandbox: Record<string, unknown> = {
    console: { log() {}, warn() {}, error: (...a: unknown[]) => errors.push(a.map(String).join(' ')) },
    URL,
    location: { search: opts.search },
    document: { getElementById: (id: string) => els.get(id) ?? null },
    chrome: {
      storage: { local },
      permissions: {
        contains: async () => {
          api.push('permissions.contains')
          return granted
        },
        request: (p: { origins: string[] }) => {
          api.push('permissions.request')
          requests.push([...p.origins])
          if (opts.request === 'throw') return Promise.reject(new Error('no gesture'))
          granted = opts.request ?? true
          return Promise.resolve(granted)
        }
      },
      tabs: {
        update: async (id: number, props: unknown) => {
          api.push('tabs.update')
          tabs.updated.push([id, props])
        },
        getCurrent: async () => {
          api.push('tabs.getCurrent')
          return { id: 99 }
        },
        remove: async (id: number) => {
          api.push('tabs.remove')
          tabs.removed.push(id)
        }
      }
    }
  }
  sandbox.self = sandbox
  vm.createContext(sandbox)
  vm.runInContext(ACCESS_SRC, sandbox, { filename: 'access.js' })
  vm.runInContext(GRANT_SRC, sandbox, { filename: 'grant.js' })
  return { el: (id: string) => els.get(id)!, api, requests, errors, tabs }
}

async function until(fn: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('timed out waiting for ' + what)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ONLY_GRANT_CALLS = ['permissions.contains', 'permissions.request', 'tabs.update', 'tabs.getCurrent', 'tabs.remove']

test('grant page: names the domains, asks synchronously on Allow, then offers Back to the tab', async () => {
  const g = bootGrant({ search: '?domains=google.com%2Cyoutube.com&tab=5' })
  await until(() => g.el('allow-btn').style.display === 'block', 'Allow button')
  expect(g.el('grant-text').textContent).toBe(
    'SessionForge Import needs your permission to read cookies of google.com, youtube.com (and their subdomains). ' +
      'Click Allow access; Chrome then asks you to confirm. Nothing is read or sent from this page.'
  )
  const before = g.api.length
  g.el('allow-btn').click()
  // Inside the click dispatch, before any await
  expect(g.requests).toEqual([['*://*.google.com/*', '*://*.youtube.com/*']])
  expect(g.api[before]).toBe('permissions.request')
  await until(() => g.el('back-btn').style.display === 'block', 'Back button')
  expect(g.el('status').className).toBe('status success')
  expect(g.el('status').textContent).toBe(
    '✅ Access allowed. Go back to your tab, click the SessionForge Import icon and click Send again.'
  )
  expect(g.el('allow-btn').style.display).toBe('none')
  g.el('back-btn').click()
  await until(() => g.tabs.removed.length === 1, 'tab closed')
  expect(g.tabs.updated).toEqual([[5, { active: true }]])
  expect(g.tabs.removed).toEqual([99])
  expect(g.api.every((a) => ONLY_GRANT_CALLS.includes(a))).toBe(true)
  expect(g.errors).toEqual([])
})

test('grant page: already granted shows the granted state without asking', async () => {
  const g = bootGrant({ search: '?domains=google.com&tab=5', granted: true })
  await until(() => g.el('back-btn').style.display === 'block', 'Back button')
  expect(g.requests).toEqual([])
  expect(g.el('allow-btn').style.display).not.toBe('block')
})

test('grant page: denied or rejected → message, nothing else', async () => {
  for (const request of [false, 'throw'] as const) {
    const g = bootGrant({ search: '?domains=google.com&tab=5', request })
    await until(() => g.el('allow-btn').style.display === 'block', 'Allow button')
    g.el('allow-btn').click()
    await until(() => g.el('status').className === 'status error', 'error message')
    expect(g.el('status').textContent).toBe('❌ Chrome did not allow access, so nothing will be sent.')
    expect(g.el('back-btn').style.display).not.toBe('block')
    expect(g.api.every((a) => ONLY_GRANT_CALLS.includes(a))).toBe(true)
  }
})

test('grant page: an invalid link or no consent → message, no Allow button, no request', async () => {
  for (const search of ['', '?domains=evil.com%2F%3Cx%3E', '?domains=google.com&tab=x']) {
    const g = bootGrant({ search })
    await until(() => g.el('status').style.display === 'block', 'message')
    expect(g.el('status').textContent).toBe('❌ This link is not valid. Open SessionForge Import from the toolbar and try again.')
    g.el('allow-btn').click()
    await sleep(10)
    expect(g.el('allow-btn').style.display).not.toBe('block')
    expect(g.api).toEqual([])
  }
  const n = bootGrant({ search: '?domains=google.com&tab=5', consent: false })
  await until(() => n.el('status').style.display === 'block', 'message')
  expect(n.el('status').textContent).toBe('Open SessionForge Import from the toolbar and click Agree first.')
  expect(n.el('grant-text').textContent).toBe('')
  n.el('allow-btn').click()
  await sleep(10)
  expect(n.el('allow-btn').style.display).not.toBe('block')
  expect(n.requests).toEqual([])
  expect(n.api).toEqual([])
  expect(n.errors).toEqual([])
})

test('grant.html loads access.js then grant.js, and has the elements grant.js uses', () => {
  const scripts = [...GRANT_HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])
  expect(scripts).toEqual(['access.js', 'grant.js'])
  const used = [...GRANT_SRC.matchAll(/(?:getElementById|show)\('([^']+)'/g)].map((m) => m[1])
  for (const id of new Set(used)) expect(GRANT_HTML, id).toContain(`id="${id}"`)
  expect(GRANT_SRC).not.toMatch(/chrome\.cookies|chrome\.scripting|fetch\(/)
})
