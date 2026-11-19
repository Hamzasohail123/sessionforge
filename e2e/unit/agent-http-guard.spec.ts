import { test, expect } from '@playwright/test'
import { checkRequest, type GuardRequest } from '../../src/main/agent/http-guard'

const cfg = { port: 4000, tokenMatches: (t: string) => t === 'right' }
const ok: GuardRequest = {
  path: '/mcp',
  method: 'POST',
  host: '127.0.0.1:4000',
  origin: undefined,
  authorization: 'Bearer right',
  contentType: 'application/json'
}
const status = (r: Partial<GuardRequest>) => {
  const res = checkRequest({ ...ok, ...r }, cfg)
  return res.ok ? 200 : res.status
}

test('path', () => {
  expect(status({ path: '/mcp?x=1' })).toBe(200)
  expect(status({ path: '/other' })).toBe(404)
  expect(status({ path: '/mcp/' })).toBe(404)
})

test('Host', () => {
  expect(status({ host: 'LOCALHOST:4000' })).toBe(200)
  expect(status({ host: 'evil:4000' })).toBe(403)
  expect(status({ host: undefined })).toBe(403)
  expect(status({ host: '127.0.0.1:4001' })).toBe(403)
  expect(status({ host: '127.0.0.1' })).toBe(403)
})

test('Origin of any value is refused', () => {
  for (const o of ['http://x', 'null', '']) expect(status({ origin: o }), o).toBe(403)
})

test('methods', () => {
  expect(status({ method: 'GET' })).toBe(200)
  expect(status({ method: 'DELETE' })).toBe(200)
  const r = checkRequest({ ...ok, method: 'OPTIONS' }, cfg)
  expect(r.ok).toBe(false)
  if (!r.ok) {
    expect(r.status).toBe(405)
    expect(r.headers?.Allow).toBe('GET, POST, DELETE')
  }
  expect(status({ method: 'PUT' })).toBe(405)
})

test('bearer token', () => {
  const r = checkRequest({ ...ok, authorization: undefined }, cfg)
  expect(r.ok).toBe(false)
  if (!r.ok) {
    expect(r.status).toBe(401)
    expect(r.headers?.['WWW-Authenticate']).toContain('Bearer')
  }
  expect(status({ authorization: 'Bearer wrong' })).toBe(401)
  expect(status({ authorization: 'right' })).toBe(401)
  expect(status({ authorization: 'Basic right' })).toBe(401)
})

test('content type for POST only', () => {
  expect(status({ contentType: 'text/plain' })).toBe(415)
  expect(status({ contentType: undefined })).toBe(415)
  expect(status({ contentType: 'application/json; charset=utf-8' })).toBe(200)
  expect(status({ method: 'GET', contentType: undefined })).toBe(200)
})

test('order: host and origin are checked before auth', () => {
  expect(status({ host: 'evil:4000', authorization: undefined })).toBe(403)
  expect(status({ origin: 'http://x', authorization: undefined })).toBe(403)
})
