import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseJsonc } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import { launchApp, teardown, type AppCtx } from './fixtures/app'
import { bridgeToken, closeSettings, openSettings } from './fixtures/mcp'
import type { ApprovalPreset, EditorId } from '../src/main/agent/types'
// Editor approval presets through the real UI and IPC, against a temp SESSIONFORGE_EDITOR_CONFIG_HOME.
// The real ~/.cursor, ~/.claude and ~/.codex are checked by the global home guard.
test.describe.configure({ mode: 'serial' })
let ctx: AppCtx
const SEEDED_TOKEN = 'sfa_' + 'S'.repeat(43)
const RO = ['list_sessions', 'snapshot', 'wait_for', 'screenshot', 'console_logs', 'network_log', 'get_layout']
const CURSOR = `// my Cursor permissions
{
  "mcpAllowlist": [
    "figma:*", // design files
    "notion:search"
  ],
  /* shell */
  "terminalAllowlist": ["ls", "git status"]
}
`
const CLAUDE = `{
  "model": "opus",
  "env": {
    "ANTHROPIC_API_KEY": "sk-seeded-secret"
  },
  "permissions": {
    "allow": ["Bash(npm test)", "mcp__figma__get_file"]
  }
}
`
const CODEX = `# my codex config
model = "gpt-5"
[mcp_servers.sessionforge]
url = "http://127.0.0.1:34568/mcp"
http_headers = { Authorization = "Bearer ${SEEDED_TOKEN}" }
[mcp_servers.figma]
command = "npx"
args = ["-y", "figma-mcp"]
[projects."/home/me/app"]
trust_level = "trusted"
`
const file = (editor: EditorId) =>
  join(
    ctx.editorHome,
    editor === 'cursor' ? '.cursor/permissions.json' : editor === 'claude' ? '.claude/settings.json' : '.codex/config.toml'
  )
