import { defineConfig } from '@playwright/test'

// Unit specs run in plain Node. E2E specs launch the built Electron app (one window at a time).
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 90_000,
  retries: 0,
  reporter: 'list',
  // Snapshot the real ~/.cursor, ~/.claude and ~/.codex files before the run and fail if they changed
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  projects: [
    { name: 'unit', testMatch: 'unit/**/*.spec.ts' },
    { name: 'e2e', testIgnore: 'unit/**' }
  ]
})
