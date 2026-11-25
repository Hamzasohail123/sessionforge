import { test, expect } from '@playwright/test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { LATEST_RELEASE_API_URL } from '../../src/main/constants'
const require_ = createRequire(__filename)
type Fetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
interface Storage {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}
const Update = require_(join(__dirname, '..', '..', 'chrome-extension', 'update-check.js')) as {
  LATEST_URL: string
  RELEASES_URL: string
  CACHE_KEY: string
  CHECK_INTERVAL: number
  parseVersion(v: unknown): number[] | null
  isNewer(latest: unknown, current: unknown): boolean
  appVersionOf(json: unknown): string | null
  isDue(cache: unknown, now: number): boolean
  latestFromRelease(json: unknown): string | null
  check(deps: { storage: Storage; fetch: Fetch; now: number; appVersion: unknown }): Promise<string | null>
}
const NOW = 1_763_420_000_000
const DAY = 86_400_000

function deps(reply: { status: number; body?: unknown } | 'network-error', appVersion: unknown = '0.1.0') {
  const store = new Map<string, unknown>()
  const calls: Array<{ url: string; init: RequestInit }> = []
  const storage: Storage = {
    get: async (k) => (store.has(k) ? { [k]: store.get(k) } : {}),
    set: async (items) => {
      for (const [k, v] of Object.entries(items)) store.set(k, v)
    }
  }
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init })
    if (reply === 'network-error') throw new TypeError('Failed to fetch')
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body }
  }
  return { store, calls, d: { storage, fetch, now: NOW, appVersion } }
}

test('constants match the desktop app and the store disclosure', () => {
  expect(Update.LATEST_URL).toBe(LATEST_RELEASE_API_URL)
  expect(Update.RELEASES_URL).toBe('https://github.com/Hamzasohail123/sessionforge/releases/latest')
  expect(Update.CACHE_KEY).toBe('desktopRelease')
  expect(Update.CHECK_INTERVAL).toBe(DAY)
})
test('version compare', () => {
  expect(Update.parseVersion('v1.2.3')).toEqual([1, 2, 3])
  for (const bad of ['1.2', '1.2.3-beta', 'x', null, 3]) expect(Update.parseVersion(bad)).toBeNull()
  expect(Update.isNewer('0.10.0', '0.9.9')).toBe(true)
  expect(Update.isNewer('v0.2.0', '0.1.0')).toBe(true)
  expect(Update.isNewer('0.1.0', '0.1.0')).toBe(false)
  expect(Update.isNewer('0.0.9', '0.1.0')).toBe(false)
  expect(Update.isNewer('junk', '0.1.0')).toBe(false)
})
test('appVersionOf: no field on a valid /pending body means 0.1.0; anything odd means unknown', () => {
  expect(Update.appVersionOf({ requests: [] })).toBe('0.1.0')
  expect(Update.appVersionOf({ requests: [], appVersion: '0.2.0' })).toBe('0.2.0')
  expect(Update.appVersionOf({ requests: [], appVersion: 'v0.3.1' })).toBe('0.3.1')
  expect(Update.appVersionOf({ requests: [], appVersion: 'dev' })).toBeNull()
  expect(Update.appVersionOf({ requests: [], appVersion: null })).toBeNull()
  for (const v of [null, 'x', {}, { requests: 'no' }, []]) expect(Update.appVersionOf(v)).toBeNull()
})
test('isDue', () => {
  expect(Update.isDue(null, NOW)).toBe(true)
  expect(Update.isDue({}, NOW)).toBe(true)
  expect(Update.isDue({ checkedAt: 'x' }, NOW)).toBe(true)
  expect(Update.isDue({ checkedAt: NOW + 1 }, NOW)).toBe(true)
  expect(Update.isDue({ checkedAt: NOW - DAY + 60_000 }, NOW)).toBe(false)
  expect(Update.isDue({ checkedAt: NOW - DAY }, NOW)).toBe(true)
})
test('latestFromRelease', () => {
  expect(Update.latestFromRelease({ tag_name: 'v0.2.0' })).toBe('0.2.0')
  expect(Update.latestFromRelease({ tag_name: 'v0.2.0', draft: true })).toBeNull()
  expect(Update.latestFromRelease({ tag_name: 'v0.2.0', prerelease: true })).toBeNull()
  expect(Update.latestFromRelease({ tag_name: 'nightly' })).toBeNull()
  expect(Update.latestFromRelease(null)).toBeNull()
})
test('check: newer → version, one cookie-less request, cached', async () => {
  const { d, calls, store } = deps({ status: 200, body: { tag_name: 'v0.2.0' } })
  expect(await Update.check(d)).toBe('0.2.0')
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe(LATEST_RELEASE_API_URL)
  expect(calls[0].init.credentials).toBe('omit')
  expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
  expect(store.get('desktopRelease')).toEqual({ checkedAt: NOW, latest: '0.2.0' })
  // Inside 24 h: no request, same answer
  expect(await Update.check({ ...d, now: NOW + DAY - 1 })).toBe('0.2.0')
  expect(calls).toHaveLength(1)
  expect(await Update.check({ ...d, now: NOW + DAY })).toBe('0.2.0')
  expect(calls).toHaveLength(2)
})
test('check: same or older → null', async () => {
  expect(await Update.check(deps({ status: 200, body: { tag_name: 'v0.1.0' } }).d)).toBeNull()
  expect(await Update.check(deps({ status: 200, body: { tag_name: 'v0.0.9' } }).d)).toBeNull()
})
test('check: network error writes nothing; HTTP error keeps the previous latest and waits a day', async () => {
  const offline = deps('network-error')
  expect(await Update.check(offline.d)).toBeNull()
  expect(offline.store.has('desktopRelease')).toBe(false)

  const limited = deps({ status: 403 })
  limited.store.set('desktopRelease', { checkedAt: NOW - 2 * DAY, latest: '0.2.0' })
  expect(await Update.check(limited.d)).toBe('0.2.0')
  expect(limited.store.get('desktopRelease')).toEqual({ checkedAt: NOW, latest: '0.2.0' })
})
test('check: an invalid app version or a throwing storage never throws', async () => {
  const bad = deps({ status: 200, body: { tag_name: 'v0.2.0' } }, null)
  expect(await Update.check(bad.d)).toBeNull()
  expect(bad.calls).toHaveLength(0)
  const broken = deps({ status: 200, body: { tag_name: 'v0.2.0' } })
  broken.d.storage.get = async () => {
    throw new Error('storage gone')
  }
  expect(await Update.check(broken.d)).toBeNull()
})
