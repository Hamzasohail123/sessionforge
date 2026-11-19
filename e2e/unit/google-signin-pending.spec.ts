import { test, expect } from '@playwright/test'
import {
  MAX_PENDING,
  PENDING_TTL_MS,
  PendingSignInStore,
  type PendingSignIn,
  type RemovedReason
} from '../../src/main/google-signin/pending-store'

const input = (sessionId: string, tabId: string): Omit<PendingSignIn, 'id' | 'createdAt' | 'expiresAt'> => ({
  sessionId,
  tabId,
  returnTabId: tabId,
  kind: 'google-account',
  chromeUrl: 'https://accounts.google.com/ServiceLogin',
  returnUrl: 'https://mail.google.com/',
  targetHost: 'accounts.google.com',
  cookieDomains: ['google.com'],
  browser: null
})

function setup(opts: { timers?: boolean; ttlMs?: number } = {}) {
  let now = 1_000_000
  const removed: Array<[string, RemovedReason]> = []
  const store = new PendingSignInStore({
    now: () => now,
    timers: opts.timers ?? false,
    ttlMs: opts.ttlMs,
    onRemoved: (r, why) => removed.push([r.id, why])
  })
  return { store, removed, advance: (ms: number) => (now += ms), now: () => now }
}
const alive = () => true
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('create, list, take; a second take returns null', () => {
  const { store, now } = setup()
  const r = store.create(input('s1', 't1'))
  expect(r.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(r.createdAt).toBe(now())
  expect(r.expiresAt).toBe(now() + PENDING_TTL_MS)
  expect(store.list().map((x) => x.id)).toEqual([r.id])
  expect(store.forTab('t1')?.id).toBe(r.id)
  expect(store.take(r.id, alive)?.id).toBe(r.id)
  expect(store.take(r.id, alive)).toBeNull()
  expect(store.list()).toEqual([])
  expect(store.take('00000000-0000-4000-8000-000000000000', alive)).toBeNull()
})

test('expiry is exactly at expiresAt', () => {
  const { store, advance } = setup()
  const r = store.create(input('s1', 't1'))
  advance(PENDING_TTL_MS - 1)
  expect(store.list()).toHaveLength(1)
  advance(1)
  expect(store.list()).toHaveLength(0)
  expect(store.take(r.id, alive)).toBeNull()
})

test('take with a dead session returns null and still deletes the request', () => {
  const { store, removed } = setup()
  const r = store.create(input('s1', 't1'))
  expect(store.take(r.id, () => false)).toBeNull()
  expect(store.take(r.id, alive)).toBeNull()
  expect(removed).toEqual([])
})

test('same session or same tab replaces ("replaced" once); the 9th evicts the oldest', () => {
  const { store, removed, advance } = setup()
  const a = store.create(input('s1', 't1'))
  const b = store.create(input('s1', 't2'))
  expect(removed).toEqual([[a.id, 'replaced']])
  const c = store.create(input('s2', 't2'))
  expect(removed).toEqual([
    [a.id, 'replaced'],
    [b.id, 'replaced']
  ])
  expect(store.list().map((x) => x.id)).toEqual([c.id])
  removed.length = 0

  const ids = [c.id]
  // c plus 8 more: the 9th request evicts c
  for (let i = 3; i <= MAX_PENDING + 2; i++) {
    advance(1)
    ids.push(store.create(input(`s${i}`, `t${i}`)).id)
  }
  expect(removed).toEqual([[c.id, 'evicted']])
  // Newest first, expired and evicted omitted
  expect(store.list().map((x) => x.id)).toEqual(ids.slice(1).reverse())
})

test('expired requests are omitted from list, newest first', () => {
  const { store, advance } = setup()
  const a = store.create(input('s1', 't1'))
  advance(PENDING_TTL_MS / 2)
  const b = store.create(input('s2', 't2'))
  const c = store.create(input('s3', 't3'))
  expect(store.list().map((x) => x.id)).toEqual([c.id, b.id, a.id])
  advance(PENDING_TTL_MS / 2)
  expect(store.list().map((x) => x.id)).toEqual([c.id, b.id])
})

test.describe('expiry notifications: exactly once, whoever notices first', () => {
  test('through list()', () => {
    const { store, removed, advance } = setup()
    const r = store.create(input('s1', 't1'))
    advance(PENDING_TTL_MS)
    store.list()
    expect(removed).toEqual([[r.id, 'expired']])
    store.list()
    store.forTab('t1')
    store.take(r.id, alive)
    expect(removed).toHaveLength(1)
  })

  test('through forTab()', () => {
    const { store, removed, advance } = setup()
    const r = store.create(input('s1', 't1'))
    advance(PENDING_TTL_MS + 5)
    expect(store.forTab('t1')).toBeNull()
    expect(removed).toEqual([[r.id, 'expired']])
    store.list()
    expect(removed).toHaveLength(1)
  })

  test('through take(), which returns null', () => {
    const { store, removed, advance } = setup()
    const r = store.create(input('s1', 't1'))
    advance(PENDING_TTL_MS)
    expect(store.take(r.id, alive)).toBeNull()
    expect(removed).toEqual([[r.id, 'expired']])
  })

  test('a purge before the timer, then the timer: still one notification', async () => {
    let now = 0
    const removed: RemovedReason[] = []
    const store = new PendingSignInStore({ now: () => now, timers: true, ttlMs: 20, onRemoved: (_r, why) => removed.push(why) })
    store.create(input('s1', 't1'))
    now = 25
    store.list()
    expect(removed).toEqual(['expired'])
    await sleep(50)
    expect(removed).toEqual(['expired'])
    store.dispose()
  })

  test('the timer alone notifies once', async () => {
    const removed: RemovedReason[] = []
    const store = new PendingSignInStore({ timers: true, ttlMs: 20, onRemoved: (_r, why) => removed.push(why) })
    store.create(input('s1', 't1'))
    await sleep(60)
    expect(removed).toEqual(['expired'])
    expect(store.list()).toEqual([])
  })

  test('take and cancel clear the timer', async () => {
    const removed: RemovedReason[] = []
    const store = new PendingSignInStore({ timers: true, ttlMs: 20, onRemoved: (_r, why) => removed.push(why) })
    const a = store.create(input('s1', 't1'))
    const b = store.create(input('s2', 't2'))
    const c = store.create(input('s3', 't3'))
    expect(store.take(a.id, alive)?.id).toBe(a.id)
    store.cancel(b.id)
    store.cancelForTab('t3')
    await sleep(50)
    expect(removed).toEqual([])
    expect(store.list()).toEqual([])
    expect(c.id).toBeTruthy()
  })

  test('dispose clears everything without notifications', async () => {
    const removed: RemovedReason[] = []
    const store = new PendingSignInStore({ timers: true, ttlMs: 20, onRemoved: (_r, why) => removed.push(why) })
    store.create(input('s1', 't1'))
    store.dispose()
    await sleep(50)
    expect(removed).toEqual([])
    expect(store.list()).toEqual([])
  })
})

test('expireForTest: only with SESSIONFORGE_E2E=1', () => {
  const { store, removed } = setup()
  const r = store.create(input('s1', 't1'))
  const prev = process.env.SESSIONFORGE_E2E
  try {
    delete process.env.SESSIONFORGE_E2E
    expect(() => store.expireForTest(r.id)).toThrow('expireForTest is only available in e2e runs')
    expect(store.list()).toHaveLength(1)
    process.env.SESSIONFORGE_E2E = '1'
    store.expireForTest('00000000-0000-4000-8000-000000000000')
    expect(removed).toEqual([])
    store.expireForTest(r.id)
    expect(removed).toEqual([[r.id, 'expired']])
    store.expireForTest(r.id)
    expect(removed).toHaveLength(1)
  } finally {
    if (prev === undefined) delete process.env.SESSIONFORGE_E2E
    else process.env.SESSIONFORGE_E2E = prev
  }
})

test('a throwing onRemoved is caught and logged', () => {
  let now = 0
  const warnings: unknown[][] = []
  const orig = console.warn
  console.warn = (...a: unknown[]) => void warnings.push(a)
  try {
    const store = new PendingSignInStore({
      now: () => now,
      timers: false,
      onRemoved: () => {
        throw new Error('boom')
      }
    })
    store.create(input('s1', 't1'))
    now = PENDING_TTL_MS
    expect(() => store.list()).not.toThrow()
    expect(warnings).toEqual([['[signin] expiry handler failed', 'boom']])
  } finally {
    console.warn = orig
  }
})
