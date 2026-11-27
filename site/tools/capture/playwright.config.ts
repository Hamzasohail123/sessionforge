import { defineConfig } from '@playwright/test'
// Website captures only (never part of CI: the root config's testDir is e2e/).
// Run: npm run electron:build && npm run rebuild:native && npx playwright test -c site/tools/capture/playwright.config.ts
export default defineConfig({
  testDir: '.',
  testMatch: 'capture.spec.ts',
  workers: 1,
  timeout: 600_000,
  retries: 0,
  reporter: 'list',
  // Fails the run if the real ~/.cursor, ~/.claude or ~/.codex files change
  globalSetup: '../../../e2e/global-setup.ts',
  globalTeardown: '../../../e2e/global-teardown.ts'
})
