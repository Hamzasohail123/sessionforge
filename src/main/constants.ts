// Shared by main and renderer; keep this file free of imports.

export const COLORS = [
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#10b981' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Red', value: '#ef4444' }
]

export const DEFAULT_URL = 'https://www.google.com'

/** Longest session name (create and rename) */
export const SESSION_NAME_MAX = 60

/** The SessionForge Import listing; opened by "Get the extension" in the Google sign-in banner */
export const CHROME_EXTENSION_STORE_URL =
  'https://chromewebstore.google.com/detail/sessionforge-import/ofdnckgaoffbablejmfimchoifdlhjbf'

/** The only URLs SessionForge opens in the system browser on the renderer's request. */
export const EXTERNAL_URL_ALLOWLIST: readonly string[] = [CHROME_EXTENSION_STORE_URL]
