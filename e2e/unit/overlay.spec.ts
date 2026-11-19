import { test, expect } from '@playwright/test'
import { toastCovers } from '../../src/renderer/src/lib/overlay'

test.describe('toastCovers', () => {
  const slots = [
    { top: 164, bottom: 500 },
    { top: 300, bottom: 600 }
  ]

  test('toast ending above the top slot does not cover', () => {
    expect(toastCovers({ top: 16, bottom: 120 }, slots)).toBe(false)
  })

  test('toast reaching below the top slot covers', () => {
    expect(toastCovers({ top: 16, bottom: 200 }, slots)).toBe(true)
  })

  test('no toast or no slots never covers', () => {
    expect(toastCovers(null, slots)).toBe(false)
    expect(toastCovers({ top: 16, bottom: 900 }, [])).toBe(false)
  })
})
