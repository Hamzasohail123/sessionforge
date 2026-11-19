// Fixed editor config paths (design §2.2). Pure apart from path. The renderer never sends a path.
import { isAbsolute, join, sep } from 'path'
import type { EditorId } from '../types'
export const CONFIG_HOME_ENV = 'SESSIONFORGE_EDITOR_CONFIG_HOME'
export const CONFIG_HOME_ERROR = `${CONFIG_HOME_ENV} must be an absolute path`
export const CODEX_HOME_ERROR = 'CODEX_HOME must be an absolute path'
export interface ConfigPaths {
  /** Home (or the injected config home) */
  root: string
  /** null when CODEX_HOME is relative: the Codex card is unreadable, with no fallback */
  codexHome: string | null
  /** Set when SESSIONFORGE_EDITOR_CONFIG_HOME is relative; the whole feature is disabled */
  error?: string
}
export function resolveConfigPaths(env: Record<string, string | undefined>, homedir: string): ConfigPaths {
  const override = env[CONFIG_HOME_ENV]
  if (override !== undefined && override !== '') {
    if (!isAbsolute(override)) return { root: '', codexHome: null, error: CONFIG_HOME_ERROR }
    // The injected root replaces everything, CODEX_HOME included, so tests never reach the real home
    return { root: override, codexHome: join(override, '.codex') }
  }
  const codex = env.CODEX_HOME
  if (codex !== undefined && codex !== '') {
    return { root: homedir, codexHome: isAbsolute(codex) ? codex : null }
  }
  return { root: homedir, codexHome: join(homedir, '.codex') }
}
/** Absolute path of an editor's permission file, or null (relative CODEX_HOME). */
export function editorFile(paths: ConfigPaths, editor: EditorId): string | null {
  if (paths.error) return null
  switch (editor) {
    case 'cursor':
      return join(paths.root, '.cursor', 'permissions.json')
    case 'claude':
      return join(paths.root, '.claude', 'settings.json')
    case 'codex':
      return paths.codexHome ? join(paths.codexHome, 'config.toml') : null
  }
}
/** Path shown in the UI: the real home becomes ~; an injected root is shown in full. */
export function displayPath(file: string, homedir: string): string {
  if (homedir && (file === homedir || file.startsWith(homedir + sep))) return '~' + file.slice(homedir.length)
  return file
}
/** Display path for an editor even when the file path is unavailable. */
export function editorDisplayPath(paths: ConfigPaths, editor: EditorId, homedir: string): string {
  const file = editorFile(paths, editor)
  if (file) return displayPath(file, homedir)
  return editor === 'codex' ? '$CODEX_HOME/config.toml' : editor === 'cursor' ? '~/.cursor/permissions.json' : '~/.claude/settings.json'
}
