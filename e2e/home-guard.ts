// Real-home guard (design §5, design-verdict finding 2). The suite must never write the user's editor
// files: setup snapshots what SessionForge could write, teardown compares. The real home comes from
// os.userInfo(), which ignores HOME, so a test that changes HOME cannot hide a write.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
export const SNAPSHOT_FILE = join(tmpdir(), 'sessionforge-home-guard.json')
const HASHED = ['.cursor/permissions.json', '.claude/settings.json', '.codex/config.toml']
const MCP_SERVERS = ['.claude.json', '.cursor/mcp.json']
const DIRS = ['.cursor', '.claude', '.codex']
const OURS = /\.(bak-\d{8}-\d{6}(-\d+)?|sessionforge-\d+-[0-9a-f]{8}\.tmp)$/
export interface HomeSnapshot {
  home: string
  files: Record<string, { exists: boolean; size?: number; sha256?: string }>
  /** JSON of mcpServers, or null when the file is missing or mid-write */
  mcpServers: Record<string, string | null>
  ours: Record<string, string[]>
}
export function realHome(): string {
  const home = userInfo().homedir
  if (home.startsWith(tmpdir())) throw new Error(`Real home ${home} is under ${tmpdir()}; refusing to run`)
  return home
}
async function mcpServersOf(file: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!existsSync(file)) return null
    try {
      return JSON.stringify((JSON.parse(readFileSync(file, 'utf8')) as { mcpServers?: unknown }).mcpServers ?? null)
    } catch {
      await new Promise((r) => setTimeout(r, 200)) // the editor may be writing it
    }
  }
  return null
}
export async function takeSnapshot(): Promise<HomeSnapshot> {
  const home = realHome()
  const files: HomeSnapshot['files'] = {}
  for (const rel of HASHED) {
    const p = join(home, rel)
    if (!existsSync(p)) {
      files[rel] = { exists: false }
      continue
    }
    const buf = readFileSync(p)
    files[rel] = { exists: true, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') }
  }
  const mcpServers: HomeSnapshot['mcpServers'] = {}
  for (const rel of MCP_SERVERS) mcpServers[rel] = await mcpServersOf(join(home, rel))
  const ours: HomeSnapshot['ours'] = {}
  for (const d of DIRS) {
    const p = join(home, d)
    ours[d] = existsSync(p) ? readdirSync(p).filter((n) => OURS.test(n)).sort() : []
  }
  return { home, files, mcpServers, ours }
}
/** Differences between two snapshots (empty when the real home is untouched). */
export function compareSnapshots(a: HomeSnapshot, b: HomeSnapshot): string[] {
  const out: string[] = []
  for (const rel of HASHED) {
    if (JSON.stringify(a.files[rel]) !== JSON.stringify(b.files[rel])) out.push(`~/${rel} changed`)
  }
  for (const rel of MCP_SERVERS) {
    const x = a.mcpServers[rel]
    const y = b.mcpServers[rel]
    if (x !== null && y !== null && x !== y) out.push(`mcpServers in ~/${rel} changed`)
  }
  for (const d of DIRS) {
    const added = (b.ours[d] ?? []).filter((n) => !(a.ours[d] ?? []).includes(n))
    if (added.length) out.push(`new files in ~/${d}: ${added.join(', ')}`)
  }
  return out
}
