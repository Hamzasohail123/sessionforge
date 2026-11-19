import { test, expect } from '@playwright/test'
import { toUrl } from '../../src/renderer/src/lib/url'

test.describe('toUrl', () => {
  test('domains get https', () => {
    expect(toUrl('example.com')).toBe('https://example.com')
  })

  test('local hosts get http', () => {
    expect(toUrl('127.0.0.1:3000/x')).toBe('http://127.0.0.1:3000/x')
    expect(toUrl('localhost:3000')).toBe('http://localhost:3000')
  })

  test('words become a Google search with %20', () => {
    expect(toUrl('sessionforge playwright')).toBe('https://www.google.com/search?q=sessionforge%20playwright')
  })

  test('full https URL passes through', () => {
    expect(toUrl('https://example.com/a?b=c')).toBe('https://example.com/a?b=c')
  })

  test('view-source of http(s) passes through unchanged (trimmed)', () => {
    expect(toUrl('view-source:https://example.com/')).toBe('view-source:https://example.com/')
    expect(toUrl('  view-source:http://127.0.0.1:3000/x ')).toBe('view-source:http://127.0.0.1:3000/x')
  })

  test('view-source of other schemes is a search', () => {
    expect(toUrl('view-source:ftp://x')).toBe(
      `https://www.google.com/search?q=${encodeURIComponent('view-source:ftp://x')}`
    )
  })
})
