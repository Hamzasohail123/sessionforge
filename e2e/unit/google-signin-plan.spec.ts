import { test, expect } from '@playwright/test'
import { matchGoogleSignIn, type SignInMatch } from '../../src/main/google-signin/match'
import {
  chooseCompletionTab,
  DEFAULT_CONTINUE,
  handOffBlocker,
  planHandOff,
  type PlanContext
} from '../../src/main/google-signin/plan'

const GMAIL =
  'https://accounts.google.com/v3/signin/identifier?continue=https://mail.google.com/mail/u/0/&service=mail&flowName=GlifWebSignIn'
const match = (url: string, testOrigins: string[] = []): SignInMatch => {
  const m = matchGoogleSignIn(url, [], { testOrigins })
  if (!m) throw new Error('no match: ' + url)
  return m
}
const ctx = (m: SignInMatch, extra: Partial<PlanContext> = {}): PlanContext => ({
  tabId: 'tab-1',
  match: m,
  lastSiteUrl: null,
  opener: null,
  testOrigins: [],
  ...extra
})

test.describe('planHandOff: Google account', () => {
  test('Gmail: ServiceLogin with service, continue and followup; domains google.com', () => {
    const plan = planHandOff(ctx(match(GMAIL)))
    if (!plan.ok) throw new Error('plan failed')
    const u = new URL(plan.chromeUrl)
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/ServiceLogin')
    expect([...u.searchParams.keys()]).toEqual(['service', 'continue', 'followup'])
    expect(u.searchParams.get('service')).toBe('mail')
    expect(u.searchParams.get('continue')).toBe('https://mail.google.com/mail/u/0/')
    expect(u.searchParams.get('followup')).toBe('https://mail.google.com/mail/u/0/')
    expect(u.searchParams.has('passive')).toBe(false)
    expect(plan).toMatchObject({
      kind: 'google-account',
      returnUrl: 'https://mail.google.com/mail/u/0/',
      returnTabId: 'tab-1',
      targetHost: 'accounts.google.com',
      cookieDomains: ['google.com']
    })
  })

  test('YouTube adds youtube.com; no continue falls back to myaccount', () => {
    const yt = planHandOff(
      ctx(match('https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin'))
    )
    expect(yt.ok && yt.cookieDomains).toEqual(['google.com', 'youtube.com'])
    const bare = planHandOff(ctx(match('https://accounts.google.com/')))
    expect(bare.ok && bare.returnUrl).toBe(DEFAULT_CONTINUE)
    expect(bare.ok && new URL(bare.chromeUrl).searchParams.get('continue')).toBe(DEFAULT_CONTINUE)
    expect(bare.ok && bare.cookieDomains).toEqual(['google.com'])
  })

  test('e2e test origin: domains google.com + localhost', () => {
    const local = 'http://localhost:41234'
    const m = match(`${local}/v3/signin/identifier?service=mail&continue=${encodeURIComponent(local + '/page?label=A')}`, [local])
    const plan = planHandOff(ctx(m, { testOrigins: [local] }))
    expect(plan).toMatchObject({ ok: true, returnUrl: `${local}/page?label=A`, cookieDomains: ['google.com', 'localhost'] })
    expect(plan.ok && new URL(plan.chromeUrl).origin).toBe(local)
  })

  test('a long continue first drops followup, then falls back to the default continue', () => {
    const longCont = 'https://mail.google.com/' + 'a'.repeat(4090 - 'https://mail.google.com/'.length)
    const m1 = match(`https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(longCont)}`)
    expect(m1.continueUrl).toBe(longCont)
    // Encoded twice (continue + followup) the URL would be over 8192
    const p1 = planHandOff(ctx(m1))
    if (!p1.ok) throw new Error('plan failed')
    const u1 = new URL(p1.chromeUrl)
    expect(u1.searchParams.has('followup')).toBe(false)
    expect(u1.searchParams.get('continue')).toBe(longCont)
    expect(p1.chromeUrl.length).toBeLessThanOrEqual(8192)
    expect(p1.returnUrl).toBe(longCont)

    // Characters that encode to three (under 4096 raw): over 8192 even without followup
    const heavy = 'https://mail.google.com/?' + '&'.repeat(3000)
    const m2 = match(`https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(heavy)}`)
    expect(m2.continueUrl).toBe(heavy)
    const p2 = planHandOff(ctx(m2))
    if (!p2.ok) throw new Error('plan failed')
    expect(p2.returnUrl).toBe(DEFAULT_CONTINUE)
    expect(new URL(p2.chromeUrl).searchParams.get('continue')).toBe(DEFAULT_CONTINUE)
    expect(p2.cookieDomains).toEqual(['google.com'])
    expect(p2.chromeUrl.length).toBeLessThanOrEqual(8192)
  })
})

