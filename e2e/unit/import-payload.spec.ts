import { test, expect } from '@playwright/test'
import {
  deriveSessionName,
  formatZodIssues,
  HandOffImportSchema,
  IMPORTED_SESSION_COOKIE_TTL_SEC,
  ImportPayloadSchema,
  isHandOffPayload,
  isHttpUrl,
  isOpenableUrl,
  pickSessionColor,
  resolveImportPort,
  StorageStateSchema,
  toElectronCookie
} from '../../src/main/import-payload'
import { SESSION_NAME_MAX } from '../../src/main/constants'

test.describe('isOpenableUrl', () => {
  test('accepts http(s) and view-source of http(s)', () => {
    for (const u of ['https://a.b', 'http://127.0.0.1:1/', 'view-source:https://a.b/']) {
      expect(isOpenableUrl(u), u).toBe(true)
    }
  })

  test('rejects other schemes and unparsable inner URLs', () => {
    for (const u of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,x',
      'view-source:file:///x',
      'chrome://settings',
      'view-source:https://'
    ]) {
      expect(isOpenableUrl(u), u).toBe(false)
    }
  })
})

test('isHttpUrl', () => {
  expect(isHttpUrl('https://a.b/')).toBe(true)
  expect(isHttpUrl('view-source:https://a.b/')).toBe(false)
  expect(isHttpUrl('nope')).toBe(false)
})

const cookie = (extra: Record<string, unknown> = {}) => ({ name: 'n', value: 'v', domain: 'a.example', ...extra })

test.describe('StorageStateSchema', () => {
  test('parses a Playwright-format file and normalizes sameSite', () => {
    const parsed = StorageStateSchema.parse({
      cookies: [
        cookie({ name: 'none', sameSite: 'None', secure: true }),
        cookie({ name: 'strict', sameSite: 'Strict' }),
        cookie({ name: 'electron', sameSite: 'unspecified' }),
        cookie({ name: 'chrome', sameSite: 'no_restriction', secure: true }),
        cookie({ name: 'lax', sameSite: 'Lax' })
      ],
      origins: [{ origin: 'https://a.example/', localStorage: [{ name: 'k', value: 'v' }] }]
    })
    expect(parsed.cookies.map((c) => c.sameSite)).toEqual(['no_restriction', 'strict', 'lax', 'no_restriction', 'lax'])
    expect(parsed.origins[0].origin).toBe('https://a.example')
  })

  test('fills defaults: origins [], path /, expires -1, flags false, sameSite lax', () => {
    const parsed = StorageStateSchema.parse({ cookies: [cookie()] })
    expect(parsed.origins).toEqual([])
    expect(parsed.cookies[0]).toEqual({
      name: 'n',
      value: 'v',
      domain: 'a.example',
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'lax'
    })
  })

  test('rejects a cookie without a name, with the path in formatZodIssues', () => {
    const res = StorageStateSchema.safeParse({ cookies: [{ value: 'v', domain: 'a.example' }] })
    expect(res.success).toBe(false)
    if (!res.success) expect(formatZodIssues(res.error)).toContain('cookies.0.name')
  })

  test('rejects an unknown sameSite value', () => {
    const res = StorageStateSchema.safeParse({ cookies: [cookie({ sameSite: 'weird' })] })
    expect(res.success).toBe(false)
    if (!res.success) expect(formatZodIssues(res.error)).toContain('cookies.0.sameSite')
  })

  test('formatZodIssues keeps the first 3 issues', () => {
    const res = StorageStateSchema.safeParse({ cookies: [{}, {}] })
    expect(res.success).toBe(false)
    if (!res.success) expect(formatZodIssues(res.error).split('; ')).toHaveLength(3)
  })
})

