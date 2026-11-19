import { test, expect } from '@playwright/test'
import { isShellZoomKey, matchShortcut, type ShortcutInput } from '../../src/main/shortcuts'
import type { ShortcutAction } from '../../src/main/types'
import { SHORTCUT_ROWS } from '../../src/main/shortcut-table'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type Mods = Partial<Pick<ShortcutInput, 'control' | 'meta' | 'alt' | 'shift'>>

const codeOf = (key: string) =>
  /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : key

function input(key: string, mods: Mods = {}, extra: Partial<ShortcutInput> = {}): ShortcutInput {
  return {
    type: 'keyDown',
    key,
    code: codeOf(key),
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...mods,
    ...extra
  }
}

const SOURCES = ['page', 'shell'] as const

/** Every §8 row as [key, modifiers, action], written with the platform's mod key. */
function rows(mod: 'control' | 'meta'): Array<[string, Mods, ShortcutAction]> {
  const m = { [mod]: true } as Mods
  const ms = { [mod]: true, shift: true } as Mods
  return [
    ['k', m, 'commandPalette'],
    ['r', m, 'reload'],
    ['F5', {}, 'reload'],
    ['R', ms, 'hardReload'],
    ['F5', { shift: true }, 'hardReload'],
    ['ArrowLeft', { alt: true }, 'back'],
    ['ArrowRight', { alt: true }, 'forward'],
    ['Escape', {}, 'stop'],
    ['F12', {}, 'devtools'],
    ['I', ms, 'devtools'],
    ['J', ms, 'devtoolsConsole'],
    ['C', ms, 'devtoolsInspect'],
    ['u', m, 'viewSource'],
    ['t', m, 'newTab'],
    ['w', m, 'closeTab'],
    ['T', ms, 'reopenClosed'],
    ['Tab', { control: true }, 'nextTab'],
    ['Tab', { control: true, shift: true }, 'prevTab'],
    ['1', m, 'focusPane1'],
    ['2', m, 'focusPane2'],
    ['3', m, 'focusPane3'],
    ['4', m, 'focusPane4'],
    ['l', m, 'focusAddressBar'],
    [',', m, 'openSettings']
  ]
}

for (const [platform, mod] of [
  ['linux', 'control'],
  ['darwin', 'meta']
] as const) {
  test.describe(`matchShortcut on ${platform}`, () => {
    for (const source of SOURCES) {
      for (const [key, mods, action] of rows(mod)) {
        const label = [...Object.keys(mods), key].join('+')
        test(`${source}: ${label} → ${action}`, () => {
          const preventDefault = !(action === 'stop' && source === 'shell')
          expect(matchShortcut(input(key, mods), platform, source)).toEqual({ action, preventDefault })
        })
      }
    }
  })
}

