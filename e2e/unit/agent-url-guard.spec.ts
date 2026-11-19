import { test, expect } from '@playwright/test'
import { checkAgentUrl, isGuarded, isSelfTarget, parseGuard } from '../../src/main/agent/url-guard'

test('parseGuard: hostnames and wildcards; invalid patterns ignored', () => {
  expect(parseGuard(' Staging.Example.com ')).toEqual({ kind: 'host', host: 'staging.example.com' })
  expect(parseGuard('*.example.com')).toEqual({ kind: 'wildcard', domain: 'example.com' })
  for (const bad of ['https://x.com', 'x.com/path', 'x.com:80', '', '*.']) expect(parseGuard(bad), bad).toBeNull()
})

test('isGuarded: hostname vs wildcard, apex match, non-http URLs', () => {
  expect(isGuarded('https://staging.example.com/a', ['staging.example.com'])).toBe(true)
  expect(isGuarded('https://other.example.com/a', ['staging.example.com'])).toBe(false)
  expect(isGuarded('https://a.b.example.com/', ['*.example.com'])).toBe(true)
  expect(isGuarded('https://example.com/', ['*.example.com'])).toBe(true)
  expect(isGuarded('https://notexample.com/', ['*.example.com'])).toBe(false)
  expect(isGuarded('ftp://example.com/', ['example.com'])).toBe(false)
  expect(isGuarded('http://localhost:3000/', ['localhost', 'bad/pattern'])).toBe(true)
})

test('isSelfTarget', () => {
  const ports = { importPort: 34567, mcpPort: 34568 }
  for (const u of [
    'http://127.0.0.1:34567/import',
    'http://localhost:34568/mcp',
    'http://[::1]:34567/',
    'http://0.0.0.0:34568/',
    'http://127.1:34567/',
    'http://LOCALHOST:34568/',
    // Loopback aliases Chromium also resolves to this machine
    'http://localhost.:34567/import',
    'http://x.localhost:34567/import',
    'http://a.b.localhost.:34568/mcp',
    'http://127.5.6.7:34567/',
    'http://2130706433:34567/',
    'http://0x7f.1:34567/',
    'http://[::]:34567/',
    'http://[0:0:0:0:0:0:0:1]:34567/',
    'http://[::ffff:127.0.0.1]:34567/import',
    'http://[::ffff:7f00:1]:34568/',
    'http://[::ffff:7fff:ffff]:34567/',
    'http://[::ffff:0.0.0.0]:34567/'
  ])
    expect(isSelfTarget(u, ports), u).toBe(true)
  expect(isSelfTarget('http://127.0.0.1:3000/', ports)).toBe(false)
  expect(isSelfTarget('http://127.0.0.1/', ports)).toBe(false)
  expect(isSelfTarget('http://example.com:34567/', ports)).toBe(false)
  expect(isSelfTarget('http://localhost.example.com:34567/', ports)).toBe(false)
  expect(isSelfTarget('http://notlocalhost:34567/', ports)).toBe(false)
  expect(isSelfTarget('http://128.0.0.1:34567/', ports)).toBe(false)
  expect(isSelfTarget('http://[::ffff:8000:1]:34567/', ports)).toBe(false)
  expect(isSelfTarget('http://[::2]:34567/', ports)).toBe(false)
})

test('checkAgentUrl: self-target first, then guards', () => {
  const ports = { importPort: 1111, mcpPort: 2222 }
  const s = { name: 'Alice', urlGuards: ['localhost'] }
  const self = checkAgentUrl('http://localhost:1111/import', s, ports)
  expect(self.ok).toBe(false)
  if (!self.ok) expect(self.self).toBe(true)
  const g = checkAgentUrl('http://localhost:3000/', s, ports)
  expect(g.ok).toBe(false)
  if (!g.ok) expect(g.message).toContain("Session 'Alice' has a URL guard for localhost")
  expect(checkAgentUrl('http://127.0.0.1:3000/', s, ports).ok).toBe(true)
})
