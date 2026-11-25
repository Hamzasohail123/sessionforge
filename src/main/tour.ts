// First-run tour rules; pure so the unit project can import it (no Electron)

/** app_settings key; any stored value means the tour was seen (completed or skipped) */
export const TOUR_SETTING_KEY = 'onboardingTour.status'

export interface TourEnv {
  /** SESSIONFORGE_E2E === '1' */
  e2e: boolean
  /** SESSIONFORGE_TEST_TOUR; only '1' counts, and only under e2e */
  testTour: string | undefined
}

/**
 * Auto-start only for new users: nothing stored and no sessions yet (closed sessions count too).
 * Profiles that already have sessions replay it from Settings → General. Off in E2E unless flagged.
 */
export function shouldAutoStartTour(stored: string | null, sessionCount: number, env: TourEnv): boolean {
  return stored === null && sessionCount === 0 && (!env.e2e || env.testTour === '1')
}