test.describe('matchShortcut details', () => {
  test('keyUp is ignored', () => {
    expect(matchShortcut(input('k', { control: true }, { type: 'keyUp' }), 'linux', 'page')).toBeNull()
    expect(matchShortcut(input('F12', {}, { type: 'keyUp' }), 'linux', 'shell')).toBeNull()
  })

  test('shell Escape does not prevent default; shell F12 does', () => {
    expect(matchShortcut(input('Escape'), 'linux', 'shell')).toEqual({ action: 'stop', preventDefault: false })
    expect(matchShortcut(input('F12'), 'linux', 'shell')).toEqual({ action: 'devtools', preventDefault: true })
    expect(matchShortcut(input('Escape'), 'linux', 'page')).toEqual({ action: 'stop', preventDefault: true })
  })

  test('positive cases from §10.5', () => {
    const p = (i: ShortcutInput, platform: NodeJS.Platform = 'linux') => matchShortcut(i, platform, 'page')?.action
    expect(p(input('Tab', { control: true, shift: true }))).toBe('prevTab')
    expect(p(input('R', { control: true, shift: true }))).toBe('hardReload')
    expect(p(input('F5', { shift: true }))).toBe('hardReload')
    expect(p(input('F12'))).toBe('devtools')
    expect(p(input('I', { control: true, shift: true }))).toBe('devtools')
    expect(p(input('J', { control: true, shift: true }))).toBe('devtoolsConsole')
    expect(p(input('C', { control: true, shift: true }))).toBe('devtoolsInspect')
    expect(p(input('u', { control: true }))).toBe('viewSource')
    expect(p(input('I', { meta: true, shift: true }), 'darwin')).toBe('devtools')
  })

  test('Ctrl+Tab uses Control on darwin too', () => {
    expect(matchShortcut(input('Tab', { control: true }), 'darwin', 'page')?.action).toBe('nextTab')
    expect(matchShortcut(input('Tab', { meta: true }), 'darwin', 'page')).toBeNull()
  })

  test('mod+digit matches by code when key differs (e.g. non-US layouts)', () => {
    expect(matchShortcut(input('&', { control: true }, { code: 'Digit1' }), 'linux', 'page')?.action).toBe('focusPane1')
    expect(matchShortcut(input('5', { control: true }), 'linux', 'page')).toBeNull()
  })

  const negatives: Array<[string, ShortcutInput, NodeJS.Platform]> = [
    ['Ctrl+Alt+Shift+T', input('T', { control: true, alt: true, shift: true }), 'linux'],
    ['Ctrl+Shift+T on darwin', input('T', { control: true, shift: true }), 'darwin'],
    ['Meta+Shift+T on linux', input('T', { meta: true, shift: true }), 'linux'],
    ['Ctrl+Shift+K', input('K', { control: true, shift: true }), 'linux'],
    ['Ctrl+Shift+W', input('W', { control: true, shift: true }), 'linux'],
    ['Ctrl+Alt+L', input('l', { control: true, alt: true }), 'linux'],
    ['AltGr-style control+alt with key l', input('l', { control: true, alt: true }, { code: 'KeyL' }), 'win32'],
    ['Ctrl+Meta+T on linux', input('t', { control: true, meta: true }), 'linux'],
    ['Meta+T on linux', input('t', { meta: true }), 'linux'],
    ['Ctrl+T on darwin', input('t', { control: true }), 'darwin'],
    ['Ctrl+F12', input('F12', { control: true }), 'linux'],
    ['Shift+Escape', input('Escape', { shift: true }), 'linux'],
    ['Alt+Shift+ArrowLeft', input('ArrowLeft', { alt: true, shift: true }), 'linux'],
    ['Ctrl+Alt+Tab', input('Tab', { control: true, alt: true }), 'linux'],
    ['Ctrl+Shift+U', input('U', { control: true, shift: true }), 'linux'],
    ['Ctrl+Alt+Shift+I', input('I', { control: true, alt: true, shift: true }), 'linux'],
    ['Ctrl+Shift+F5', input('F5', { control: true, shift: true }), 'linux']
  ]
  for (const [name, i, platform] of negatives) {
    test(`${name} → null (reaches the page)`, () => {
      for (const source of SOURCES) expect(matchShortcut(i, platform, source)).toBeNull()
    })
  }
})

