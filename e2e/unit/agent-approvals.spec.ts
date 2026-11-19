import { test, expect } from '@playwright/test'
import { mkdtemp, readdir, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import { READ, WRITE } from '../../src/main/agent/annotations'
import { presetText } from '../../src/main/agent/approvals/presets'
import { merge, SAFE_REASON, ADD_SERVER_REASON, CURSOR_KEY_REMOVED_NOTE } from '../../src/main/agent/approvals/merge'
import { detect, claudeRuleMatches } from '../../src/main/agent/approvals/detect'
import { redactConfigLine, redactConfigLines } from '../../src/main/agent/approvals/redact'
import { atomicWrite, backup, backupName, readConfig, sha256 } from '../../src/main/agent/approvals/files'
import { resolveConfigPaths, editorFile, CONFIG_HOME_ERROR } from '../../src/main/agent/approvals/paths'
import {
  applyApproval,
  getApprovals,
  previewApproval,
  writesToken,
  CHANGED_REASON,
  TOKEN_REASON,
  type ApprovalDeps
} from '../../src/main/agent/approvals'
import { comments } from '../../src/main/agent/approvals/jsonc-edit'
import { needsExtensionCopy } from '../../src/main/extension-copy'
import { APPROVAL_PRESETS, EDITOR_IDS, type ApprovalPreset, type EditorId } from '../../src/main/agent/types'
const RO = ['list_sessions', 'snapshot', 'wait_for', 'screenshot', 'console_logs', 'network_log', 'get_layout']
const TOKEN = 'sfa_' + 'Q'.repeat(43)
function ok(r: ReturnType<typeof merge>) {
  if (!r.ok) throw new Error('merge refused: ' + r.reason)
  return r
}
function refused(r: ReturnType<typeof merge>): string {
  if (r.ok) throw new Error('merge should refuse')
  return r.reason
}
// ---------------------------------------------------------------- presets and annotations
test('preset copy text for all nine editor/preset pairs', () => {
  const c = '~/.cursor/permissions.json'
  const l = '~/.claude/settings.json'
  const ro = (p: string) => RO.map((t, i) => `"${p}${t}"${i < RO.length - 1 ? ',' : ''}`).join('\n')
  expect(presetText('cursor', 'ask', RO, c)).toBe(`// In ${c}, remove every "mcpAllowlist" entry that starts with sessionforge:`)
  expect(presetText('cursor', 'readOnly', RO, c)).toBe(`// Add to "mcpAllowlist" in ${c}\n${ro('sessionforge:')}`)
  expect(presetText('cursor', 'all', RO, c)).toBe(`// Add to "mcpAllowlist" in ${c}\n"sessionforge:*"`)
  expect(presetText('claude', 'ask', RO, l)).toBe(
    `// In ${l}, remove every "permissions"."allow" entry that starts with mcp__sessionforge`
  )
  expect(presetText('claude', 'readOnly', RO, l)).toBe(`// Add to "permissions"."allow" in ${l}\n${ro('mcp__sessionforge__')}`)
  expect(presetText('claude', 'all', RO, l)).toBe(`// Add to "permissions"."allow" in ${l}\n"mcp__sessionforge__*"`)
  expect(presetText('codex', 'ask', RO, '')).toBe(
    '# Under your existing [mcp_servers.sessionforge] table\ndefault_tools_approval_mode = "prompt"'
  )
  expect(presetText('codex', 'readOnly', RO, '')).toBe(
    '# Remove default_tools_approval_mode from [mcp_servers.sessionforge] (Codex default: read-only tools run, others ask)'
  )
  expect(presetText('codex', 'all', RO, '')).toBe(
    '# Under your existing [mcp_servers.sessionforge] table\ndefault_tools_approval_mode = "approve"'
  )
  for (const e of EDITOR_IDS) {
    for (const p of APPROVAL_PRESETS) {
      const t = presetText(e, p, RO, '~/x')
      expect(t).not.toContain('sfa_')
      expect(t.split('\n').some((line) => /^\s*\[/.test(line))).toBe(false)
    }
  }
})
test('annotation constants: READ is read-only, WRITE keeps Codex auto prompting', () => {
  expect(READ.readOnlyHint).toBe(true)
  expect(WRITE.readOnlyHint).toBe(false)
  expect(WRITE.openWorldHint !== false || WRITE.destructiveHint !== false).toBe(true)
})
// ---------------------------------------------------------------- Cursor merge
const CURSOR_SEED = `// Cursor permissions
{
  /* MCP */
  "mcpAllowlist": [
    "figma:*", // design
    "notion:search",
    42,
    "noColon",
    "SessionForge:snapshot"
  ],
  "terminalAllowlist": ["ls"], // shell
  "autoRun": true
}
`
test('Cursor All keeps foreign entries, other keys and comments; replaces owned case-insensitively', () => {
  const r = ok(merge('cursor', CURSOR_SEED, 'all', RO))
  expect(r.changed).toBe(true)
  expect(r.requiresAck).toBe(false)
  expect(r.warnings.join(' ')).toContain('instead of the MCP allowlist')
  const v = parseJsonc(r.after)
  expect(v.mcpAllowlist).toEqual(['figma:*', 'notion:search', 42, 'noColon', 'sessionforge:*'])
  expect(v.terminalAllowlist).toEqual(['ls'])
  expect(v.autoRun).toBe(true)
  expect(comments(r.after)).toEqual(comments(CURSOR_SEED))
  // Idempotent
  const again = ok(merge('cursor', r.after, 'all', RO))
  expect(again.changed).toBe(false)
})
test('Cursor Read-only writes exactly the read-only tools', () => {
  const r = ok(merge('cursor', CURSOR_SEED, 'readOnly', RO))
  expect(parseJsonc(r.after).mcpAllowlist).toEqual(['figma:*', 'notion:search', 42, 'noColon', ...RO.map((t) => `sessionforge:${t}`)])
  expect(ok(merge('cursor', r.after, 'readOnly', RO)).changed).toBe(false)
  expect(detect('cursor', r.after, RO).state).toBe('readOnly')
})
test('Cursor Ask with mixed entries removes only owned ones; with only owned entries removes the key', () => {
  const mixed = ok(merge('cursor', CURSOR_SEED, 'ask', RO))
  expect(parseJsonc(mixed.after).mcpAllowlist).toEqual(['figma:*', 'notion:search', 42, 'noColon'])
  expect(mixed.notes).toEqual([])
  const onlyOwned = '{\n  "mcpAllowlist": ["sessionforge:*"],\n  "autoRun": true // keep\n}\n'
  const r = ok(merge('cursor', onlyOwned, 'ask', RO))
  expect(parseJsonc(r.after)).toEqual({ autoRun: true })
  expect(r.notes).toEqual([CURSOR_KEY_REMOVED_NOTE])
  expect(comments(r.after)).toEqual(['// keep'])
  expect(detect('cursor', r.after, RO).state).toBe('default')
  // An empty list with nothing owned is already Ask
  expect(ok(merge('cursor', '{"mcpAllowlist": []}', 'ask', RO)).changed).toBe(false)
})
test('Cursor missing file or missing key: created, with requiresAck', () => {
  const created = ok(merge('cursor', null, 'all', RO))
  expect(created.requiresAck).toBe(true)
  expect(JSON.parse(created.after)).toEqual({ mcpAllowlist: ['sessionforge:*'] })
  expect(ok(merge('cursor', null, 'ask', RO)).changed).toBe(false)
  const noKey = ok(merge('cursor', '{\n  "terminalAllowlist": ["ls"] // c\n}\n', 'readOnly', RO))
  expect(noKey.requiresAck).toBe(true)
  expect(parseJsonc(noKey.after).mcpAllowlist).toHaveLength(RO.length)
  expect(comments(noKey.after)).toEqual(['// c'])
  // Whitespace-only file is {}
  const blank = ok(merge('cursor', '  \n', 'all', RO))
  expect(blank.requiresAck).toBe(true)
  expect(JSON.parse(blank.after)).toEqual({ mcpAllowlist: ['sessionforge:*'] })
})
test('Cursor refuses unparseable text and the wrong shape', () => {
  expect(refused(merge('cursor', '{"mcpAllowlist": [', 'all', RO))).toContain("Can't parse")
  expect(refused(merge('cursor', '{"mcpAllowlist": "x"}', 'all', RO))).toContain('Unexpected shape at mcpAllowlist')
  expect(refused(merge('cursor', '[1]', 'all', RO))).toContain('Unexpected shape at root')
  expect(detect('cursor', '{"mcpAllowlist": {}}', RO)).toEqual({ state: 'unreadable', notes: ['Unexpected shape at mcpAllowlist'] })
})
test('Cursor BOM is kept and the file still parses', () => {
  const t = '\uFEFF{\n  "mcpAllowlist": ["figma:*"]\n}\n'
  const r = ok(merge('cursor', t, 'all', RO))
  expect(r.after.startsWith('\uFEFF')).toBe(true)
  expect(parseJsonc(r.after.slice(1)).mcpAllowlist).toEqual(['figma:*', 'sessionforge:*'])
})
test('Cursor one-line array: Ask on the last element (reviewer case)', () => {
  const r = ok(merge('cursor', '{"mcpAllowlist": ["figma:*", "sessionforge:*"]}', 'ask', RO))
  expect(r.after).toBe('{"mcpAllowlist": ["figma:*"]}')
})
test('Cursor detection: set rules and foreign globs', () => {
  const d = (list: unknown[]) => detect('cursor', JSON.stringify({ mcpAllowlist: list }), RO).state
  expect(detect('cursor', null, RO).state).toBe('default')
  expect(detect('cursor', '{}', RO).state).toBe('default')
  expect(d([])).toBe('ask')
  expect(d(['figma:*'])).toBe('ask')
  expect(d(['sessionforge:*'])).toBe('all')
  expect(d(['SessionForge:*', 'sessionforge:snapshot'])).toBe('all')
  expect(d(RO.map((t) => `sessionforge:${t}`))).toBe('readOnly')
  expect(d(RO.map((t) => `SESSIONFORGE:${t}`).concat('sessionforge:snapshot'))).toBe('readOnly')
  expect(d(['sessionforge:snapshot'])).toBe('custom')
  expect(d(['*:snapshot'])).toBe('custom')
  expect(d(['session*:click'])).toBe('custom')
  expect(detect('cursor', '{', RO).state).toBe('unreadable')
})
// ---------------------------------------------------------------- Claude merge
const CLAUDE_SEED = `{
  "model": "opus",
  "env": {"ANTHROPIC_API_KEY": "sk-x"},
  // rules
  "permissions": {
    "allow": ["Bash(ls)", "mcp__figma__get_file"],
    "ask": ["Bash(rm:*)"],
    "deny": []
  }
}
`
test('Claude All, Read-only and Ask keep foreign rules, env, ask/deny and comments', () => {
  const all = ok(merge('claude', CLAUDE_SEED, 'all', RO))
  const v = parseJsonc(all.after)
  expect(v.permissions).toEqual({ allow: ['Bash(ls)', 'mcp__figma__get_file', 'mcp__sessionforge__*'], ask: ['Bash(rm:*)'], deny: [] })
  expect(v.env).toEqual({ ANTHROPIC_API_KEY: 'sk-x' })
  expect(all.after).toContain('  "env": {"ANTHROPIC_API_KEY": "sk-x"},\n')
  expect(comments(all.after)).toEqual(['// rules'])
  expect(detect('claude', all.after, RO).state).toBe('all')
  expect(ok(merge('claude', all.after, 'all', RO)).changed).toBe(false)
  const ro = ok(merge('claude', all.after, 'readOnly', RO))
  expect(parseJsonc(ro.after).permissions.allow).toEqual(['Bash(ls)', 'mcp__figma__get_file', ...RO.map((t) => `mcp__sessionforge__${t}`)])
  expect(detect('claude', ro.after, RO).state).toBe('readOnly')
  const ask = ok(merge('claude', ro.after, 'ask', RO))
  expect(parseJsonc(ask.after).permissions.allow).toEqual(['Bash(ls)', 'mcp__figma__get_file'])
  expect(detect('claude', ask.after, RO).state).toBe('ask')
  expect(ok(merge('claude', ask.after, 'ask', RO)).changed).toBe(false)
})
test('Claude bare mcp__sessionforge counts as owned; missing permissions/allow are created', () => {
  const r = ok(merge('claude', '{"permissions": {"allow": ["mcp__sessionforge"]}}', 'readOnly', RO))
  expect(parseJsonc(r.after).permissions.allow).toEqual(RO.map((t) => `mcp__sessionforge__${t}`))
  const noPerms = ok(merge('claude', '{\n  "model": "opus"\n}\n', 'all', RO))
  expect(parseJsonc(noPerms.after)).toEqual({ model: 'opus', permissions: { allow: ['mcp__sessionforge__*'] } })
  const noAllow = ok(merge('claude', '{"permissions": {"deny": ["Bash(rm)"]}}', 'all', RO))
  expect(parseJsonc(noAllow.after).permissions).toEqual({ deny: ['Bash(rm)'], allow: ['mcp__sessionforge__*'] })
  expect(ok(merge('claude', null, 'all', RO)).requiresAck).toBe(false)
  expect(JSON.parse(ok(merge('claude', null, 'all', RO)).after)).toEqual({ permissions: { allow: ['mcp__sessionforge__*'] } })
  expect(ok(merge('claude', '{"model": "x"}', 'ask', RO)).changed).toBe(false)
})
test('Claude refuses unparseable text and wrong shapes', () => {
  expect(refused(merge('claude', '{"permissions": ', 'all', RO))).toContain("Can't parse")
  expect(refused(merge('claude', '{"permissions": []}', 'all', RO))).toContain('Unexpected shape at permissions')
  expect(refused(merge('claude', '{"permissions": {"allow": "x"}}', 'all', RO))).toContain('permissions.allow')
})
test('Claude ask/deny rules that cover SessionForge make the state Custom', () => {
  for (const rule of ['mcp__*', '*', 'mcp__sessionforge__click', 'mcp__sessionforge', 'mcp__sessionforge__snapshot(x)']) {
    expect(claudeRuleMatches(rule), rule).toBe(true)
  }
  for (const rule of ['Bash(*)', 'mcp__figma__*', 'Read']) expect(claudeRuleMatches(rule), rule).toBe(false)
  const text = JSON.stringify({ permissions: { allow: ['mcp__sessionforge__*'], deny: ['mcp__*'] } })
  const d = detect('claude', text, RO)
  expect(d.state).toBe('custom')
  expect(d.notes[0]).toBe('An ask/deny rule overrides this: mcp__*')
  expect(detect('claude', JSON.stringify({ permissions: { ask: ['*'] } }), RO).state).toBe('custom')
  expect(detect('claude', JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }), RO).notes).toContain(
    'bypassPermissions is on: Claude Code runs every tool'
  )
  expect(detect('claude', JSON.stringify({ permissions: { allow: ['mcp__sessionforge__click'] } }), RO).state).toBe('custom')
})
// ---------------------------------------------------------------- Codex merge
const CODEX_SEED = `# my codex config
model = "gpt-5"
[mcp_servers.sessionforge]
command = "node"
args = [
  "/opt/sf/sessionforge-mcp.mjs",
]
env = { SESSIONFORGE_TOKEN = "${TOKEN}" }
[mcp_servers.other]
url = "http://127.0.0.1:9/mcp"
http_headers = { Authorization = "Bearer ${TOKEN}" }
[projects."/home/me/x"]
trust_level = "trusted"
[plugins.foo]
enabled = true
`
test('Codex Ask and All insert directly after the header; Read-only removes the line', () => {
  const ask = ok(merge('codex', CODEX_SEED, 'ask', RO))
  expect(ask.after).toContain('[mcp_servers.sessionforge]\ndefault_tools_approval_mode = "prompt"\ncommand = "node"')
  expect(parseToml(ask.after)).toMatchObject({ mcp_servers: { sessionforge: { default_tools_approval_mode: 'prompt' } } })
  expect(ask.after).toContain('# my codex config')
  expect(detect('codex', ask.after, RO).state).toBe('ask')
  expect(ok(merge('codex', ask.after, 'ask', RO)).changed).toBe(false)
  const all = ok(merge('codex', ask.after, 'all', RO))
  expect(all.after).toContain('[mcp_servers.sessionforge]\ndefault_tools_approval_mode = "approve"\ncommand')
  expect(all.after.match(/default_tools_approval_mode/g)).toHaveLength(1)
  expect(detect('codex', all.after, RO).state).toBe('all')
  const ro = ok(merge('codex', all.after, 'readOnly', RO))
  expect(ro.after).toBe(CODEX_SEED)
  expect(detect('codex', ro.after, RO).state).toBe('readOnly')
  expect(ok(merge('codex', CODEX_SEED, 'readOnly', RO)).changed).toBe(false)
})
test('Codex keeps CRLF and replaces an existing value in place of the old line', () => {
  const t = '[mcp_servers.sessionforge]\r\nurl = "http://127.0.0.1:34568/mcp"\r\ndefault_tools_approval_mode = "auto"\r\n'
  const r = ok(merge('codex', t, 'all', RO))
  expect(r.after).toBe('[mcp_servers.sessionforge]\r\ndefault_tools_approval_mode = "approve"\r\nurl = "http://127.0.0.1:34568/mcp"\r\n')
  expect(ok(merge('codex', t, 'readOnly', RO)).after).toBe('[mcp_servers.sessionforge]\r\nurl = "http://127.0.0.1:34568/mcp"\r\n')
})
test('Codex refusals: missing server, inline table, per-tool approval_mode, parse error', () => {
  expect(refused(merge('codex', null, 'all', RO))).toBe(ADD_SERVER_REASON)
  expect(refused(merge('codex', '[projects.x]\ntrust_level = "trusted"\n', 'all', RO))).toBe(ADD_SERVER_REASON)
  expect(refused(merge('codex', 'mcp_servers = { sessionforge = { command = "node" } }\n', 'all', RO))).toContain('not a [mcp_servers.sessionforge] table')
  expect(refused(merge('codex', '[mcp_servers]\nsessionforge.command = "node"\n', 'all', RO))).toContain('not a [mcp_servers.sessionforge] table')
  const perTool = '[mcp_servers.sessionforge]\ncommand = "node"\n[mcp_servers.sessionforge.tools.click]\napproval_mode = "approve"\n'
  expect(refused(merge('codex', perTool, 'all', RO))).toContain('Per-tool approval_mode')
  expect(detect('codex', perTool, RO).state).toBe('custom')
  // A per-tool table without approval_mode has no effect on approvals
  const harmless = '[mcp_servers.sessionforge]\ncommand = "node"\n[mcp_servers.sessionforge.tools.click]\nenabled = true\n'
  expect(ok(merge('codex', harmless, 'all', RO)).changed).toBe(true)
  expect(refused(merge('codex', '[mcp_servers.sessionforge\n', 'all', RO))).toContain("Can't parse config.toml")
  // A commented value line is not edited
  expect(refused(merge('codex', '[mcp_servers.sessionforge]\ndefault_tools_approval_mode = "prompt" # why\n', 'all', RO))).toBe(SAFE_REASON)
})
test('Codex detection: every state and note', () => {
  const t = (body: string) => `[mcp_servers.sessionforge]\ncommand = "node"\n${body}`
  expect(detect('codex', null, RO).state).toBe('missing')
  expect(detect('codex', '[projects.x]\n', RO).state).toBe('missing')
  expect(detect('codex', t(''), RO)).toEqual({ state: 'readOnly', notes: ['Codex default: read-only tools run, others ask'] })
  expect(detect('codex', t('default_tools_approval_mode = "auto"\n'), RO).state).toBe('readOnly')
  expect(detect('codex', t('default_tools_approval_mode = "writes"\n'), RO)).toEqual({
    state: 'readOnly',
    notes: ['writes is set; Apply Read-only switches to the Codex default']
  })
  expect(detect('codex', t('default_tools_approval_mode = "prompt"\n'), RO).state).toBe('ask')
  expect(detect('codex', t('default_tools_approval_mode = "approve"\n'), RO).state).toBe('all')
  const bogus = t('default_tools_approval_mode = "bogus"\n')
  expect(detect('codex', bogus, RO).state).toBe('unreadable')
  expect(ok(merge('codex', bogus, 'all', RO)).changed).toBe(true)
  expect(detect('codex', 'approval_policy = "never"\n' + t(''), RO).notes).toContain(
    'approval_policy = never denies tools that need approval'
  )
  expect(detect('codex', '[x', RO).state).toBe('unreadable')
})
// ---------------------------------------------------------------- redaction and the token guard
test('redactConfigLine: tokens, secret keys, next-line values and URL credentials', () => {
  const r = (l: string, p = false) => redactConfigLine(l, 'sfa_live', p)
  expect(r(`env = { SESSIONFORGE_TOKEN = "${TOKEN}" }`).text).toBe('env = { SESSIONFORGE_TOKEN = "[redacted]" }')
  expect(r(`http_headers = { Authorization = "Bearer abc" }`).text).toBe('http_headers = { Authorization = "[redacted]" }')
  expect(r(`  "ANTHROPIC_API_KEY": "sk-x",`).text).toBe('  "ANTHROPIC_API_KEY": "[redacted]",')
  expect(r(`password = hunter2`).text).toBe('password = [redacted]')
  expect(r(`x = "sfa_live and ${'sfa_' + 'z'.repeat(20)}"`).text).toBe('x = "sfa_[redacted] and sfa_[redacted]"')
  const first = r('  "ANTHROPIC_API_KEY":')
  expect(first.pending).toBe(true)
  expect(r('    "sk-next"', true).text).toBe('    "[redacted]"')
  expect(r('url = "https://user:pass@host.example/?token=abc&x=1"').text).not.toMatch(/pass|abc/)
  expect(redactConfigLines('"k": 1\n"api_key":\n  "zzz"\n', '')).toEqual(['"k": 1', '"api_key":', '  "[redacted]"', ''])
})
// ---------------------------------------------------------------- files
test('backup names, collisions and the atomic write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sf-approvals-'))
  try {
    const file = join(dir, 'permissions.json')
    const now = new Date(2026, 10, 18, 9, 5, 7)
    expect(backupName(file, now)).toBe(`${file}.bak-20261118-090507`)
    await writeFile(file, 'one')
    expect(await backup(file, now)).toBe(`${file}.bak-20261118-090507`)
    expect(await backup(file, now)).toBe(`${file}.bak-20261118-090507-2`)
    await atomicWrite(file, 'two', 0o600)
    expect(await readFile(file, 'utf8')).toBe('two')
    // A failed rename leaves the original and no temp file
    await expect(
      atomicWrite(file, 'three', 0o600, { rename: async () => Promise.reject(Object.assign(new Error('x'), { code: 'EIO' })) })
    ).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('two')
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([])
    // Symlinks are refused
    await symlink(file, join(dir, 'link.json'))
    const r = await readConfig(join(dir, 'link.json'))
    expect(r.ok).toBe(false)
    expect((await readConfig(join(dir, 'missing.json'))).exists).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
test('paths: injected root, relative values, CODEX_HOME', () => {
  expect(resolveConfigPaths({ SESSIONFORGE_EDITOR_CONFIG_HOME: 'rel' }, '/home/u').error).toBe(CONFIG_HOME_ERROR)
  const inj = resolveConfigPaths({ SESSIONFORGE_EDITOR_CONFIG_HOME: '/tmp/x', CODEX_HOME: '/elsewhere' }, '/home/u')
  expect(editorFile(inj, 'codex')).toBe('/tmp/x/.codex/config.toml')
  expect(editorFile(inj, 'cursor')).toBe('/tmp/x/.cursor/permissions.json')
  expect(editorFile(inj, 'claude')).toBe('/tmp/x/.claude/settings.json')
  expect(editorFile(resolveConfigPaths({ CODEX_HOME: '/c' }, '/home/u'), 'codex')).toBe('/c/config.toml')
  expect(editorFile(resolveConfigPaths({ CODEX_HOME: 'c' }, '/home/u'), 'codex')).toBeNull()
  expect(editorFile(resolveConfigPaths({}, '/home/u'), 'codex')).toBe('/home/u/.codex/config.toml')
})
test('needsExtensionCopy', () => {
  expect(needsExtensionCopy({ version: '1.1.0' }, null)).toBe(true)
  expect(needsExtensionCopy({ version: '1.1.0' }, { version: '1.0.0' })).toBe(true)
  expect(needsExtensionCopy({ version: '1.1.0' }, { version: '1.1.0' })).toBe(false)
})
// ---------------------------------------------------------------- the whole flow in a temp home
test('preview and apply: hash check, backup, no token in previews, unchanged re-apply', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-approvals-home-'))
  try {
    const deps: ApprovalDeps = {
      paths: resolveConfigPaths({ SESSIONFORGE_EDITOR_CONFIG_HOME: root }, '/nonexistent-home'),
      homedir: '/nonexistent-home',
      readOnlyTools: RO,
      liveToken: 'sfa_' + 'L'.repeat(43),
      now: () => new Date(2026, 0, 2, 3, 4, 5)
    }
    await mkdir(join(root, '.codex'), { recursive: true })
    await writeFile(join(root, '.codex', 'config.toml'), CODEX_SEED)
    const info = await getApprovals(deps)
    expect(info.map((i) => [i.editor, i.state])).toEqual([
      ['cursor', 'default'],
      ['codex', 'readOnly'],
      ['claude', 'ask']
    ])
    const pv = await previewApproval(deps, { editor: 'codex', preset: 'all' })
    expect(pv.canApply).toBe(true)
    expect(JSON.stringify(pv)).not.toMatch(/sfa_(?!\[redacted\])/)
    expect(pv.diff.some((d) => d.kind === '+' && d.text.includes('"approve"'))).toBe(true)
    await expect(applyApproval(deps, { editor: 'codex', preset: 'all', expectedSha256: sha256('x') })).rejects.toThrow(CHANGED_REASON)
    const res = await applyApproval(deps, { editor: 'codex', preset: 'all', expectedSha256: pv.sha256 })
    expect(res).toMatchObject({ unchanged: false, state: 'all', backupPath: join(root, '.codex', 'config.toml.bak-20260102-030405') })
    expect(await readFile(join(root, '.codex', 'config.toml.bak-20260102-030405'), 'utf8')).toBe(CODEX_SEED)
    const pv2 = await previewApproval(deps, { editor: 'codex', preset: 'all' })
    const again = await applyApproval(deps, { editor: 'codex', preset: 'all', expectedSha256: pv2.sha256 })
    expect(again).toMatchObject({ unchanged: true, backupPath: null })
    // Cursor file is created, no backup
    const pc = await previewApproval(deps, { editor: 'cursor', preset: 'readOnly' })
    expect(pc.requiresAck).toBe(true)
    const rc = await applyApproval(deps, { editor: 'cursor', preset: 'readOnly', expectedSha256: pc.sha256 })
    expect(rc).toMatchObject({ unchanged: false, backupPath: null, state: 'readOnly' })
    // Token guard: a preset never adds a token line, so check the guard on a forged diff. Lines that
    // were already in the file (context, removed) do not trip it.
    expect(TOKEN_REASON).toContain('token')
    expect(writesToken([{ kind: '+', text: 'x = "sfa_abc"', line: 1 }], '')).toBe(true)
    expect(writesToken([{ kind: '+', text: 'live-tok', line: 1 }], 'live-tok')).toBe(true)
    expect(writesToken([{ kind: ' ', text: TOKEN, line: 1 }, { kind: '-', text: TOKEN, line: 2 }], '')).toBe(false)
    // Relative config home disables everything
    const bad = { ...deps, paths: resolveConfigPaths({ SESSIONFORGE_EDITOR_CONFIG_HOME: 'x' }, '/') }
    await expect(getApprovals(bad)).rejects.toThrow(CONFIG_HOME_ERROR)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('preview diff redacts a Claude env key next to the edit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-approvals-home-'))
  try {
    await mkdir(join(root, '.claude'))
    await writeFile(
      join(root, '.claude', 'settings.json'),
      '{\n  "env": {\n    "ANTHROPIC_API_KEY": "sk-secret"\n  },\n  "permissions": {\n    "allow": []\n  }\n}\n'
    )
    const deps: ApprovalDeps = {
      paths: resolveConfigPaths({ SESSIONFORGE_EDITOR_CONFIG_HOME: root }, '/x'),
      homedir: '/x',
      readOnlyTools: RO,
      liveToken: ''
    }
    const pv = await previewApproval(deps, { editor: 'claude', preset: 'all' })
    expect(pv.canApply).toBe(true)
    expect(JSON.stringify(pv)).not.toContain('sk-secret')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
// Every editor × preset applies cleanly from the seeds and the result detects as that preset
for (const editor of ['cursor', 'claude'] as EditorId[]) {
  for (const preset of APPROVAL_PRESETS as readonly ApprovalPreset[]) {
    test(`${editor} ${preset} from the seed detects as ${preset}`, () => {
      const seed = editor === 'cursor' ? CURSOR_SEED : CLAUDE_SEED
      const r = ok(merge(editor, seed, preset, RO))
      const want = preset === 'ask' ? 'ask' : preset
      expect(detect(editor, r.after, RO).state).toBe(want)
    })
  }
}
