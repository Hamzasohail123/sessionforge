import { test, expect } from '@playwright/test'
import { placeTourCard, type Rect, type Size } from '../../src/renderer/src/lib/tour-placement'
const VP: Size = { w: 1400, h: 900 }
const CARD: Size = { w: 340, h: 180 }
/** The 12 px bound holds only for cards that fit the viewport minus both margins */
function expectInside(p: { left: number; top: number }, card: Size, vp: Size): void {
  if (card.w > vp.w - 24 || card.h > vp.h - 24) return
  expect(p.left).toBeGreaterThanOrEqual(12)
  expect(p.top).toBeGreaterThanOrEqual(12)
  expect(p.left + card.w).toBeLessThanOrEqual(vp.w - 12)
  expect(p.top + card.h).toBeLessThanOrEqual(vp.h - 12)
}
function overlaps(p: { left: number; top: number }, card: Size, a: Rect): boolean {
  return p.left < a.left + a.width && p.left + card.w > a.left && p.top < a.top + a.height && p.top + card.h > a.top
}
test('the preferred side is used when there is room', () => {
  const nav: Rect = { left: 200, top: 150, width: 180, height: 32 }
  const right = placeTourCard(nav, CARD, VP, 'right')
  expect(right.side).toBe('right')
  expect(right.left).toBe(200 + 180 + 10)
  const gear: Rect = { left: 1300, top: 8, width: 32, height: 32 }
  const bottom = placeTourCard(gear, CARD, VP, 'bottom')
  expect(bottom.side).toBe('bottom')
  expect(bottom.top).toBe(8 + 32 + 10)
  for (const [p, a] of [
    [right, nav],
    [bottom, gear]
  ] as const) {
    expectInside(p, CARD, VP)
    expect(overlaps(p, CARD, a)).toBe(false)
  }
})
test('with no room on the right it falls back to bottom, then top', () => {
  // Hugging the right edge, room below
  const a: Rect = { left: 1250, top: 100, width: 120, height: 40 }
  expect(placeTourCard(a, CARD, VP, 'right').side).toBe('bottom')
  // Right edge and bottom edge: only top is left
  const b: Rect = { left: 1250, top: 700, width: 120, height: 40 }
  const p = placeTourCard(b, CARD, VP, 'right')
  expect(p.side).toBe('top')
  expect(p.top).toBe(700 - 10 - CARD.h)
  expectInside(p, CARD, VP)
})
test('centred when the anchor is missing', () => {
  const p = placeTourCard(null, CARD, VP, 'bottom')
  expect(p).toEqual({ left: (1400 - 340) / 2, top: (900 - 180) / 2, side: 'center' })
})
test('centred when no side fits (small window, large anchor)', () => {
  const vp: Size = { w: 360, h: 300 }
  const card: Size = { w: 300, h: 200 }
  const p = placeTourCard({ left: 20, top: 20, width: 320, height: 260 }, card, vp, 'right')
  expect(p.side).toBe('center')
  expectInside(p, card, vp)
})
test('clamped on a narrow 480 px window', () => {
  const vp: Size = { w: 480, h: 700 }
  const card: Size = { w: 340, h: 200 }
  // Anchor near the left edge: centring on it would push the card off-screen
  const p = placeTourCard({ left: 0, top: 40, width: 40, height: 30 }, card, vp, 'bottom')
  expect(p.side).toBe('bottom')
  expect(p.left).toBe(12)
  expectInside(p, card, vp)
  // And near the right edge
  const q = placeTourCard({ left: 440, top: 40, width: 40, height: 30 }, card, vp, 'bottom')
  expect(q.left).toBe(480 - 12 - 340)
  expectInside(q, card, vp)
})
