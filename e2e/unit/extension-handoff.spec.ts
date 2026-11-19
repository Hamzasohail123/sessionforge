import { test, expect } from '@playwright/test'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require_ = createRequire(__filename)
const HandOff = require_(join(__dirname, '..', '..', 'chrome-extension', 'handoff.js')) as {
  parsePending(json: unknown, now: number): Array<Record<string, unknown>>
  collectCookiesForDomains(
    getAll: (q: { domain: string }) => Promise<unknown[]>,
    domains: string[]
  ): Promise<Array<{ name: string }>>
  buildHandOffPayload(requestId: string, cookies: unknown[]): Record<string, unknown>
  toPlaywrightCookie(c: unknown): Record<string, unknown>
}

const NOW = 1_763_420_000_000
const id = (n: number) => `8f0c2a4e-1b3d-4c5e-9f60-${String(n).padStart(12, '0')}`
const req = (extra: Record<string, unknown> = {}) => ({
  id: id(1),
  sessionName: 'Gmail',
  sessionColor: '#ef4444',
  cookieDomains: ['google.com'],
  expiresAt: NOW + 60_000,
  ...extra
})

test('parsePending keeps well-formed live requests and drops the rest', () => {
  const out = HandOff.parsePending(
    {
      requests: [
        req(),
        req({ id: 'not-a-uuid' }),
        req({ id: id(2), expiresAt: NOW }),
        req({ id: id(3), cookieDomains: ['Google.COM'] }),
        req({ id: id(4), cookieDomains: ['evil.com/x'] }),
        req({ id: id(5), cookieDomains: [] }),
        req({ id: id(6), cookieDomains: ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'] }),
        req({ id: id(7), sessionName: 42 }),
        null,
        'x',
        req({ id: id(8), sessionColor: 'red', sessionName: 'N'.repeat(150), cookieDomains: ['localhost', '127.0.0.1'] }),
        req({ id: id(9) }),
        req({ id: id(10) })
      ]
    },
    NOW
  )
  expect(out.map((r) => r.id)).toEqual([id(1), id(8), id(9)])
  expect(out[0]).toEqual(req())
  expect(out[1]).toMatchObject({ sessionColor: '#3b82f6', cookieDomains: ['localhost', '127.0.0.1'] })
  expect((out[1].sessionName as string).length).toBe(100)
  expect(HandOff.parsePending(null, NOW)).toEqual([])
  expect(HandOff.parsePending({ requests: 'x' }, NOW)).toEqual([])
})

test('collectCookiesForDomains asks per domain and dedupes by name|domain|path', async () => {
  const asked: string[] = []
  const jar: Record<string, unknown[]> = {
    'google.com': [
      { name: 'SID', domain: '.google.com', path: '/' },
      { name: 'NID', domain: '.google.com', path: '/' }
    ],
    'youtube.com': [
      { name: 'SID', domain: '.google.com', path: '/' },
      { name: 'LOGIN_INFO', domain: '.youtube.com', path: '/' }
    ]
  }
  const got = await HandOff.collectCookiesForDomains(async ({ domain }) => {
    asked.push(domain)
    return jar[domain] ?? []
  }, ['google.com', 'youtube.com'])
  expect(asked).toEqual(['google.com', 'youtube.com'])
  expect(got.map((c) => c.name)).toEqual(['SID', 'NID', 'LOGIN_INFO'])
})

test('buildHandOffPayload: requestId, Playwright cookies, no metadata, origins []', () => {
  const p = HandOff.buildHandOffPayload(id(1), [
    {
      name: 'SID',
      value: 'v',
      domain: 'google.com',
      hostOnly: false,
      path: '/',
      session: true,
      httpOnly: true,
      secure: true,
      sameSite: 'no_restriction'
    }
  ])
  expect(p).toEqual({
    action: 'import',
    requestId: id(1),
    storageState: {
      cookies: [
        { name: 'SID', value: 'v', domain: '.google.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'None' }
      ],
      origins: []
    }
  })
  expect('metadata' in p).toBe(false)
})