const read = (editor: EditorId) => readFileSync(file(editor), 'utf8')
const backups = (editor: EditorId) => {
  const f = file(editor)
  const dir = join(f, '..')
  return readdirSync(dir).filter((n) => n.startsWith(f.split('/').pop()! + '.bak-'))
}
const LABEL: Record<ApprovalPreset, string> = {
  ask: 'Asks every time',
  readOnly: 'Auto-runs read-only tools',
  all: 'Auto-runs all SessionForge tools'
}
function seed(): void {
  for (const [e, text] of [
    ['cursor', CURSOR],
    ['claude', CLAUDE],
    ['codex', CODEX]
  ] as const) {
    mkdirSync(join(file(e), '..'), { recursive: true })
    writeFileSync(file(e), text)
  }
}
test.beforeAll(async () => {
  ctx = await launchApp()
  seed()
})
test.afterAll(async () => {
  await teardown(ctx)
})
async function applyPreset(editor: EditorId, preset: ApprovalPreset): Promise<void> {
  await ctx.page.click(`[data-testid="agent-editor-${editor}"]`)
  await ctx.page.click(`[data-testid="approval-preset-${editor}-${preset}"]`)
  await expect(ctx.page.locator(`[data-testid="approval-preset-${editor}-${preset}"]`)).toHaveAttribute('aria-checked', 'true')
  await ctx.page.click(`[data-testid="approval-apply-${editor}"]`)
  const confirm = ctx.page.locator('[data-testid="approval-confirm"]')
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(ctx.page.locator('[data-testid="approval-dialog"]')).toHaveCount(0)
  await expect(ctx.page.locator(`[data-testid="approval-state-${editor}"]`)).toHaveText(LABEL[preset])
}
test('initial detected state per editor', async () => {
  await openSettings(ctx, 'editors')
  await expect(ctx.page.locator('[data-testid="approval-state-cursor"]')).toHaveText('Asks every time')
  await ctx.page.click('[data-testid="agent-editor-codex"]')
  await expect(ctx.page.locator('[data-testid="approval-state-codex"]')).toHaveText('Auto-runs read-only tools')
  await ctx.page.click('[data-testid="agent-editor-claude"]')
  await expect(ctx.page.locator('[data-testid="approval-state-claude"]')).toHaveText('Asks every time')
  // Copy text and the file path are shown per preset
  await ctx.page.click('[data-testid="approval-preset-claude-all"]')
  await expect(ctx.page.locator('[data-testid="approval-text-claude"]')).toContainText('"mcp__sessionforge__*"')
  await expect(ctx.page.locator('[data-testid="approval-apply-claude"]')).toHaveText(`Apply to ${file('claude')}`)
  await closeSettings(ctx)
})
test('Cursor: each preset writes the expected entries, keeps comments and foreign entries, backs up', async () => {
  await openSettings(ctx, 'editors')
  await applyPreset('cursor', 'all')
  expect(backups('cursor')).toHaveLength(1)
  let v = parseJsonc(read('cursor'))
  expect(v.mcpAllowlist).toEqual(['figma:*', 'notion:search', 'sessionforge:*'])
  expect(v.terminalAllowlist).toEqual(['ls', 'git status'])
  for (const c of ['// my Cursor permissions', '// design files', '/* shell */']) expect(read('cursor')).toContain(c)
  await applyPreset('cursor', 'readOnly')
  v = parseJsonc(read('cursor'))
  expect(v.mcpAllowlist).toEqual(['figma:*', 'notion:search', ...RO.map((t) => `sessionforge:${t}`)])
  await applyPreset('cursor', 'ask')
  expect(parseJsonc(read('cursor')).mcpAllowlist).toEqual(['figma:*', 'notion:search'])
  expect(read('cursor')).toContain('// design files')
  expect(backups('cursor').length).toBeGreaterThanOrEqual(1)
  await closeSettings(ctx)
})
test('Codex: Ask, All and Read-only edit only default_tools_approval_mode', async () => {
  await openSettings(ctx, 'editors')
  await applyPreset('codex', 'all')
  expect(backups('codex')).toHaveLength(1)
  expect(read('codex')).toContain('[mcp_servers.sessionforge]\ndefault_tools_approval_mode = "approve"\n')
  await applyPreset('codex', 'ask')
  const t = parseToml(read('codex')) as any
  expect(t.mcp_servers.sessionforge.default_tools_approval_mode).toBe('prompt')
  expect(t.mcp_servers.figma).toEqual({ command: 'npx', args: ['-y', 'figma-mcp'] })
  expect(t.projects['/home/me/app'].trust_level).toBe('trusted')
  await applyPreset('codex', 'readOnly')
  expect(read('codex')).toBe(CODEX)
  await closeSettings(ctx)
})
test('Claude Code: presets edit permissions.allow only; env and foreign rules stay', async () => {
  await openSettings(ctx, 'editors')
  await applyPreset('claude', 'all')
  expect(backups('claude')).toHaveLength(1)
  let v = parseJsonc(read('claude'))
  expect(v.permissions.allow).toEqual(['Bash(npm test)', 'mcp__figma__get_file', 'mcp__sessionforge__*'])
  expect(v.env).toEqual({ ANTHROPIC_API_KEY: 'sk-seeded-secret' })
  await applyPreset('claude', 'readOnly')
  v = parseJsonc(read('claude'))
  expect(v.permissions.allow).toEqual(['Bash(npm test)', 'mcp__figma__get_file', ...RO.map((t) => `mcp__sessionforge__${t}`)])
  await applyPreset('claude', 'ask')
  expect(parseJsonc(read('claude')).permissions.allow).toEqual(['Bash(npm test)', 'mcp__figma__get_file'])
  await closeSettings(ctx)
})
test('Cursor without a permissions file: the acknowledgement gates Confirm, and no backup is made', async () => {
  rmSync(file('cursor'))
  for (const b of backups('cursor')) rmSync(join(file('cursor'), '..', b))
  await openSettings(ctx, 'editors')
  await expect(ctx.page.locator('[data-testid="approval-state-cursor"]')).toHaveText('Editor default')
  await ctx.page.click('[data-testid="approval-preset-cursor-all"]')
  await ctx.page.click('[data-testid="approval-apply-cursor"]')
  const ack = ctx.page.locator('[data-testid="approval-ack"]')
  await expect(ack).toBeVisible()
  await expect(ctx.page.locator('[data-testid="approval-preview"]')).toContainText('"sessionforge:*"')
  await expect(ctx.page.locator('[data-testid="approval-dialog"]')).toContainText('instead of the MCP allowlist')
  await expect(ctx.page.locator('[data-testid="approval-confirm"]')).toBeDisabled()
  await ack.check()
  await ctx.page.click('[data-testid="approval-confirm"]')
  await expect(ctx.page.locator('[data-testid="approval-state-cursor"]')).toHaveText(LABEL.all)
  expect(JSON.parse(read('cursor'))).toEqual({ mcpAllowlist: ['sessionforge:*'] })
  expect(backups('cursor')).toEqual([])
  // Re-applying the same preset changes nothing
  await ctx.page.click('[data-testid="approval-apply-cursor"]')
  await expect(ctx.page.locator('[data-testid="approval-dialog"]')).toContainText('Already set')
  await ctx.page.click('[data-testid="approval-confirm"]')
  await expect(ctx.page.locator('[data-testid="approval-dialog"]')).toHaveCount(0)
  expect(backups('cursor')).toEqual([])
  await closeSettings(ctx)
})
test('detected state follows external edits (Custom for a Claude deny rule)', async () => {
  writeFileSync(file('claude'), JSON.stringify({ permissions: { allow: ['mcp__sessionforge__*'], deny: ['mcp__*'] } }))
  await openSettings(ctx, 'editors')
  await ctx.page.click('[data-testid="agent-editor-claude"]')
  await expect(ctx.page.locator('[data-testid="approval-state-claude"]')).toHaveText('Custom')
  await expect(ctx.page.locator('[data-testid="approval-card-claude"]')).toContainText('An ask/deny rule overrides this: mcp__*')
  await closeSettings(ctx)
  writeFileSync(file('claude'), CLAUDE)
})
test('previews never contain the seeded token, the live token or the API key', async () => {
  const live = await bridgeToken(ctx)
  const json = await ctx.page.evaluate(async () =>
    JSON.stringify([
      await window.api.agent.previewApproval({ editor: 'codex', preset: 'all' }),
      await window.api.agent.previewApproval({ editor: 'claude', preset: 'all' }),
      await window.api.agent.getApprovals()
    ])
  )
  expect(json).toContain('default_tools_approval_mode = \\"approve')
  expect(json).not.toContain(SEEDED_TOKEN)
  expect(json).not.toContain('sk-seeded-secret')
  if (live) expect(json).not.toContain(live)
})
test('main derives the read-only tool list from the annotations', async () => {
  const info = await ctx.page.evaluate(() => window.api.agent.getApprovals())
  for (const i of info) {
    expect([...i.readOnlyTools].sort()).toEqual([...RO].sort())
    expect(i.readOnlyTools).not.toContain('send_request_as')
  }
})
test('IPC rejects unknown ids, extra keys, malformed hashes and a stale preview', async () => {
  const bad: unknown[] = [
    { editor: 'vim', preset: 'all' },
    { editor: 'cursor', preset: 'yolo' },
    { editor: 'cursor', preset: 'all', path: '/etc/passwd' },
    'cursor',
    null
  ]
  for (const input of bad) {
    const msg = await ctx.page.evaluate(
      (i) => window.api.agent.previewApproval(i as never).then(() => 'resolved', (e: Error) => e.message),
      input
    )
    expect(msg, JSON.stringify(input)).toContain('Invalid input')
  }
  const applyBad = [
    { editor: 'cursor', preset: 'all', expectedSha256: 'abc' },
    { editor: 'cursor', preset: 'all' },
    { editor: 'cursor', preset: 'all', expectedSha256: '0'.repeat(64), path: '/tmp/x' }
  ]
  for (const input of applyBad) {
    const msg = await ctx.page.evaluate(
      (i) => window.api.agent.applyApproval(i as never).then(() => 'resolved', (e: Error) => e.message),
      input
    )
    expect(msg, JSON.stringify(input)).toContain('Invalid input')
  }
  // The file changed after the preview: refused, nothing written
  const pv = await ctx.page.evaluate(() => window.api.agent.previewApproval({ editor: 'claude', preset: 'readOnly' }))
  writeFileSync(file('claude'), CLAUDE.replace('opus', 'sonnet'))
  const msg = await ctx.page.evaluate(
    (h) => window.api.agent.applyApproval({ editor: 'claude', preset: 'readOnly', expectedSha256: h }).then(() => 'resolved', (e: Error) => e.message),
    pv.sha256
  )
  expect(msg).toContain('The file changed since the preview')
  expect(read('claude')).toBe(CLAUDE.replace('opus', 'sonnet'))
  const copy = await ctx.page.evaluate(() => window.api.agent.copyApprovalText({ editor: 'nano', preset: 'all' } as never).then(() => 'resolved', (e: Error) => e.message))
  expect(copy).toContain('Invalid input')
})
test('the temp editor home is the only place written', async () => {
  // Every file the suite touched is under the temp root; the global home guard checks the real home
  expect(ctx.editorHome.startsWith(tmpdir())).toBe(true)
  expect(existsSync(file('codex'))).toBe(true)
})
