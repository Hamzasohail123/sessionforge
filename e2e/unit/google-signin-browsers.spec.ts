import { test, expect } from '@playwright/test'
import { browserEnv, findBrowser, type Probe } from '../../src/main/google-signin/browsers'

const URL_ = 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmail.google.com%2F'
const probe = (executables: string[], existing: string[] = executables): Probe => ({
  exists: (p) => existing.includes(p),
  isExecutable: (p) => executables.includes(p)
})

test.describe('Linux', () => {
  test('Chrome before Chromium, in PATH order', () => {
    const env = { PATH: '/home/u/bin:/usr/local/bin:/usr/bin' }
    expect(findBrowser(URL_, 'linux', env, probe(['/usr/bin/chromium', '/usr/bin/google-chrome']))).toEqual({
      browser: 'Google Chrome',
      command: '/usr/bin/google-chrome',
      args: [URL_]
    })
    expect(
      findBrowser(URL_, 'linux', env, probe(['/usr/bin/google-chrome', '/usr/local/bin/google-chrome']))?.command
    ).toBe('/usr/local/bin/google-chrome')
    expect(findBrowser(URL_, 'linux', env, probe(['/usr/bin/google-chrome-stable']))?.browser).toBe('Google Chrome')
    expect(findBrowser(URL_, 'linux', env, probe(['/usr/bin/chromium-browser']))?.browser).toBe('Chromium')
  })

  test('skips non-executables and relative PATH entries; falls through to Edge and Brave', () => {
    expect(
      findBrowser(URL_, 'linux', { PATH: 'bin:/usr/bin' }, probe(['bin/google-chrome', '/usr/bin/microsoft-edge']))
    ).toEqual({ browser: 'Microsoft Edge', command: '/usr/bin/microsoft-edge', args: [URL_] })
    expect(
      findBrowser(URL_, 'linux', { PATH: '/usr/bin' }, probe(['/usr/bin/brave-browser'], ['/usr/bin/google-chrome']))
    ).toEqual({ browser: 'Brave', command: '/usr/bin/brave-browser', args: [URL_] })
    expect(findBrowser(URL_, 'linux', { PATH: '/usr/bin' }, probe(['/usr/bin/microsoft-edge-stable']))?.browser).toBe(
      'Microsoft Edge'
    )
    expect(findBrowser(URL_, 'linux', { PATH: '/usr/bin' }, probe(['/usr/bin/brave']))?.browser).toBe('Brave')
  })

  test('empty or missing PATH → null', () => {
    expect(findBrowser(URL_, 'linux', { PATH: '' }, probe(['/usr/bin/google-chrome']))).toBeNull()
    expect(findBrowser(URL_, 'linux', {}, probe(['/usr/bin/google-chrome']))).toBeNull()
  })
})

test.describe('macOS', () => {
  test('system bundle, then ~/Applications, then Chromium, Edge, Brave; open -a <bundle> <url>', () => {
    const env = { HOME: '/Users/me' }
    expect(findBrowser(URL_, 'darwin', env, probe([], ['/Applications/Google Chrome.app', '/Applications/Chromium.app']))).toEqual({
      browser: 'Google Chrome',
      command: '/usr/bin/open',
      args: ['-a', '/Applications/Google Chrome.app', URL_]
    })
    expect(findBrowser(URL_, 'darwin', env, probe([], ['/Users/me/Applications/Google Chrome.app']))?.args).toEqual([
      '-a',
      '/Users/me/Applications/Google Chrome.app',
      URL_
    ])
    expect(findBrowser(URL_, 'darwin', env, probe([], ['/Applications/Chromium.app']))?.browser).toBe('Chromium')
    expect(findBrowser(URL_, 'darwin', env, probe([], ['/Applications/Microsoft Edge.app']))?.browser).toBe('Microsoft Edge')
    expect(findBrowser(URL_, 'darwin', env, probe([], ['/Users/me/Applications/Brave Browser.app']))?.browser).toBe('Brave')
    expect(findBrowser(URL_, 'darwin', env, probe([], []))).toBeNull()
  })
})

test.describe('Windows', () => {
  test('ProgramFiles, ProgramFiles(x86), LOCALAPPDATA with case-insensitive keys and backslash paths', () => {
    const env = { PROGRAMFILES: 'C:\\Program Files', 'programfiles(x86)': 'C:\\Program Files (x86)', LocalAppData: 'C:\\Users\\me\\AppData\\Local' }
    expect(findBrowser(URL_, 'win32', env, probe([], ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']))).toEqual({
      browser: 'Google Chrome',
      command: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: [URL_]
    })
    expect(
      findBrowser(URL_, 'win32', env, probe([], ['C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']))?.command
    ).toBe('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe')
    expect(
      findBrowser(URL_, 'win32', env, probe([], ['C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe']))?.command
    ).toBe('C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    // Chrome anywhere beats Edge in ProgramFiles
    expect(
      findBrowser(
        URL_,
        'win32',
        env,
        probe([], [
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
        ])
      )?.browser
    ).toBe('Google Chrome')
    expect(
      findBrowser(URL_, 'win32', env, probe([], ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']))?.browser
    ).toBe('Microsoft Edge')
    expect(
      findBrowser(URL_, 'win32', env, probe([], ['C:\\Users\\me\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe']))
        ?.browser
    ).toBe('Brave')
    expect(findBrowser(URL_, 'win32', env, probe([], []))).toBeNull()
    expect(findBrowser(URL_, 'win32', {}, probe([], ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']))).toBeNull()
  })
})

test('unsupported platform → null; the URL is always exactly one argv element', () => {
  expect(findBrowser(URL_, 'freebsd', { PATH: '/usr/bin' }, probe(['/usr/bin/google-chrome']))).toBeNull()
  const tricky = 'https://example.com/a b?x=--disable-web-security&y=$(rm)'
  const plan = findBrowser(tricky, 'linux', { PATH: '/usr/bin' }, probe(['/usr/bin/google-chrome']))
  expect(plan?.args).toEqual([tricky])
})

test('browserEnv drops ELECTRON_* and, under APPIMAGE, LD_LIBRARY_PATH', () => {
  const env = { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', electron_x: 'y', LD_LIBRARY_PATH: '/tmp/.mount/usr/lib', HOME: '/h' }
  expect(browserEnv(env)).toEqual({ PATH: '/usr/bin', LD_LIBRARY_PATH: '/tmp/.mount/usr/lib', HOME: '/h' })
  expect(browserEnv({ ...env, APPIMAGE: '/x.AppImage' })).toEqual({ PATH: '/usr/bin', HOME: '/h', APPIMAGE: '/x.AppImage' })
})