test.describe('planHandOff: OAuth', () => {
  const OAUTH = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.example%2Fcb'

  test('the tab’s last site wins', () => {
    const plan = planHandOff(ctx(match(OAUTH), { lastSiteUrl: 'https://www.stackoverflow.com/users/login' }))
    expect(plan).toEqual({
      ok: true,
      kind: 'oauth',
      chromeUrl: 'https://www.stackoverflow.com/users/login',
      returnUrl: 'https://www.stackoverflow.com/users/login',
      returnTabId: 'tab-1',
      targetHost: 'www.stackoverflow.com',
      cookieDomains: ['stackoverflow.com']
    })
  })

  test('popup: the opener’s URL, else its last site; the opener is the return tab', () => {
    const opener = { tabId: 'opener', url: 'https://site.example/login', lastSiteUrl: 'https://site.example/login' }
    const p1 = planHandOff(ctx(match(OAUTH), { opener }))
    expect(p1).toMatchObject({ ok: true, returnUrl: 'https://site.example/login', returnTabId: 'opener' })

    const onGoogle = { tabId: 'opener', url: 'https://accounts.google.com/ServiceLogin', lastSiteUrl: 'https://site.example/a' }
    expect(planHandOff(ctx(match(OAUTH), { opener: onGoogle }))).toMatchObject({
      ok: true,
      returnUrl: 'https://site.example/a',
      returnTabId: 'opener'
    })

    const local = 'http://localhost:41234'
    const onTest = { tabId: 'opener', url: `${local}/v3/signin/identifier`, lastSiteUrl: null }
    expect(
      planHandOff(ctx(match(OAUTH), { opener: onTest, testOrigins: [local], lastSiteUrl: 'http://127.0.0.1:41234/site' }))
    ).toMatchObject({ ok: true, returnUrl: 'http://127.0.0.1:41234/site', returnTabId: 'tab-1', cookieDomains: ['127.0.0.1'] })
  })

  test('appOrigin fallback, local http site, nothing → no_site', () => {
    expect(planHandOff(ctx(match(OAUTH)))).toMatchObject({
      ok: true,
      returnUrl: 'https://app.example/',
      cookieDomains: ['app.example']
    })
    expect(planHandOff(ctx(match('https://accounts.google.com/o/oauth2/v2/auth?client_id=x')))).toEqual({
      ok: false,
      reason: 'no_site'
    })
    expect(
      planHandOff(ctx(match('https://accounts.google.com/o/oauth2/v2/auth?client_id=x'), { lastSiteUrl: 'http://localhost:3000/login' }))
    ).toMatchObject({ ok: true, returnUrl: 'http://localhost:3000/login', cookieDomains: ['localhost'] })
  })

  test('IPv6 and LAN candidates are skipped', () => {
    const bare = match('https://accounts.google.com/o/oauth2/v2/auth?client_id=x')
    expect(planHandOff(ctx(bare, { lastSiteUrl: 'http://[::1]:3000/' }))).toEqual({ ok: false, reason: 'no_site' })
    expect(
      planHandOff(
        ctx(bare, {
          opener: { tabId: 'opener', url: 'http://[::1]:3000/', lastSiteUrl: null },
          lastSiteUrl: 'http://localhost:3000/'
        })
      )
    ).toMatchObject({ ok: true, returnUrl: 'http://localhost:3000/', returnTabId: 'tab-1' })
    expect(planHandOff(ctx(bare, { lastSiteUrl: 'http://192.168.1.10/' }))).toEqual({ ok: false, reason: 'no_site' })
  })
})

test('chooseCompletionTab', () => {
  const req = { tabId: 'popup', returnTabId: 'opener', sessionId: 's1', returnUrl: 'https://site.example/login' }
  const tabs = (entries: Array<[string, { sessionId: string; url: string; onSignInPage: boolean }]>) => new Map(entries)
  // Return tab preferred
  expect(
    chooseCompletionTab(
      req,
      tabs([
        ['opener', { sessionId: 's1', url: 'https://site.example/other', onSignInPage: false }],
        ['popup', { sessionId: 's1', url: 'https://accounts.google.com/x', onSignInPage: true }]
      ])
    )
  ).toBe('opener')
  // Return tab gone → banner tab
  expect(
    chooseCompletionTab(req, tabs([['popup', { sessionId: 's1', url: 'https://accounts.google.com/x', onSignInPage: true }]]))
  ).toBe('popup')
  // Wrong session skipped
  expect(
    chooseCompletionTab(req, tabs([['opener', { sessionId: 's2', url: 'https://site.example/login', onSignInPage: false }]]))
  ).toBeNull()
  // Moved elsewhere skipped
  expect(
    chooseCompletionTab(req, tabs([['opener', { sessionId: 's1', url: 'https://news.example/', onSignInPage: false }]]))
  ).toBeNull()
  expect(chooseCompletionTab(req, new Map())).toBeNull()
})

test('handOffBlocker', () => {
  expect(handOffBlocker({ port: 34567, listening: true }, false)).toBeNull()
  // ImportServer.status() reports "port N is in use"; Node's code and message are accepted too
  for (const error of ['port 34567 is in use', 'EADDRINUSE', 'listen EADDRINUSE: address already in use 127.0.0.1:34567']) {
    expect(handOffBlocker({ port: 34567, listening: false, error }, false), error).toContain('port 34567 is in use')
  }
  expect(handOffBlocker({ port: 34567, listening: false }, false)).toBe(
    "The import server isn't running, so the extension can't send the login back. Restart SessionForge."
  )
  expect(handOffBlocker({ port: 40000, listening: true }, false)).toContain('needs the import server on port 34567')
  expect(handOffBlocker({ port: 40000, listening: true }, false)).toContain('40000')
  expect(handOffBlocker({ port: 40000, listening: true }, true)).toBeNull()
  expect(handOffBlocker({ port: 40000, listening: false }, true)).not.toBeNull()
})
