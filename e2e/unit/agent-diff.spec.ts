import { test, expect } from '@playwright/test'
import { columnOut, summarize, type DiffColumn } from '../../src/main/agent/diff'

const URL = 'http://127.0.0.1:3000/api/admin'

test('same, status differs, body differs, JSON keys, redirect, error', () => {
  const cols: DiffColumn[] = [
    { name: 'Admin', status: 200, bytes: 20, bodyHash: 'a', bodyText: '{"user":"a","billing":1}', durationMs: 5 },
    { name: 'Admin2', status: 200, bytes: 20, bodyHash: 'a', bodyText: '{"user":"a","billing":1}', durationMs: 5 },
    { name: 'Customer', status: 403, bytes: 10, bodyHash: 'b', bodyText: '{"error":"no"}', durationMs: 3 },
    { name: 'No session', status: 302, location: 'http://127.0.0.1:3000/login', bytes: 0, bodyHash: 'c', durationMs: 1 },
    { name: 'Broken', error: 'timeout' }
  ]
  const s = summarize('GET', URL, cols).split('\n')
  expect(s[0]).toBe(`send_request_as GET ${URL}`)
  expect(s[1]).toBe('Admin: 200, 20 B, 5 ms')
  expect(s[2]).toContain('same as Admin')
  expect(s[3]).toContain('status differs from Admin (403 vs 200)')
  expect(s[3]).toContain('body differs (10 vs 20 bytes)')
  expect(s[3]).toContain('keys only in Admin: user, billing')
  expect(s[3]).toContain('keys only here: error')
  expect(s[4]).toContain('No session: 302 -> /login')
  expect(s[5]).toBe('Broken: error timeout')
})

test('columnOut: textual body cut, binary summarised', () => {
  const t = columnOut(
    { name: 'A', sessionId: 'x', status: 200, headers: { 'content-type': 'application/json' }, bodyText: '0123456789', bytes: 10 },
    4
  )
  expect(t).toMatchObject({ body: '0123', body_truncated: true, status: 200 })
  const b = columnOut({ name: 'A', sessionId: 'x', status: 200, headers: { 'content-type': 'image/png' }, bodyText: '', bytes: 99 }, 4)
  expect(b.body).toBe('[binary 99 bytes, image/png]')
})
