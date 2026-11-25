import { test, expect } from '@playwright/test'
import { TOUR_SETTING_KEY, shouldAutoStartTour } from '../../src/main/tour'
const PROD = { e2e: false, testTour: undefined }
const E2E = (testTour: string | undefined) => ({ e2e: true, testTour })
test('the stored key is onboardingTour.status', () => {
  expect(TOUR_SETTING_KEY).toBe('onboardingTour.status')
})
test('a new profile (nothing stored, no sessions) auto-starts in production', () => {
  expect(shouldAutoStartTour(null, 0, PROD)).toBe(true)
})
test('a profile with sessions never auto-starts', () => {
  expect(shouldAutoStartTour(null, 1, PROD)).toBe(false)
  expect(shouldAutoStartTour(null, 5, PROD)).toBe(false)
  expect(shouldAutoStartTour(null, 3, E2E('1'))).toBe(false)
})
test('any stored value suppresses auto-start', () => {
  for (const stored of ['completed', 'skipped', 'garbage']) {
    expect(shouldAutoStartTour(stored, 0, PROD), stored).toBe(false)
  }
  expect(shouldAutoStartTour('skipped', 0, E2E('1'))).toBe(false)
})
test('under E2E only SESSIONFORGE_TEST_TOUR=1 enables auto-start', () => {
  expect(shouldAutoStartTour(null, 0, E2E(undefined))).toBe(false)
  expect(shouldAutoStartTour(null, 0, E2E('1'))).toBe(true)
  expect(shouldAutoStartTour(null, 0, E2E('true'))).toBe(false)
})
