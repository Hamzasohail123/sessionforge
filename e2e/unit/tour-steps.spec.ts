import { test, expect } from '@playwright/test'
import { TOUR_STEPS } from '../../src/renderer/src/components/tour/tour-steps'
import { SETTINGS_TABS } from '../../src/renderer/src/store'
test('the tour is the welcome card followed by the eight steps in order', () => {
  expect(TOUR_STEPS.map((s) => s.id)).toEqual([
    'welcome',
    'split-view',
    'settings',
    'general',
    'sessions',
    'mcp',
    'mcp-connect',
    'shortcuts',
    'about'
  ])
})
test('every Settings tab except Chrome Import is visited (MCP Server twice)', () => {
  const tabs = TOUR_STEPS.flatMap((s) => (s.view.kind === 'settings' ? [s.view.tab] : []))
  for (const tab of SETTINGS_TABS) {
    const count = tabs.filter((t) => t === tab).length
    if (tab === 'import') expect(count, tab).toBe(0)
    else expect(count, tab).toBe(tab === 'agent' ? 2 : 1)
  }
})
test('no step mentions the extension or Chrome Import', () => {
  for (const s of TOUR_STEPS) {
    expect(s.title, s.id).not.toMatch(/extension|chrome import|web store/i)
    expect(s.body, s.id).not.toMatch(/extension|chrome import|web store/i)
  }
})
test('every numbered step has an anchor; the welcome card has none', () => {
  for (const s of TOUR_STEPS) {
    if (s.id === 'welcome') expect(s.anchor).toBeNull()
    else expect(s.anchor?.length, s.id).toBeGreaterThan(0)
  }
})
test('sidebar anchors place the card to the right, the rest below', () => {
  for (const s of TOUR_STEPS) {
    expect(s.placement, s.id).toBe(s.anchor?.startsWith('settings-nav-') ? 'right' : 'bottom')
  }
})
test('every body is short (200 characters or fewer)', () => {
  for (const s of TOUR_STEPS) expect(s.body.length, s.id).toBeLessThanOrEqual(200)
})
