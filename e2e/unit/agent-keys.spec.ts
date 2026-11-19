import { test, expect } from '@playwright/test'
import { macEditCommand, parsePress, type PressModifier } from '../../src/main/agent/keys'
import { matchShortcut } from '../../src/main/shortcuts'
import { AgentError } from '../../src/main/agent/errors'

const refused = (key: string, mods: PressModifier[] = []) => {
  try {
    parsePress(key, mods)
    return false
  } catch (e) {
    return (e as AgentError).code === 'invalid_key'
  }
}

test('refuse list', () => {
  expect(refused('Delete', ['Shift'])).toBe(true)
  for (const k of ['c', 'v', 'x', 'w', 't', 'r', 'l', 'k', 'u', '1']) {
    expect(refused(k, ['Control']), `Control+${k}`).toBe(true)
    expect(refused(k, ['Meta']), `Meta+${k}`).toBe(true)
  }
  for (const k of ['F5', 'F12', 'Insert', 'AltGraph', 'ab', '\n']) expect(refused(k), k).toBe(true)
  expect(refused('ArrowLeft', ['Control', 'Meta'])).toBe(true)
  expect(refused('a', ['Control', 'Shift'])).toBe(true)
  expect(refused('t', ['Control', 'Shift'])).toBe(true) // Cmd/Ctrl+Shift+T reopens closed tabs and sessions
})

test('accepted keys and event sequences', () => {
  expect(parsePress('a', ['Shift']).events.map((e) => e.type)).toEqual(['keyDown', 'char', 'keyUp'])
  expect(parsePress('ArrowLeft', ['Shift']).events).toEqual([
    { type: 'keyDown', keyCode: 'Left', modifiers: ['shift'] },
    { type: 'keyUp', keyCode: 'Left', modifiers: ['shift'] }
  ])
  expect(parsePress('Enter').events[1]).toEqual({ type: 'char', keyCode: '\r', modifiers: [] })
  const sel = parsePress('a', ['Control'])
  expect(sel.label).toBe('Control+a')
  expect(sel.events.map((e) => e.type)).toEqual(['keyDown', 'keyUp'])
  expect(parsePress('z', ['Meta', 'Shift']).label).toBe('Meta+Shift+z')
  expect(parsePress('é').events[1].keyCode).toBe('é')
})

test('macOS edit commands: Cmd+A/Z/Shift+Z/Y only; Control and the other allowed keys send keys alone', () => {
  expect(macEditCommand('a', ['Meta'])).toBe('selectAll')
  expect(macEditCommand('A', ['Meta'])).toBe('selectAll')
  expect(macEditCommand('z', ['Meta'])).toBe('undo')
  expect(macEditCommand('z', ['Meta', 'Shift'])).toBe('redo')
  expect(macEditCommand('y', ['Meta'])).toBe('redo')
  for (const [k, mods] of [
    ['a', ['Control']],
    ['z', ['Control']],
    ['Enter', ['Meta']],
    ['a', []],
    ['a', ['Shift']],
    ['Backspace', ['Meta']]
  ] as Array<[string, PressModifier[]]>) {
    expect(macEditCommand(k, mods), `${mods.join('+')}+${k}`).toBeNull()
  }
})

test('no allowed combination is an app shortcut (except Escape → stop)', () => {
  const combos: Array<[string, PressModifier[]]> = []
  const named = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Space']
  for (const k of [...named, 'a', 'z', 'y', 'Z', '1', 'k', 'w', 't']) {
    for (const mods of [[], ['Shift'], ['Control'], ['Meta'], ['Control', 'Shift'], ['Meta', 'Shift']] as PressModifier[][]) {
      if (!refused(k, mods)) combos.push([k, mods])
    }
  }
  expect(combos.length).toBeGreaterThan(30)
  const DOM_KEY: Record<string, string> = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Space: ' ' }
  for (const [k, mods] of combos) {
    const down = parsePress(k, mods).events[0]
    const input = {
      type: 'keyDown' as const,
      key: DOM_KEY[down.keyCode] ?? down.keyCode,
      code: '',
      control: down.modifiers.includes('control'),
      meta: down.modifiers.includes('meta'),
      alt: false,
      shift: down.modifiers.includes('shift')
    }
    for (const platform of ['linux', 'darwin', 'win32'] as NodeJS.Platform[]) {
      const m = matchShortcut(input, platform, 'page')
      if (k === 'Escape' && mods.length === 0) expect(m?.action ?? null).toBe('stop')
      else expect(m, `${mods.join('+')}+${k} on ${platform}`).toBeNull()
    }
  }
})
