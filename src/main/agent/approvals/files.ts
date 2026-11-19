// Reading, backing up and atomically writing editor permission files (design §2.7). Node fs only.
import { createHash, randomBytes } from 'crypto'
import { constants as fsc, promises as fsp } from 'fs'
import { basename, dirname, join } from 'path'
export const MAX_BYTES = 1024 * 1024
export type ReadResult =
  | { ok: true; exists: false; text: null }
  | { ok: true; exists: true; text: string; mode: number }
  | { ok: false; exists: boolean; reason: string }
export function sha256(text: string | null): string {
  return createHash('sha256').update(text ?? '', 'utf8').digest('hex')
}
/** Missing → exists:false. Symlinks, non-regular files, files over 1 MiB and read errors are refused. */
export async function readConfig(file: string): Promise<ReadResult> {
  let st
  try {
    st = await fsp.lstat(file)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: true, exists: false, text: null }
    return { ok: false, exists: false, reason: `Can't read the file (${code ?? 'error'})` }
  }
  if (st.isSymbolicLink()) return { ok: false, exists: true, reason: 'The file is a symlink; copy the text instead' }
  if (!st.isFile()) return { ok: false, exists: true, reason: 'Not a regular file; copy the text instead' }
  if (st.size > MAX_BYTES) return { ok: false, exists: true, reason: 'The file is larger than 1 MiB; copy the text instead' }
  try {
    return { ok: true, exists: true, text: await fsp.readFile(file, 'utf8'), mode: st.mode & 0o777 }
  } catch (e) {
    return { ok: false, exists: true, reason: `Can't read the file (${(e as NodeJS.ErrnoException).code ?? 'error'})` }
  }
}
const pad = (n: number) => String(n).padStart(2, '0')
/** <file>.bak-YYYYMMDD-HHmmss in local time. */
export function backupName(file: string, now: Date): string {
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${file}.bak-${stamp}`
}
/** Copy file to a fresh backup name (-2, -3 … on collision, up to -99). Returns the backup path. */
export async function backup(file: string, now: Date): Promise<string> {
  const base = backupName(file, now)
  for (let i = 1; i <= 99; i++) {
    const dest = i === 1 ? base : `${base}-${i}`
    try {
      await fsp.copyFile(file, dest, fsc.COPYFILE_EXCL)
      const { mode } = await fsp.stat(file)
      await fsp.chmod(dest, mode & 0o777)
      return dest
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }
  throw Object.assign(new Error('Too many backups for this second'), { code: 'EEXIST' })
}
export interface WriteDeps {
  rename?: (from: string, to: string) => Promise<void>
}
/** Write through a temp file in the same folder, fsync, then rename over the target. */
export async function atomicWrite(file: string, text: string, mode: number | null, deps: WriteDeps = {}): Promise<void> {
  const dir = dirname(file)
  try {
    await fsp.access(dir)
  } catch {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
  }
  const tmp = join(dir, `${basename(file)}.sessionforge-${process.pid}-${randomBytes(4).toString('hex')}.tmp`)
  const rename = deps.rename ?? ((a: string, b: string) => fsp.rename(a, b))
  try {
    const fh = await fsp.open(tmp, 'wx', mode ?? 0o600)
    try {
      await fh.writeFile(text, 'utf8')
      await fh.sync()
    } finally {
      await fh.close()
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, file)
        break
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (process.platform === 'win32' && (code === 'EPERM' || code === 'EBUSY') && attempt < 3) {
          await new Promise((r) => setTimeout(r, 100))
          continue
        }
        throw e
      }
    }
  } catch (e) {
    await fsp.unlink(tmp).catch(() => undefined)
    throw e
  }
}
const chains = new Map<string, Promise<unknown>>()
/** Applies for one file run one at a time (design-verdict finding 13). */
export function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  chains.set(
    key,
    next.catch(() => undefined)
  )
  return next
}
