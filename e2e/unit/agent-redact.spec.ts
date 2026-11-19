import { test, expect } from '@playwright/test'
import { redactArgs, redactHeaders, redactJson, redactText, redactUrl } from '../../src/main/agent/redact'
import { NetworkLog } from '../../src/main/agent/network-log'
import { columnOut, summarize, toDiffColumn, type RawColumn } from '../../src/main/agent/diff'
import { buildActivityEntry } from '../../src/main/agent/activity-log'

const TOKEN = 'sfa_' + 'A'.repeat(43)

test('header rules', () => {
  const h = redactHeaders({
    Cookie: 'sid=abc-secret; theme=dark',
    'Set-Cookie': ['sid=abc-secret; Path=/; HttpOnly', 'seen=1; Max-Age=60'],
    Authorization: 'Bearer tok-secret',
    'Proxy-Authorization': 'weird-secret',
    'X-Api-Key': 'k-secret',
    'X-Auth-Token': 't-secret',
    Accept: 'text/html'
  })
  expect(h.cookie).toBe('sid=[redacted]; theme=[redacted]')
  expect(h['set-cookie']).toEqual(['sid=[redacted]; Path=/; HttpOnly', 'seen=[redacted]; Max-Age=60'])
  expect(h.authorization).toBe('Bearer [redacted]')
  expect(h['proxy-authorization']).toBe('[redacted]')
  expect(h['x-api-key']).toBe('[redacted]')
  expect(h['x-auth-token']).toBe('[redacted]')
  expect(h.accept).toBe('text/html')
})

test('URL query and userinfo', () => {
  const u = redactUrl('https://user:pw-secret@x.com/a?access_token=a-secret&code=c-secret&page=2')
  expect(u).not.toContain('pw-secret')
  expect(u).not.toContain('a-secret')
  expect(u).not.toContain('c-secret')
  expect(u).toContain('page=2')
  expect(redactUrl('https://x.com/a?q=1')).toBe('https://x.com/a?q=1')
})

test('nested JSON keys and the token pattern', () => {
  expect(redactJson({ a: 1, password: 'x', nested: { api_key: 'k', list: [{ token: 't' }] } })).toEqual({
    a: 1,
    password: '[redacted]',
    nested: { api_key: '[redacted]', list: [{ token: '[redacted]' }] }
  })
  expect(redactText(`leak ${TOKEN} here`)).not.toContain(TOKEN)
})

test('redactArgs', () => {
  const open = redactArgs('open', { session: 'A', url: 'http://h/app?access_token=a-secret&code=c-secret' })
  expect(open).not.toMatch(/a-secret|c-secret/)
  expect(redactArgs('wait_for', { url_contains: 'http://h/?token=t-secret' })).not.toContain('t-secret')
  expect(redactArgs('wait_for', { url_contains: 'token=t-secret' })).not.toContain('t-secret')
  const json = redactArgs('send_request_as', {
    url: 'http://h/',
    headers: { Authorization: 'Bearer req-secret' },
    body: '{"password":"pw-secret","nested":{"api_key":"k-secret"}}'
  })
  expect(json).not.toMatch(/pw-secret|k-secret|req-secret/)
  const form = redactArgs('send_request_as', {
    url: 'http://h/',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=pw-secret&x=1'
  })
  expect(form).not.toContain('pw-secret')
  expect(form).toContain('x=1')
  expect(redactArgs('send_request_as', { url: 'http://h/', body: 'opaque-secret-bytes' })).toContain('[body 19 bytes]')
  expect(redactArgs('type', { text: 'hunter2-secret' }, { isPassword: true })).not.toContain('hunter2')
  // Unknown (the call failed before the password check): masked too
  expect(redactArgs('type', { text: 'hunter2-secret' })).not.toContain('hunter2')
  expect(redactArgs('type', { text: 'plain-text' }, { isPassword: false })).toContain('plain-text')
  expect(redactArgs('type', { note: TOKEN })).not.toContain(TOKEN)
  expect(redactArgs('open', { url: 'http://h/' + 'x'.repeat(1000) }).length).toBeLessThanOrEqual(500)
})

test('no secret survives the network-log, send_request_as and activity result builders', () => {
  const secrets = ['alice-secret-cookie', 'page-secret', 'req-secret', 'tok-secret', 'pw-secret', TOKEN]
  const log = new NetworkLog()
  log.record('t1', {
    kind: 'send',
    id: 1,
    url: 'http://h/api?token=tok-secret',
    method: 'GET',
    resourceType: 'xhr',
    timestamp: 1,
    requestHeaders: { Cookie: 'sid=alice-secret-cookie', Authorization: 'Bearer page-secret' }
  })
  log.record('t1', {
    kind: 'completed',
    id: 1,
    url: 'http://h/api?token=tok-secret',
    method: 'GET',
    resourceType: 'xhr',
    timestamp: 5,
    statusCode: 200,
    fromCache: false,
    responseHeaders: { 'Set-Cookie': ['sid=alice-secret-cookie; Path=/'], 'X-Token': [TOKEN] }
  })
  const net = JSON.stringify(log.query('t1', { limit: 100, includeHeaders: true }))
  expect(net).toContain('"status":200')
  // url_contains matches the redacted URL, so guesses at a redacted value never match
  expect(log.query('t1', { limit: 100, includeHeaders: false, urlContains: 'token=tok' }).entries).toHaveLength(0)
  expect(log.query('t1', { limit: 100, includeHeaders: false, urlContains: 'token=%5Bredacted' }).entries).toHaveLength(1)

  const col: RawColumn = {
    name: 'Alice',
    sessionId: 'id',
    status: 302,
    location: 'http://h/login?token=tok-secret',
    headers: { 'set-cookie': ['sid=alice-secret-cookie'], authorization: 'Bearer req-secret' },
    bodyText: '',
    bodyHash: 'x',
    bytes: 0
  }
  const req = JSON.stringify(columnOut(col, 4000)) + summarize('GET', 'http://h/?token=tok-secret', [toDiffColumn(col)])

  const act = JSON.stringify(
    buildActivityEntry(1, 0, {
      client: TOKEN,
      tool: 'send_request_as',
      sessionId: null,
      sessionName: null,
      tabId: null,
      args: { url: 'http://h/?token=tok-secret', headers: { Authorization: 'Bearer req-secret' }, body: '{"password":"pw-secret"}' },
      outcome: 'ok',
      durationMs: 1
    })
  )
  for (const s of secrets) {
    expect(net, s).not.toContain(s)
    expect(req, s).not.toContain(s)
    expect(act, s).not.toContain(s)
  }
})
