import { test, expect } from '@playwright/test'
import { composite } from '../../src/main/agent/composite'

const solid = (w: number, h: number, bgra: number[]) => {
  const b = Buffer.alloc(w * h * 4)
  for (let i = 0; i < b.length; i += 4) bgra.forEach((v, j) => (b[i + j] = v))
  return b
}
const px = (buf: Buffer, w: number, x: number, y: number) => [...buf.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)]

test('blits at offsets, fills gaps and masks grey, scales', () => {
  const W = 10
  const H = 4
  const out = composite(
    [
      { x: 0, y: 0, width: 4, height: 4, bitmap: solid(4, 4, [255, 0, 0, 255]), bitmapWidth: 4, bitmapHeight: 4 },
      { x: 5, y: 0, width: 3, height: 4 }, // mask
      { x: 8, y: 0, width: 2, height: 2, bitmap: solid(4, 4, [0, 255, 0, 255]), bitmapWidth: 4, bitmapHeight: 4 } // scaled down
    ],
    W,
    H
  )
  expect(out.length).toBe(W * H * 4)
  expect(px(out, W, 0, 0)).toEqual([255, 0, 0, 255])
  expect(px(out, W, 3, 3)).toEqual([255, 0, 0, 255])
  expect(px(out, W, 4, 0)).toEqual([0x80, 0x80, 0x80, 255]) // gap
  expect(px(out, W, 6, 2)).toEqual([0x80, 0x80, 0x80, 255]) // mask
  expect(px(out, W, 9, 1)).toEqual([0, 255, 0, 255])
  expect(px(out, W, 9, 3)).toEqual([0x80, 0x80, 0x80, 255])
})
