import { test, expect } from '@playwright/test'
import {
  inCookieScope,
  isGoogleOwnedHost,
  MAX_LAUNCH_URL,
  registrableDomain,
  toLaunchableUrl
} from '../../src/main/google-signin/domains'

test('registrableDomain', () => {
  const cases: Array<[string, string]> = [
    ['mail.google.com', 'google.com'],
    ['accounts.google.com', 'google.com'],
    ['www.youtube.com', 'youtube.com'],
    ['google.com', 'google.com'],
    ['bbc.co.uk', 'bbc.co.uk'],
    ['www.bbc.co.uk', 'bbc.co.uk'],
    ['x.google.com.au', 'google.com.au'],
    ['localhost', 'localhost'],
    ['app.localhost', 'app.localhost'],
    ['127.0.0.1', '127.0.0.1'],
    ['[::1]', '[::1]'],
    ['me.github.io', 'me.github.io'],
    ['a.me.github.io', 'me.github.io'],
    ['a.b.vercel.app', 'b.vercel.app'],
    ['proj.firebaseapp.com', 'proj.firebaseapp.com'],
    ['www.example.com.', 'example.com'],
    ['WWW.Example.COM', 'example.com'],
    // Errs narrow: fewer cookies, never more
    ['www.abc.de', 'www.abc.de']
  ]
  for (const [host, want] of cases) expect(registrableDomain(host), host).toBe(want)
})

test('isGoogleOwnedHost', () => {
  for (const h of ['mail.google.com', 'www.google.co.uk', 'google.de', 'www.google.com.au', 'www.youtube.com', 'x.blogger.com']) {
    expect(isGoogleOwnedHost(h), h).toBe(true)
  }
  for (const h of ['googleusercontent.evil.com', 'notgoogle.com', 'google.com.evil.com', 'evilgoogle.com', 'example.com']) {
    expect(isGoogleOwnedHost(h), h).toBe(false)
  }
})

test('inCookieScope', () => {
  expect(inCookieScope('.google.com', ['google.com'])).toBe(true)
  expect(inCookieScope('mail.google.com', ['google.com'])).toBe(true)
  expect(inCookieScope('google.com', ['google.com'])).toBe(true)
  expect(inCookieScope('.YouTube.com', ['google.com', 'youtube.com'])).toBe(true)
  expect(inCookieScope('evilgoogle.com', ['google.com'])).toBe(false)
  expect(inCookieScope('google.com.evil.com', ['google.com'])).toBe(false)
  expect(inCookieScope('localhost', ['localhost'])).toBe(true)
  expect(inCookieScope('evil.example', ['google.com', 'localhost'])).toBe(false)
})

test('toLaunchableUrl: https anywhere, http only on loopback', () => {
  for (const u of [
    'https://example.com/x',
    'http://localhost:3000/',
    'http://127.0.0.1:8080/',
    'http://app.localhost/',
    'http://[::1]:3000/'
  ]) {
    expect(toLaunchableUrl(u), u).toBe(new URL(u).href)
  }
  for (const u of [
    'http://192.168.1.10/',
    'http://10.0.0.5/',
    'http://app.test/',
    'http://printer.local/',
    'http://svc.internal/',
    'http://example.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'chrome://settings',
    'ftp://example.com/',
    'https://user:pw@example.com/',
    'https://user@example.com/',
    'https://example.com/' + 'a'.repeat(MAX_LAUNCH_URL - 'https://example.com/'.length + 1),
    'not a url'
  ]) {
    expect(toLaunchableUrl(u), u.slice(0, 60)).toBeNull()
  }
  const max = 'https://example.com/' + 'a'.repeat(MAX_LAUNCH_URL - 'https://example.com/'.length)
  expect(max.length).toBe(8192)
  expect(toLaunchableUrl(max)).toBe(max)
})
