import { test, expect } from '@playwright/test'
import {
  MAX_CLOSED_SESSIONS,
  MAX_CLOSED_TABS,
  parseClosedTabs,
  pickReopen,
  planEviction,
  restoreIndex,
  type ClosedItem,
  type SessionState
} from '../../src/main/closed-stack'

const tab = (id: string, sessionId: string, url = 'https://example.com/'): ClosedItem => ({
  id,
  kind: 'tab',
  sessionId,
  url,
  title: 't',
  tabs: [],
  closedAt: 0
})
const sess = (id: string, sessionId: string): ClosedItem => ({
  id,
  kind: 'session',
  sessionId,
  url: null,
  title: null,
  tabs: [],
  closedAt: 0
})
const states =
  (m: Record<string, SessionState>) =>
  (sessionId: string): SessionState =>
    m[sessionId] ?? 'missing'

test('caps', () => {
  expect([MAX_CLOSED_TABS, MAX_CLOSED_SESSIONS]).toEqual([25, 10])
})

test('planEviction: 26 tab entries → the oldest is dropped', () => {
  const items = Array.from({ length: 26 }, (_, i) => tab(`t${i}`, 'open'))
  expect(planEviction(items)).toEqual({ dropIds: ['t25'], hardDeleteSessionIds: [] })
  expect(planEviction(items.slice(0, 25))).toEqual({ dropIds: [], hardDeleteSessionIds: [] })
})

test('planEviction: 11 session entries → the oldest session is deleted for good', () => {
  const items = Array.from({ length: 11 }, (_, i) => sess(`e${i}`, `s${i}`))
  expect(planEviction(items)).toEqual({ dropIds: [], hardDeleteSessionIds: ['s10'] })
})

test('planEviction: a closed session, then 30 closed tabs → only the 5 oldest tabs drop; the session is kept', () => {
  const items = [...Array.from({ length: 30 }, (_, i) => tab(`t${i}`, 'open')), sess('old', 'kept'), tab('t-old', 'open')]
  expect(planEviction(items)).toEqual({
    dropIds: ['t25', 't26', 't27', 't28', 't29', 't-old'],
    hardDeleteSessionIds: []
  })
})

test('planEviction: sessions don\'t count toward the tab cap, and tabs don\'t count toward the session cap', () => {
  // Interleaved, newest first: 10 sessions and 25 tabs, 35 entries in total
  const items = Array.from({ length: 35 }, (_, i) => (i % 7 < 2 ? sess(`e${i}`, `s${i}`) : tab(`t${i}`, 'open')))
  expect(items.filter((it) => it.kind === 'session')).toHaveLength(10)
  expect(planEviction(items)).toEqual({ dropIds: [], hardDeleteSessionIds: [] })
})

test('planEviction: the tabs of an 11th session go with its cascade and don\'t count toward the tab cap', () => {
  // 10 sessions, 25 open tabs, then the 11th session and 5 of its tabs: 30 tab entries in total
  const items = [
    ...Array.from({ length: 10 }, (_, i) => sess(`e${i}`, `s${i}`)),
    ...Array.from({ length: 25 }, (_, i) => tab(`t${i}`, 'open')),
    sess('e10', 's10'),
    ...Array.from({ length: 5 }, (_, i) => tab(`s10-${i}`, 's10'))
  ]
  expect(planEviction(items)).toEqual({ dropIds: [], hardDeleteSessionIds: ['s10'] })
})

test('pickReopen: a closed session wins; open or missing session entries are stale', () => {
  const items = [sess('e-open', 'a'), sess('e-missing', 'x'), sess('e-closed', 'c'), tab('t', 'a')]
  expect(pickReopen(items, states({ a: 'open', c: 'closed' }))).toEqual({
    item: items[2],
    staleIds: ['e-open', 'e-missing']
  })
})

test('pickReopen: a tab of a closed session is skipped and kept; a missing session\'s tab is stale', () => {
  const items = [tab('t-closed', 'c'), tab('t-missing', 'x'), tab('t-open', 'a')]
  expect(pickReopen(items, states({ a: 'open', c: 'closed' }))).toEqual({ item: items[2], staleIds: ['t-missing'] })
})

test('pickReopen: a non-openable URL is stale; an empty list gives null', () => {
  const items = [tab('bad', 'a', 'javascript:alert(1)'), tab('blank', 'a', 'about:blank'), tab('ok', 'a')]
  expect(pickReopen(items, states({ a: 'open' }))).toEqual({ item: items[2], staleIds: ['bad', 'blank'] })
  expect(pickReopen([], states({}))).toEqual({ item: null, staleIds: [] })
  expect(pickReopen([tab('only', 'c')], states({ c: 'closed' }))).toEqual({ item: null, staleIds: [] })
})

test('restoreIndex: highest lastActiveAt, ties go to the later tab, -1 when empty', () => {
  const t = (lastActiveAt: number) => ({ url: 'https://example.com/', title: '', lastActiveAt })
  expect(restoreIndex([])).toBe(-1)
  expect(restoreIndex([t(5)])).toBe(0)
  expect(restoreIndex([t(1), t(9), t(3)])).toBe(1)
  expect(restoreIndex([t(7), t(2), t(7)])).toBe(2)
})

test('parseClosedTabs: corrupt JSON, wrong shapes and a javascript: URL', () => {
  expect(parseClosedTabs(null)).toEqual([])
  expect(parseClosedTabs('{not json')).toEqual([])
  expect(parseClosedTabs('{"url":"https://example.com/"}')).toEqual([])
  const json = JSON.stringify([
    { url: 'https://example.com/a', title: 'A', lastActiveAt: 2 },
    { url: 'javascript:alert(1)', title: 'X', lastActiveAt: 3 },
    { url: 'https://example.com/b', lastActiveAt: 4 },
    { url: 'https://example.com/c', title: 'C', lastActiveAt: 'soon' }
  ])
  expect(parseClosedTabs(json)).toEqual([
    { url: 'https://example.com/a', title: 'A', lastActiveAt: 2 },
    { url: 'https://example.com/b', title: '', lastActiveAt: 4 }
  ])
})
