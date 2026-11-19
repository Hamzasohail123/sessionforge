import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { compareSnapshots, SNAPSHOT_FILE, takeSnapshot, type HomeSnapshot } from './home-guard'
export default async function globalTeardown(): Promise<void> {
  if (!existsSync(SNAPSHOT_FILE)) throw new Error('Home guard snapshot is missing')
  const before = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as HomeSnapshot
  unlinkSync(SNAPSHOT_FILE)
  const diff = compareSnapshots(before, await takeSnapshot())
  if (diff.length) throw new Error(`The test run touched the real home:\n${diff.join('\n')}`)
  console.log('[home-guard] real editor config files unchanged')
}
