// press: an allowlist of keys that contains no app shortcut and no clipboard key (design §10.4). Pure.
import { AgentError } from './errors'

export type PressModifier = 'Shift' | 'Control' | 'Meta'

export interface KeyEventPayload {
  type: 'keyDown' | 'char' | 'keyUp'
  keyCode: string
  modifiers: Array<'shift' | 'control' | 'meta'>
}

/** Agent-facing DOM key names → Electron key codes. */
const NAMED: Record<string, { keyCode: string; char?: string }> = {
  Enter: { keyCode: 'Enter', char: '\r' },
  Tab: { keyCode: 'Tab' },
  Escape: { keyCode: 'Escape' },
  Backspace: { keyCode: 'Backspace' },
  Delete: { keyCode: 'Delete' },
  ArrowUp: { keyCode: 'Up' },
  ArrowDown: { keyCode: 'Down' },
  ArrowLeft: { keyCode: 'Left' },
  ArrowRight: { keyCode: 'Right' },
  Home: { keyCode: 'Home' },
  End: { keyCode: 'End' },
  PageUp: { keyCode: 'PageUp' },
  PageDown: { keyCode: 'PageDown' },
  Space: { keyCode: 'Space', char: ' ' }
}

/** Control/Meta are allowed only for select all, undo, redo and submit. */
const MOD_KEYS = new Set(['a', 'z', 'y', 'Enter'])

function invalid(label: string, why: string): AgentError {
  return new AgentError(
    'invalid_key',
    `Key '${label}' is not allowed: ${why}.`,
    'Use Enter, Tab, Escape, Backspace, Delete, arrows, Home/End, PageUp/PageDown, Space, a single character, or Control/Meta with a, z, y or Enter.'
  )
}

export function parsePress(key: string, modifiers: PressModifier[] = []): { label: string; events: KeyEventPayload[] } {
  const mods = new Set(modifiers)
  const shift = mods.has('Shift')
  const ctrl = mods.has('Control')
  const meta = mods.has('Meta')
  const label = [...(ctrl ? ['Control'] : []), ...(meta ? ['Meta'] : []), ...(shift ? ['Shift'] : []), key].join('+')

  const named = NAMED[key]
  const points = [...key]
  let keyCode: string
  let char: string | undefined
  if (named) {
    keyCode = named.keyCode
    char = named.char
  } else if (points.length === 1 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(key)) {
    keyCode = key
    char = key
  } else {
    throw invalid(label, 'unknown key name')
  }

  if (ctrl && meta) throw invalid(label, 'use Control or Meta, not both')
  if (shift && key === 'Delete') throw invalid(label, 'Shift+Delete cuts to the clipboard')
  if (ctrl || meta) {
    const k = named ? key : key.toLowerCase()
    if (!MOD_KEYS.has(k)) throw invalid(label, 'Control/Meta only with a, z, y or Enter')
    if (shift && k !== 'z') throw invalid(label, 'Shift with Control/Meta only for z (redo)')
    keyCode = named ? keyCode : k
  }

  const electronMods: KeyEventPayload['modifiers'] = [
    ...(shift ? (['shift'] as const) : []),
    ...(ctrl ? (['control'] as const) : []),
    ...(meta ? (['meta'] as const) : [])
  ]
  const events: KeyEventPayload[] = [{ type: 'keyDown', keyCode, modifiers: electronMods }]
  if (char !== undefined && !ctrl && !meta) events.push({ type: 'char', keyCode: char, modifiers: electronMods })
  events.push({ type: 'keyUp', keyCode, modifiers: electronMods })
  return { label, events }
}