test.describe('ImportPayloadSchema', () => {
  const base = {
    storageState: { cookies: [] },
    metadata: { url: 'https://mail.google.com/mail/u/0/' }
  }

  test('accepts a minimal payload and normalizes origins', () => {
    const parsed = ImportPayloadSchema.parse({
      ...base,
      action: 'import',
      sessionName: '  me@example.com ',
      storageState: { cookies: [], origins: [{ origin: 'https://mail.google.com/', localStorage: [] }] }
    })
    expect(parsed.sessionName).toBe('me@example.com')
    expect(parsed.storageState.origins[0].origin).toBe('https://mail.google.com')
  })

  test('oversized or malformed title and favicon never fail the payload', () => {
    const favicon = 'data:image/png;base64,' + 'A'.repeat(10_000)
    const parsed = ImportPayloadSchema.parse({ ...base, metadata: { ...base.metadata, title: 'x'.repeat(800), favicon } })
    expect(parsed.metadata.title).toHaveLength(500)
    expect(parsed.metadata.favicon).toBeUndefined()
    const odd = ImportPayloadSchema.parse({ ...base, metadata: { ...base.metadata, title: 42, favicon: null } })
    expect(odd.metadata.title).toBeUndefined()
    expect(odd.metadata.favicon).toBeUndefined()
    const ok = ImportPayloadSchema.parse({ ...base, metadata: { ...base.metadata, title: 'Inbox', favicon: 'https://x/f.ico' } })
    expect(ok.metadata).toEqual({ url: base.metadata.url, title: 'Inbox', favicon: 'https://x/f.ico' })
  })

  test('rejects non-http metadata urls and origins, and a missing url', () => {
    expect(ImportPayloadSchema.safeParse({ ...base, metadata: { url: 'file:///etc/passwd' } }).success).toBe(false)
    expect(ImportPayloadSchema.safeParse({ ...base, metadata: { url: 'javascript:alert(1)' } }).success).toBe(false)
    expect(ImportPayloadSchema.safeParse({ ...base, metadata: {} }).success).toBe(false)
    expect(
      ImportPayloadSchema.safeParse({
        ...base,
        storageState: { cookies: [], origins: [{ origin: 'chrome-extension://abc/', localStorage: [] }] }
      }).success
    ).toBe(false)
    expect(ImportPayloadSchema.safeParse({ ...base, action: 'export' }).success).toBe(false)
  })
})

test.describe('HandOffImportSchema', () => {
  const id = '8f0c2a4e-1b3d-4c5e-9f60-718293a4b5c6'

  test('requires a UUID requestId and strips metadata and sessionName', () => {
    const parsed = HandOffImportSchema.parse({
      action: 'import',
      requestId: id,
      sessionName: 'Evil',
      metadata: { url: 'https://evil.example/' },
      storageState: { cookies: [cookie()] }
    })
    expect(parsed).toEqual({
      action: 'import',
      requestId: id,
      storageState: StorageStateSchema.parse({ cookies: [cookie()] })
    })
    expect(HandOffImportSchema.safeParse({ requestId: 'abc', storageState: { cookies: [] } }).success).toBe(false)
    expect(HandOffImportSchema.safeParse({ requestId: 42, storageState: { cookies: [] } }).success).toBe(false)
    expect(HandOffImportSchema.safeParse({ requestId: id }).success).toBe(false)
  })

  test('keeps the existing caps (3001 cookies rejected)', () => {
    const cookies = Array.from({ length: 3001 }, (_, i) => cookie({ name: `c${i}` }))
    expect(HandOffImportSchema.safeParse({ requestId: id, storageState: { cookies } }).success).toBe(false)
    expect(HandOffImportSchema.safeParse({ requestId: id, storageState: { cookies: cookies.slice(1) } }).success).toBe(true)
  })

  test('isHandOffPayload: only objects with an own requestId key', () => {
    expect(isHandOffPayload({ requestId: id })).toBe(true)
    expect(isHandOffPayload({ requestId: null })).toBe(true)
    expect(isHandOffPayload({ storageState: {} })).toBe(false)
    expect(isHandOffPayload(Object.create({ requestId: id }))).toBe(false)
    expect(isHandOffPayload([id])).toBe(false)
    expect(isHandOffPayload(null)).toBe(false)
    expect(isHandOffPayload('requestId')).toBe(false)
  })
})

