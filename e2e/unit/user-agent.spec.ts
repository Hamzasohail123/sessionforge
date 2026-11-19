import { test, expect } from '@playwright/test'
import { buildChromeUserAgent, getChromeUserAgent } from '../../src/main/user-agent'

const SHAPE =
  /^Mozilla\/5\.0 \(.+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/

test('linux', () => {
  expect(buildChromeUserAgent('134.0.6998.205', 'linux')).toBe(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
  )
})

test('windows', () => {
  expect(buildChromeUserAgent('134.0.6998.205', 'win32')).toBe(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
  )
})

test('macOS', () => {
  const ua = buildChromeUserAgent('120.1.2.3', 'darwin')
  expect(ua).toBe(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  )
  expect(ua).toMatch(SHAPE)
  expect(ua).not.toMatch(/Electron|sessionforge/i)
})

test('an invalid version throws', () => {
  expect(() => buildChromeUserAgent('abc', 'linux')).toThrow('Invalid Chrome version')
  expect(() => buildChromeUserAgent('', 'linux')).toThrow('Invalid Chrome version')
})

test('importing the module does not throw under plain Node; getChromeUserAgent does without a Chrome version', () => {
  // The import above already succeeded; Node has no process.versions.chrome
  expect(process.versions.chrome).toBeUndefined()
  expect(() => getChromeUserAgent()).toThrow('Invalid Chrome version')
})
