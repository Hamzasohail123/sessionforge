import type { Input } from 'electron'
import type { ShortcutAction } from './types'

export interface ShortcutMatch {
  action: ShortcutAction
  preventDefault: boolean
}

export type ShortcutInput = Pick<Input, 'type' | 'key' | 'code' | 'control' | 'meta' | 'alt' | 'shift'>

/**
 * The single owner of keyboard shortcuts for page views and the shell (design §8).
 * Each row matches only with exactly its modifiers; anything else returns null and reaches the page.
 */
export function matchShortcut(
  input: ShortcutInput,
  platform: NodeJS.Platform,
  source: 'page' | 'shell'
): ShortcutMatch | null {
  if (input.type !== 'keyDown') return null
  const mac = platform === 'darwin'
  const mod = mac ? input.meta : input.control
  const otherMod = mac ? input.control : input.meta
  const key = input.key.toLowerCase()
  const hit = (action: ShortcutAction, preventDefault = true): ShortcutMatch => ({ action, preventDefault })

  const modOnly = mod && !otherMod && !input.alt && !input.shift
  const modShift = mod && input.shift && !otherMod && !input.alt
  const none = !input.control && !input.meta && !input.alt && !input.shift

  if (modOnly) {
    switch (key) {
      case 'k':
        return hit('commandPalette')
      case 'r':
        return hit('reload')
      case 't':
        return hit('newTab')
      case 'w':
        return hit('closeTab')
      case 'l':
        return hit('focusAddressBar')
      case 'u':
        return hit('viewSource')
      case ',':
        return hit('openSettings')
    }
    if (input.code === 'Comma') return hit('openSettings')
    const digit = /^[1-4]$/.test(key) ? key : /^Digit[1-4]$/.test(input.code) ? input.code.slice(5) : null
    if (digit) return hit(`focusPane${digit}` as ShortcutAction)
  }

  if (modShift) {
    switch (key) {
      case 't':
        return hit('reopenClosed')
      case 'r':
        return hit('hardReload')
      case 'i':
        return hit('devtools')
      case 'j':
        return hit('devtoolsConsole')
      case 'c':
        return hit('devtoolsInspect')
    }
  }

  // Tab cycling uses Control on every OS, as in Chrome
  if (input.key === 'Tab' && input.control && !input.alt && !input.meta) {
    return hit(input.shift ? 'prevTab' : 'nextTab')
  }

  if (input.alt && !input.control && !input.meta && !input.shift) {
    if (input.key === 'ArrowLeft') return hit('back')
    if (input.key === 'ArrowRight') return hit('forward')
  }

  if (input.key === 'F5' && input.shift && !input.control && !input.meta && !input.alt) return hit('hardReload')

  if (none) {
    if (input.key === 'F5') return hit('reload')
    if (input.key === 'F12') return hit('devtools')
    // The shell lets Escape through so dialogs still close; the page wiring only uses it while loading
    if (input.key === 'Escape') return hit('stop', source === 'page')
  }

  return null
}

/** Shell zoom keys the toolkit used to block: mod+Minus (zoom out) and mod+Shift+Equal (zoom in). */
export function isShellZoomKey(input: ShortcutInput, platform: NodeJS.Platform): boolean {
  if (input.type !== 'keyDown') return false
  const mod = platform === 'darwin' ? input.meta : input.control
  if (!mod) return false
  return input.code === 'Minus' || (input.shift && input.code === 'Equal')
}
