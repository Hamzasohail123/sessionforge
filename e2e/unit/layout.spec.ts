import { test, expect } from '@playwright/test'
import {
  assignTab,
  defaultLayout,
  focusPane,
  normalizeLayout,
  paneCount,
  paneOfTab,
  pickMostRecent,
  placeTab,
  removeTab,
  setMode
} from '../../src/main/layout'
import type { Layout } from '../../src/main/types'

const grid = (tabs: Array<string | null>, active: Layout['activePaneId'] = 'pane-1'): Layout => ({
  windowId: 'main',
  mode: 'grid',
  panes: tabs.map((tabId, i) => ({ paneId: `pane-${i + 1}` as Layout['activePaneId'], tabId })),
  activePaneId: active
})

test.describe('layout', () => {
  test('pane counts and default', () => {
    expect([paneCount('single'), paneCount('columns'), paneCount('rows'), paneCount('grid')]).toEqual([1, 2, 2, 4])
    expect(defaultLayout()).toEqual({
      windowId: 'main',
      mode: 'single',
      panes: [{ paneId: 'pane-1', tabId: null }],
      activePaneId: 'pane-1'
    })
  })

  test('normalizeLayout: null, garbage and legacy split fall back to default', () => {
    const live = new Set(['a'])
    expect(normalizeLayout(null, live)).toEqual(defaultLayout())
    expect(normalizeLayout('garbage', live)).toEqual(defaultLayout())
    expect(normalizeLayout({ mode: 'grid', panes: null, activePaneId: 'pane-1' }, live)).toEqual(defaultLayout())
    expect(
      normalizeLayout({ mode: 'split', panes: [{ paneId: 'pane-1', tabId: 'a' }], activePaneId: 'pane-1' }, live)
    ).toEqual(defaultLayout())
  })

  test('normalizeLayout: unknown and duplicate tabs are cleared, panes padded, active clamped', () => {
    const out = normalizeLayout(
      {
        mode: 'grid',
        panes: [
          { paneId: 'pane-1', tabId: 'a' },
          { paneId: 'pane-2', tabId: 'a' },
          { paneId: 'pane-3', tabId: 'gone' }
        ],
        activePaneId: 'pane-4'
      },
      new Set(['a'])
    )
    expect(out.panes).toEqual([
      { paneId: 'pane-1', tabId: 'a' },
      { paneId: 'pane-2', tabId: null },
      { paneId: 'pane-3', tabId: null },
      { paneId: 'pane-4', tabId: null }
    ])
    expect(out.activePaneId).toBe('pane-4')

    const truncated = normalizeLayout(
      {
        mode: 'columns',
        panes: grid(['a', 'b', 'c', null]).panes,
        activePaneId: 'pane-3'
      },
      new Set(['a', 'b', 'c'])
    )
    expect(truncated.panes.map((p) => p.tabId)).toEqual(['a', 'b'])
    expect(truncated.activePaneId).toBe('pane-1')
  })

  test('setMode keeps the first panes, pads, clamps the active pane', () => {
    const g = grid(['a', 'b', 'c', 'd'], 'pane-3')
    const single = setMode(g, 'single')
    expect(single.panes).toEqual([{ paneId: 'pane-1', tabId: 'a' }])
    expect(single.activePaneId).toBe('pane-1')
    const back = setMode(single, 'grid')
    expect(back.panes.map((p) => p.tabId)).toEqual(['a', null, null, null])
    const cols = setMode(grid(['a', 'b', 'c', 'd'], 'pane-2'), 'rows')
    expect(cols.panes.map((p) => p.tabId)).toEqual(['a', 'b'])
    expect(cols.activePaneId).toBe('pane-2')
  })

  test('focusPane rejects panes outside the mode', () => {
    expect(focusPane(setMode(defaultLayout(), 'columns'), 'pane-2').activePaneId).toBe('pane-2')
    expect(() => focusPane(defaultLayout(), 'pane-2')).toThrow('Pane not in current layout')
  })

  test('assignTab moves a tab instead of showing it twice and focuses the target', () => {
    const g = grid(['a', 'b', null, null])
    const out = assignTab(g, 'pane-3', 'a')
    expect(out.panes.map((p) => p.tabId)).toEqual([null, 'b', 'a', null])
    expect(out.activePaneId).toBe('pane-3')
    expect(assignTab(g, 'pane-2', null).panes.map((p) => p.tabId)).toEqual(['a', null, null, null])
    expect(() => assignTab(defaultLayout(), 'pane-2', 'a')).toThrow('Pane not in current layout')
  })

  test('removeTab refills every pane showing the tab', () => {
    const out = removeTab(grid(['a', 'b', null, null]), 'a', (paneId) => (paneId === 'pane-1' ? 'z' : null))
    expect(out.panes.map((p) => p.tabId)).toEqual(['z', 'b', null, null])
    expect(removeTab(grid(['a', 'b', null, null]), 'b', () => null).panes.map((p) => p.tabId)).toEqual([
      'a',
      null,
      null,
      null
    ])
  })

  test('placeTab: empty pane, then grow single → columns → grid, then replace active', () => {
    let l = defaultLayout()
    l = placeTab(l, 't1')
    expect(l.mode).toBe('single')
    expect(l.panes.map((p) => p.tabId)).toEqual(['t1'])
    l = placeTab(l, 't2')
    expect(l.mode).toBe('columns')
    expect(l.panes.map((p) => p.tabId)).toEqual(['t1', 't2'])
    expect(l.activePaneId).toBe('pane-2')
    l = placeTab(l, 't3')
    expect(l.mode).toBe('grid')
    expect(l.panes.map((p) => p.tabId)).toEqual(['t1', 't2', 't3', null])
    l = placeTab(l, 't4')
    expect(l.panes.map((p) => p.tabId)).toEqual(['t1', 't2', 't3', 't4'])
    expect(l.activePaneId).toBe('pane-4')
    l = placeTab(focusPane(l, 'pane-2'), 't5')
    expect(l.panes.map((p) => p.tabId)).toEqual(['t1', 't5', 't3', 't4'])
    expect(l.activePaneId).toBe('pane-2')

    const rows = placeTab({ ...setMode(defaultLayout(), 'rows'), panes: [{ paneId: 'pane-1', tabId: 'x' }, { paneId: 'pane-2', tabId: 'y' }] }, 'z')
    expect(rows.mode).toBe('grid')
    expect(rows.panes.map((p) => p.tabId)).toEqual(['x', 'y', 'z', null])
  })

  test('paneOfTab', () => {
    expect(paneOfTab(grid(['a', 'b', null, null]), 'b')).toBe('pane-2')
    expect(paneOfTab(grid(['a', 'b', null, null]), 'q')).toBeNull()
  })

  test('pickMostRecent: highest lastActiveAt, ties broken by higher order, excludes ids', () => {
    const tabs = [
      { id: 'a', lastActiveAt: 10, order: 0 },
      { id: 'b', lastActiveAt: 20, order: 1 },
      { id: 'c', lastActiveAt: 20, order: 2 }
    ]
    expect(pickMostRecent(tabs)?.id).toBe('c')
    expect(pickMostRecent(tabs, new Set(['c']))?.id).toBe('b')
    expect(pickMostRecent(tabs, new Set(['a', 'b', 'c']))).toBeNull()
    expect(pickMostRecent([])).toBeNull()
  })
})
