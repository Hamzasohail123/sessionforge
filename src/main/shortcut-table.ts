// The keyboard shortcut table shown in Settings → Shortcuts and in the README. Pure. A unit test checks
// every probe against matchShortcut and every row against the README table.
import type { ShortcutInput } from './shortcuts'
import type { ShortcutAction } from './types'
export interface ShortcutRow {
  /** README cell text, e.g. "`Cmd/Ctrl+R`, `F5`" */
  keys: string
  action: string
  /** Inputs (written for Linux: mod = Control) and the action each must match */
  probe: Array<{ input: ShortcutInput; expected: ShortcutAction }>
}
function key(k: string, mods: Partial<Pick<ShortcutInput, 'control' | 'meta' | 'alt' | 'shift'>> = {}, code?: string): ShortcutInput {
  return { type: 'keyDown', key: k, code: code ?? k, control: false, meta: false, alt: false, shift: false, ...mods }
}
const ctrl = { control: true }
const ctrlShift = { control: true, shift: true }
export const SHORTCUT_ROWS: ShortcutRow[] = [
  { keys: '`Cmd/Ctrl+K`', action: 'Command palette', probe: [{ input: key('k', ctrl, 'KeyK'), expected: 'commandPalette' }] },
  { keys: '`Cmd/Ctrl+,`', action: 'Open Settings', probe: [{ input: key(',', ctrl, 'Comma'), expected: 'openSettings' }] },
  { keys: '`Cmd/Ctrl+T`', action: 'New tab', probe: [{ input: key('t', ctrl, 'KeyT'), expected: 'newTab' }] },
  { keys: '`Cmd/Ctrl+W`', action: 'Close tab', probe: [{ input: key('w', ctrl, 'KeyW'), expected: 'closeTab' }] },
  { keys: '`Cmd/Ctrl+Shift+T`', action: 'Reopen closed tab or session', probe: [{ input: key('T', ctrlShift, 'KeyT'), expected: 'reopenClosed' }] },
  {
    keys: '`Ctrl+Tab` / `Ctrl+Shift+Tab`',
    action: 'Next / previous tab',
    probe: [
      { input: key('Tab', ctrl), expected: 'nextTab' },
      { input: key('Tab', ctrlShift), expected: 'prevTab' }
    ]
  },
  {
    keys: '`Cmd/Ctrl+1`–`4`',
    action: 'Focus pane 1–4',
    probe: [
      { input: key('1', ctrl, 'Digit1'), expected: 'focusPane1' },
      { input: key('4', ctrl, 'Digit4'), expected: 'focusPane4' }
    ]
  },
  { keys: '`Cmd/Ctrl+L`', action: 'Focus address bar', probe: [{ input: key('l', ctrl, 'KeyL'), expected: 'focusAddressBar' }] },
  {
    keys: '`Cmd/Ctrl+R`, `F5`',
    action: 'Reload',
    probe: [
      { input: key('r', ctrl, 'KeyR'), expected: 'reload' },
      { input: key('F5'), expected: 'reload' }
    ]
  },
  {
    keys: '`Cmd/Ctrl+Shift+R`, `Shift+F5`',
    action: 'Hard reload (ignore cache)',
    probe: [
      { input: key('R', ctrlShift, 'KeyR'), expected: 'hardReload' },
      { input: key('F5', { shift: true }), expected: 'hardReload' }
    ]
  },
  {
    keys: '`Alt+Left` / `Alt+Right`',
    action: 'Back / forward',
    probe: [
      { input: key('ArrowLeft', { alt: true }), expected: 'back' },
      { input: key('ArrowRight', { alt: true }), expected: 'forward' }
    ]
  },
  {
    keys: '`Escape`',
    action: 'Stop loading (while a page loads; otherwise the page gets it)',
    probe: [{ input: key('Escape'), expected: 'stop' }]
  },
  {
    keys: '`F12`, `Cmd/Ctrl+Shift+I`',
    action: 'Toggle DevTools',
    probe: [
      { input: key('F12'), expected: 'devtools' },
      { input: key('I', ctrlShift, 'KeyI'), expected: 'devtools' }
    ]
  },
  { keys: '`Cmd/Ctrl+Shift+J`', action: 'DevTools console', probe: [{ input: key('J', ctrlShift, 'KeyJ'), expected: 'devtoolsConsole' }] },
  { keys: '`Cmd/Ctrl+Shift+C`', action: 'Inspect element', probe: [{ input: key('C', ctrlShift, 'KeyC'), expected: 'devtoolsInspect' }] },
  { keys: '`Cmd/Ctrl+U`', action: 'View page source', probe: [{ input: key('u', ctrl, 'KeyU'), expected: 'viewSource' }] }
]
