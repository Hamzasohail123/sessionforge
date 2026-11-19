import { writeFileSync } from 'node:fs'
import { SNAPSHOT_FILE, takeSnapshot } from './home-guard'
export default async function globalSetup(): Promise<void> {
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(await takeSnapshot()))
}
