// Opens the hand-off URL in the user's browser. Under SESSIONFORGE_E2E=1 it never starts a browser:
// it appends the URL to SESSIONFORGE_TEST_BROWSER_LOG instead (and fails without a valid path).
import { shell } from 'electron'
import { spawn } from 'child_process'
import { accessSync, constants, existsSync, statSync } from 'fs'
import { appendFile } from 'fs/promises'
import { isAbsolute } from 'path'
import { launchWith, type LaunchDeps, type LaunchResult, type Probe } from './browsers'
import { toLaunchableUrl } from './domains'

const realProbe: Probe = {
  exists: (p) => existsSync(p),
  isExecutable: (p) => {
    try {
      accessSync(p, constants.X_OK)
      return statSync(p).isFile()
    } catch {
      return false
    }
  }
}

export async function openInBrowser(url: string): Promise<LaunchResult> {
  if (process.env.SESSIONFORGE_E2E === '1') {
    const log = process.env.SESSIONFORGE_TEST_BROWSER_LOG
    if (!log || !isAbsolute(log)) throw new Error('E2E run without a valid SESSIONFORGE_TEST_BROWSER_LOG')
    const safe = toLaunchableUrl(url)
    if (!safe) throw new Error('Refusing to open this URL')
    await appendFile(log, JSON.stringify({ url: safe, at: Date.now() }) + '\n')
    return { browser: 'Google Chrome', via: 'test-log' }
  }
  const deps: LaunchDeps = {
    platform: process.platform,
    env: process.env,
    probe: realProbe,
    spawn: (command, args, options) => spawn(command, args, options),
    openExternal: (u) => shell.openExternal(u)
  }
  return launchWith(url, deps)
}
