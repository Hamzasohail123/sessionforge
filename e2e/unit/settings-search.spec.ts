import { test, expect } from '@playwright/test'
import { MCP_SERVER_SUBTABS, SETTINGS_SEARCH_ENTRIES, TOP_LEVEL_SETTINGS, filterSettings } from '../../src/renderer/src/components/settings/settings-search'

test('empty and whitespace-only queries return every real settings entry', () => {
  expect(filterSettings('')).toHaveLength(SETTINGS_SEARCH_ENTRIES.length)
  expect(filterSettings('  \t  ')).toHaveLength(SETTINGS_SEARCH_ENTRIES.length)
})

test('search matching ignores case and repeated whitespace', () => {
  expect(filterSettings('  mCp   sErVeR  ').map((entry) => entry.id)).toContain('agent')
  expect(filterSettings('app   VERSION').map((entry) => entry.id)).toContain('general')
})

test('search matches titles, subtitles, and multiple tokens', () => {
  expect(filterSettings('logged-in Chrome').map((entry) => entry.id)).toContain('import')
  expect(filterSettings('claude code connection').map((entry) => entry.id)).toEqual(['agent-editors'])
})

test('"tour" finds General, where the tour is replayed', () => {
  expect(filterSettings('tour').map((entry) => entry.id)).toContain('general')
})
test('update searches find General, where the update check lives', () => {
  for (const query of ['update', 'check for updates', 'new version', 'release']) {
    expect(filterSettings(query).map((entry) => entry.id), query).toContain('general')
  }
})
test('every top-level settings target is represented by searchable metadata', () => {
  for (const entry of Object.values(TOP_LEVEL_SETTINGS)) {
    expect(filterSettings(entry.label).map((result) => result.id), entry.label).toContain(entry.id)
  }
})

test('every MCP Server sub-tab target is represented by searchable metadata', () => {
  for (const entry of Object.values(MCP_SERVER_SUBTABS)) {
    expect(filterSettings(entry.label).map((result) => result.id), entry.label).toContain(entry.id)
  }
})

test('required discoverability keywords match real settings entries', () => {
  const keywords = [
    'MCP',
    'Agent Bridge',
    'Cursor',
    'Codex',
    'Claude Code',
    'token',
    'access',
    'permissions',
    'approval',
    'sessions',
    'Chrome Import',
    'cookies',
    'shortcuts',
    'privacy',
    'activity',
    'general',
    'updates'
  ]

  for (const keyword of keywords) expect(filterSettings(keyword).length, keyword).toBeGreaterThan(0)
})

test('multi-token search returns only declared settings targets', () => {
  const declaredTargets = new Set(SETTINGS_SEARCH_ENTRIES.map((entry) => `${entry.target.tab}:${entry.target.agentTab ?? ''}`))
  for (const result of filterSettings('MCP Cursor')) {
    expect(declaredTargets.has(`${result.target.tab}:${result.target.agentTab ?? ''}`)).toBe(true)
  }
})

test('unknown search text returns no results', () => {
  expect(filterSettings('not-a-real-settings-page')).toEqual([])
})
