import { test, expect } from '@playwright/test'
import { ConcurrencyGate, Mutex, TokenBucket } from '../../src/main/agent/rate-limit'

test('token bucket refills with a fake clock', () => {
  let now = 0
  const b = new TokenBucket(3, 1, () => now)
  expect([b.take(), b.take(), b.take()]).toEqual([0, 0, 0])
  expect(b.take()).toBe(1000)
  now = 500
  expect(b.take()).toBe(500)
  now = 1000
  expect(b.take()).toBe(0)
  now = 100_000
  expect([b.take(), b.take(), b.take()]).toEqual([0, 0, 0])
  expect(b.take()).toBeGreaterThan(0)
})

test('concurrency gate', () => {
  const g = new ConcurrencyGate(2)
  expect(g.tryEnter()).toBe(true)
  expect(g.tryEnter()).toBe(true)
  expect(g.tryEnter()).toBe(false)
  g.leave()
  expect(g.tryEnter()).toBe(true)
  expect(g.active).toBe(2)
})

test('mutex serialises holders and times out waiters', async () => {
  const m = new Mutex()
  const r1 = await m.acquire(1000)
  expect(r1).not.toBeNull()
  const late = await m.acquire(50)
  expect(late).toBeNull()
  const p = m.acquire(1000)
  r1!()
  const r2 = await p
  expect(r2).not.toBeNull()
  r2!()
})
