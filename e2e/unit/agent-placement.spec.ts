import { test, expect } from '@playwright/test'
import { choosePane, planLayout, type PlaceState } from '../../src/main/agent/placement'
import { AgentError } from '../../src/main/agent/errors'

const st = (mode: PlaceState['mode'], panes: Array<[string | null, string | null]>, active = 'pane-1'): PlaceState => ({
  mode,
  activePaneId: active as PlaceState['activePaneId'],
  panes: panes.map(([tabId, sessionId], i) => ({ paneId: `pane-${i + 1}` as PlaceState['activePaneId'], tabId, sessionId }))
})
const can = (ids: string[]) => (id: string) => ids.includes(id)
const code = (fn: () => unknown) => {
  try {
    fn()
    return 'ok'
  } catch (e) {
    return (e as AgentError).code
  }
}

test('choosePane: requested pane', () => {
  const s = st('columns', [['t1', 'B'], [null, null]])
  expect(choosePane(s, 'A', can(['A']), 2)).toEqual({ paneId: 'pane-2' })
  expect(code(() => choosePane(s, 'A', can(['A']), 3))).toBe('pane_not_in_layout')
  expect(code(() => choosePane(s, 'A', can(['A']), 1))).toBe('permission_denied')
  expect(choosePane(s, 'A', can(['A', 'B']), 1)).toEqual({ paneId: 'pane-1' })
})

test('choosePane: same session, empty pane, grow, controllable, none', () => {
  expect(choosePane(st('columns', [['t1', 'B'], ['t2', 'A']]), 'A', can([])).paneId).toBe('pane-2')
  expect(choosePane(st('columns', [['t1', 'B'], [null, null]]), 'A', can([])).paneId).toBe('pane-2')
  expect(choosePane(st('single', [['t1', 'B']]), 'A', can([]))).toEqual({ paneId: 'pane-2', grow: 'columns' })
  expect(choosePane(st('rows', [['t1', 'B'], ['t2', 'C']]), 'A', can([]))).toEqual({ paneId: 'pane-3', grow: 'grid' })
  const full = st('grid', [['1', 'B'], ['2', 'C'], ['3', 'D'], ['4', 'E']], 'pane-2')
  expect(choosePane(full, 'A', can(['C', 'D'])).paneId).toBe('pane-3')
  expect(choosePane(full, 'A', can(['C'])).paneId).toBe('pane-2')
  expect(code(() => choosePane(full, 'A', can([])))).toBe('no_pane_available')
})

test('planLayout permission rules', () => {
  const s = st('columns', [['t1', 'B'], [null, null]])
  expect(planLayout(s, { mode: 'columns', panes: [{ pane: 2, session: 'A' }] }, can(['A'])).assignments).toEqual([
    { paneId: 'pane-2', sessionId: 'A' }
  ])
  expect(code(() => planLayout(s, { panes: [{ pane: 1, session: 'A' }] }, can(['A'])))).toBe('permission_denied')
  expect(code(() => planLayout(s, { panes: [{ pane: 2, session: 'A' }] }, can([])))).toBe('permission_denied')
  expect(code(() => planLayout(s, { panes: [{ pane: 3, session: 'A' }] }, can(['A'])))).toBe('pane_not_in_layout')
  expect(planLayout(s, { mode: 'grid', panes: [{ pane: 3, session: 'A' }] }, can(['A'])).mode).toBe('grid')
  // shrinking removes pane 2, which is empty → fine; removing a read-only occupant is not
  expect(code(() => planLayout(s, { mode: 'single' }, can([])))).toBe('ok')
  const s2 = st('columns', [[null, null], ['t1', 'B']])
  expect(code(() => planLayout(s2, { mode: 'single' }, can([])))).toBe('permission_denied')
  expect(planLayout(s2, { focus: 2 }, can([])).focus).toBe('pane-2')
  expect(code(() => planLayout(s2, { focus: 3 }, can([])))).toBe('pane_not_in_layout')
})