test.describe('openSettings (Cmd/Ctrl+,)', () => {
  test('Ctrl+, on linux and Cmd+, on darwin; by code on other layouts', () => {
    for (const source of SOURCES) {
      expect(matchShortcut(input(',', { control: true }, { code: 'Comma' }), 'linux', source)).toEqual({
        action: 'openSettings',
        preventDefault: true
      })
      expect(matchShortcut(input(',', { meta: true }, { code: 'Comma' }), 'darwin', source)?.action).toBe('openSettings')
      expect(matchShortcut(input(';', { control: true }, { code: 'Comma' }), 'linux', source)?.action).toBe('openSettings')
    }
  })
  test('extra modifiers or the wrong mod reach the page', () => {
    expect(matchShortcut(input('<', { control: true, shift: true }, { code: 'Comma' }), 'linux', 'page')).toBeNull()
    expect(matchShortcut(input(',', { control: true, alt: true }, { code: 'Comma' }), 'linux', 'page')).toBeNull()
    expect(matchShortcut(input(',', { control: true }, { code: 'Comma' }), 'darwin', 'page')).toBeNull()
    expect(matchShortcut(input(',', {}, { code: 'Comma' }), 'linux', 'page')).toBeNull()
  })
})
test.describe('SHORTCUT_ROWS (Settings → Shortcuts)', () => {
  test('every probe matches its action', () => {
    for (const row of SHORTCUT_ROWS) {
      for (const { input: i, expected } of row.probe) {
        expect(matchShortcut(i, 'linux', 'page')?.action, row.keys).toBe(expected)
      }
    }
  })
  test('on darwin every Cmd/Ctrl row matches with Cmd, not Ctrl; Ctrl+Tab stays Control', () => {
    let cmdProbes = 0
    for (const row of SHORTCUT_ROWS) {
      for (const { input: i, expected } of row.probe) {
        for (const source of SOURCES) {
          const label = `${row.keys} (${source})`
          if (i.control && row.keys.includes('Cmd/Ctrl')) {
            cmdProbes++
            const cmd = { ...i, control: false, meta: true }
            expect(matchShortcut(cmd, 'darwin', source)?.action, label).toBe(expected)
            expect(matchShortcut(i, 'darwin', source), `${label} with Ctrl`).toBeNull()
          } else {
            // Ctrl+Tab and the keys without a modifier are the same on every OS
            expect(matchShortcut(i, 'darwin', source)?.action, label).toBe(expected)
          }
        }
      }
    }
    // Every Cmd/Ctrl probe was translated, including Cmd+Shift+T and Cmd+,
    expect(cmdProbes).toBe(SOURCES.length * SHORTCUT_ROWS.flatMap((r) => r.probe).filter((p) => p.input.control && p.input.key !== 'Tab').length)
    expect(matchShortcut(input('T', { meta: true, shift: true }, { code: 'KeyT' }), 'darwin', 'page')?.action).toBe('reopenClosed')
    expect(matchShortcut(input(',', { meta: true }, { code: 'Comma' }), 'darwin', 'shell')?.action).toBe('openSettings')
  })
  test('the README table has exactly these rows', () => {
    const readme = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8')
    const section = readme.split('## Keyboard Shortcuts')[1].split('\n## ')[0]
    const tableRows = section
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| Shortcut') && !l.startsWith('|---'))
      .map((l) => l.trim())
    expect(tableRows).toEqual(SHORTCUT_ROWS.map((r) => `| ${r.keys} | ${r.action} |`))
  })
})
test.describe('isShellZoomKey', () => {
  test('Ctrl+Minus and Ctrl+Shift+Equal on linux, Cmd on darwin', () => {
    expect(isShellZoomKey(input('-', { control: true }, { code: 'Minus' }), 'linux')).toBe(true)
    expect(isShellZoomKey(input('+', { control: true, shift: true }, { code: 'Equal' }), 'linux')).toBe(true)
    expect(isShellZoomKey(input('-', { meta: true }, { code: 'Minus' }), 'darwin')).toBe(true)
    expect(isShellZoomKey(input('+', { meta: true, shift: true }, { code: 'Equal' }), 'darwin')).toBe(true)
  })

  test('Ctrl+Equal and plain Minus are not blocked', () => {
    expect(isShellZoomKey(input('=', { control: true }, { code: 'Equal' }), 'linux')).toBe(false)
    expect(isShellZoomKey(input('-', {}, { code: 'Minus' }), 'linux')).toBe(false)
    expect(isShellZoomKey(input('-', { control: true }, { code: 'Minus', type: 'keyUp' }), 'linux')).toBe(false)
  })
})
