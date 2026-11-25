import { test, expect } from '@playwright/test'
import { CHROME_EXTENSION_STORE_URL, EXTERNAL_URL_ALLOWLIST } from '../../src/main/constants'
import { isAllowedExternalUrl } from '../../src/main/external-url'
test('the allowlist is exactly the SessionForge Import store page', () => {
  expect(CHROME_EXTENSION_STORE_URL).toBe(
    'https://chromewebstore.google.com/detail/sessionforge-import/ofdnckgaoffbablejmfimchoifdlhjbf'
  )
  expect(EXTERNAL_URL_ALLOWLIST).toEqual([CHROME_EXTENSION_STORE_URL])
  expect(isAllowedExternalUrl(CHROME_EXTENSION_STORE_URL)).toBe(true)
})
test('variants of the store URL are refused (no normalisation)', () => {
  const refused = [
    CHROME_EXTENSION_STORE_URL + '/',
    CHROME_EXTENSION_STORE_URL + '?hl=en',
    CHROME_EXTENSION_STORE_URL + '#x',
    CHROME_EXTENSION_STORE_URL.replace('https://', 'http://'),
    CHROME_EXTENSION_STORE_URL.replace('chromewebstore.google.com', 'CHROMEWEBSTORE.GOOGLE.COM'),
    'https://chromewebstore.google.com/detail/sessionforge-import/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'javascript:alert(1)',
    'https://evil.example',
    ''
  ]
  for (const url of refused) expect(isAllowedExternalUrl(url), url).toBe(false)
})
test('non-strings are refused', () => {
  for (const value of [undefined, null, 42, { toString: () => CHROME_EXTENSION_STORE_URL }, [CHROME_EXTENSION_STORE_URL]]) {
    expect(isAllowedExternalUrl(value)).toBe(false)
  }
})
