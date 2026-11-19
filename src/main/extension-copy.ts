// Packaged builds copy the Chrome extension to a stable folder under userData: an AppImage mounts at a
// new /tmp/.mount_* path on every launch, so Chrome could not keep loading it from resources/.
import { cpSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
interface Manifest {
  version?: unknown
}
/** Copy when the destination has no manifest or a different version. Pure. */
export function needsExtensionCopy(srcManifest: Manifest, destManifest: Manifest | null): boolean {
  return destManifest === null || destManifest.version !== srcManifest.version
}
function readManifest(dir: string): Manifest | null {
  const file = join(dir, 'manifest.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Manifest
  } catch {
    return null
  }
}
/** Returns the folder to load unpacked, or an error code when the copy failed. */
export function prepareExtensionFolder(src: string, dest: string): { path: string | null; error?: string } {
  try {
    const srcManifest = readManifest(src)
    if (!srcManifest) return { path: null, error: 'ENOENT' }
    if (needsExtensionCopy(srcManifest, readManifest(dest))) cpSync(src, dest, { recursive: true, force: true })
    return { path: dest }
  } catch (e) {
    return { path: null, error: (e as NodeJS.ErrnoException).code ?? 'error' }
  }
}
