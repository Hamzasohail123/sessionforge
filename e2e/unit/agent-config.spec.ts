import { test, expect } from '@playwright/test'
import { DEFAULT_MCP_PORT, resolveMcpPort } from '../../src/main/agent/config'

test('resolveMcpPort: valid values', () => {
  expect(resolveMcpPort(undefined)).toBe(DEFAULT_MCP_PORT)
  expect(resolveMcpPort('')).toBe(34568)
  expect(resolveMcpPort('34568')).toBe(34568)
  expect(resolveMcpPort('1024')).toBe(1024)
  expect(resolveMcpPort('65535')).toBe(65535)
})

test('resolveMcpPort: invalid values fall back to 34568', () => {
  for (const bad of ['1023', '65536', '0', '-1', '1e4', 'abc', ' 3000']) expect(resolveMcpPort(bad), bad).toBe(34568)
})
