import { test, expect } from '@playwright/test'
import {
  CHROME_EXTENSION_STORE_URL,
  EXTERNAL_URL_ALLOWLIST,
  LATEST_RELEASE_API_URL,
  RELEASES_PAGE_URL
} from '../../src/main/constants'
import { isAllowedExternalUrl, isReleasePageUrl } from '../../src/main/external-url'
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
test('the release constants point at SessionForge on GitHub', () => {
  expect(RELEASES_PAGE_URL).toBe('https://github.com/Hamzasohail123/sessionforge/releases')
  expect(LATEST_RELEASE_API_URL).toBe('https://api.github.com/repos/Hamzasohail123/sessionforge/releases/latest')
})
test('the releases page and paths under it are allowed', () => {
  const accepted = [RELEASES_PAGE_URL, RELEASES_PAGE_URL + '/tag/v0.2.0', RELEASES_PAGE_URL + '/latest']
  for (const url of accepted) {
    expect(isReleasePageUrl(url), url).toBe(true)
    expect(isAllowedExternalUrl(url), url).toBe(true)
  }
})
test('release-page look-alikes are refused', () => {
  const refused = [
    RELEASES_PAGE_URL.replace('https://', 'http://'),
    RELEASES_PAGE_URL.replace('github.com', 'GITHUB.COM'),
    'https://github.com.evil.example/Hamzasohail123/sessionforge/releases',
    'https://x@github.com/Hamzasohail123/sessionforge/releases',
    'https://github.com:443/Hamzasohail123/sessionforge/releases',
    'https://github.com/someone-else/sessionforge/releases',
    'https://github.com/Hamzasohail123/sessionforge/releases-evil',
    'https://github.com/Hamzasohail123/sessionforge/releases/../../evil',
    RELEASES_PAGE_URL + '?q=1',
    RELEASES_PAGE_URL + '#x',
    RELEASES_PAGE_URL + ' ',
    ' ' + RELEASES_PAGE_URL,
    'https://github.com/Hamzasohail123/sessionforge',
    'not a url'
  ]
  for (const url of refused) {
    expect(isReleasePageUrl(url), url).toBe(false)
    expect(isAllowedExternalUrl(url), url).toBe(false)
  }
  for (const value of [undefined, null, 42, { toString: () => RELEASES_PAGE_URL }]) {
    expect(isReleasePageUrl(value)).toBe(false)
  }
})