test.describe('toElectronCookie', () => {
  const now = 1_700_000_000
  const parse = (c: Record<string, unknown>) => StorageStateSchema.parse({ cookies: [c] }).cookies[0]

  test('host-only cookie: no domain, http url', () => {
    const out = toElectronCookie(parse(cookie({ domain: '127.0.0.1', path: '/x' })), now)
    expect(out).toMatchObject({ url: 'http://127.0.0.1/x', domain: undefined, path: '/x', sameSite: 'lax' })
  })

  test('domain cookie keeps its leading dot; secure goes through https', () => {
    const out = toElectronCookie(parse(cookie({ domain: '.google.com', secure: true, sameSite: 'None' })), now)
    expect(out).toMatchObject({
      url: 'https://google.com/',
      domain: '.google.com',
      secure: true,
      sameSite: 'no_restriction'
    })
  })

  test('a path without a leading slash becomes /', () => {
    expect(toElectronCookie(parse(cookie({ path: 'weird' })), now)?.path).toBe('/')
  })

  test('expiry: future kept, -1 gets now + 30 days, past is skipped', () => {
    expect(IMPORTED_SESSION_COOKIE_TTL_SEC).toBe(30 * 24 * 60 * 60)
    expect(toElectronCookie(parse(cookie({ expires: now + 60 })), now)?.expirationDate).toBe(now + 60)
    expect(toElectronCookie(parse(cookie({ expires: -1 })), now)?.expirationDate).toBe(
      now + IMPORTED_SESSION_COOKIE_TTL_SEC
    )
    const frac = now + 0.5
    expect(toElectronCookie(parse(cookie({ expires: -1 })), frac)?.expirationDate).toBeCloseTo(
      frac + IMPORTED_SESSION_COOKIE_TTL_SEC,
      3
    )
    expect(toElectronCookie(parse(cookie({ expires: now - 1 })), now)).toBeNull()
    expect(toElectronCookie(parse(cookie({ expires: now })), now)).toBeNull()
  })

  test('httpOnly passes through', () => {
    expect(toElectronCookie(parse(cookie({ httpOnly: true })), now)?.httpOnly).toBe(true)
  })
})

test.describe('deriveSessionName', () => {
  const metadata = { url: 'https://mail.google.com/mail/u/0/' }

  test('sessionName wins, else the hostname', () => {
    expect(deriveSessionName({ sessionName: 'me@x.com', metadata }, new Set())).toBe('me@x.com')
    expect(deriveSessionName({ metadata }, new Set())).toBe('mail.google.com')
  })

  test('dedupes with " 2" … " 99", then a timestamp', () => {
    expect(deriveSessionName({ metadata }, new Set(['mail.google.com']))).toBe('mail.google.com 2')
    expect(deriveSessionName({ metadata }, new Set(['mail.google.com', 'mail.google.com 2']))).toBe(
      'mail.google.com 3'
    )
    const all = new Set(['mail.google.com', ...Array.from({ length: 98 }, (_, i) => `mail.google.com ${i + 2}`)])
    expect(all.has('mail.google.com 99')).toBe(true)
    expect(deriveSessionName({ metadata }, all)).toMatch(/^mail\.google\.com \d{13}$/)
  })

  test('cuts the name so it fits SESSION_NAME_MAX (60) with its suffix', () => {
    const long = 'a'.repeat(100)
    const a60 = 'a'.repeat(60)
    expect(SESSION_NAME_MAX).toBe(60)
    expect(deriveSessionName({ sessionName: long, metadata }, new Set())).toBe(a60)
    expect(deriveSessionName({ sessionName: long, metadata }, new Set([a60]))).toBe(`${'a'.repeat(58)} 2`)
    const taken = new Set([a60, ...Array.from({ length: 98 }, (_, i) => `${'a'.repeat(i + 2 < 10 ? 58 : 57)} ${i + 2}`)])
    const stamped = deriveSessionName({ sessionName: long, metadata }, taken)
    expect(stamped).toMatch(/^a{46} \d{13}$/)
    expect(stamped).toHaveLength(60)
    // A cut that ends on a space doesn't leave a double space before the suffix
    expect(deriveSessionName({ sessionName: `${'b'.repeat(57)} cd`, metadata }, new Set([`${'b'.repeat(57)} cd`]))).toBe(
      `${'b'.repeat(57)} 2`
    )
    // A long hostname is cut too; a 60-character name is unchanged
    const host = `${'h'.repeat(40)}.${'k'.repeat(40)}.example.com`
    expect(deriveSessionName({ metadata: { url: `https://${host}/` } }, new Set())).toBe(`${'h'.repeat(40)}.${'k'.repeat(19)}`)
    expect(deriveSessionName({ sessionName: a60, metadata }, new Set())).toBe(a60)
  })
})

test('pickSessionColor: first unused, then cycles', () => {
  const palette = ['#1', '#2', '#3']
  expect(pickSessionColor(palette, [])).toBe('#1')
  expect(pickSessionColor(palette, ['#1', '#3'])).toBe('#2')
  expect(pickSessionColor(palette, ['#1', '#2', '#3'])).toBe('#1')
  expect(pickSessionColor(palette, ['#1', '#2', '#3', '#1'])).toBe('#2')
})

test('resolveImportPort', () => {
  expect(resolveImportPort(undefined)).toBe(34567)
  expect(resolveImportPort('')).toBe(34567)
  expect(resolveImportPort('8080')).toBe(8080)
  for (const bad of ['0', '65536', '12.5', 'abc']) expect(resolveImportPort(bad), bad).toBe(34567)
})
