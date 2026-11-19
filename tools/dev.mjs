#!/usr/bin/env node
// Cross-platform `npm run electron:dev`: runs `electron-vite dev` with the same arguments.
// On Linux it sets ELECTRON_DISABLE_SANDBOX=1, because the Chromium setuid sandbox helper in
// node_modules is not root-owned on most dev machines. macOS and Windows keep the sandbox.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pkgPath = require.resolve('electron-vite/package.json')
const bin = join(dirname(pkgPath), require(pkgPath).bin['electron-vite'])

const env = { ...process.env }
if (process.platform === 'linux') env.ELECTRON_DISABLE_SANDBOX = '1'

// Run the JS entry with this Node binary: no shell, and no .cmd shim on Windows
const child = spawn(process.execPath, [bin, 'dev', ...process.argv.slice(2)], { stdio: 'inherit', env })

const forward = (signal) => {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal)
}
process.on('SIGINT', () => forward('SIGINT'))
process.on('SIGTERM', () => forward('SIGTERM'))

child.on('error', (err) => {
  console.error('[dev] failed to start electron-vite:', err.message)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) {
    // Exit the way the child did, so the shell sees the same signal
    process.removeAllListeners(signal)
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
