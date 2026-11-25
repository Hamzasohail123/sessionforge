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

/** SessionForge's GitHub releases page; release links must be this page or a path under it */
export const RELEASES_PAGE_URL = 'https://github.com/Hamzasohail123/sessionforge/releases'

/** GitHub API endpoint the update check asks for the newest release */
export const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/Hamzasohail123/sessionforge/releases/latest'

/**
 * The only exact URLs SessionForge opens in the system browser on the renderer's request.
 * Release pages (RELEASES_PAGE_URL and paths under it) are checked separately by isReleasePageUrl.
 */
export const EXTERNAL_URL_ALLOWLIST: readonly string[] = [CHROME_EXTENSION_STORE_URL]
