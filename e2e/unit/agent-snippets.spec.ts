import { test, expect } from '@playwright/test'
import { renderSnippets } from '../../src/main/agent/snippets'

const TOKEN = 'sfa_' + 'B'.repeat(43)
const base = { port: 34568, scriptPath: '/opt/SessionForge/resources/bin/sessionforge-mcp.mjs' }

test('Cursor snippets parse as JSON; placeholder vs inline token', () => {
  const p = renderSnippets({ ...base, token: null })
  const http = JSON.parse(p.cursorHttp.text)
  expect(http).toEqual({
    mcpServers: {
      sessionforge: { url: 'http://127.0.0.1:34568/mcp', headers: { Authorization: 'Bearer ${env:SESSIONFORGE_TOKEN}' } }
    }
  })
  expect(JSON.parse(p.cursorStdio.text)).toEqual({
    mcpServers: {
      sessionforge: {
        type: 'stdio',
        command: 'node',
        args: [base.scriptPath],
        env: { SESSIONFORGE_TOKEN: '${env:SESSIONFORGE_TOKEN}' }
      }
    }
  })
  const i = renderSnippets({ ...base, token: TOKEN })
  expect(JSON.parse(i.cursorHttp.text).mcpServers.sessionforge.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  expect(JSON.parse(i.cursorStdio.text).mcpServers.sessionforge.env.SESSIONFORGE_TOKEN).toBe(TOKEN)
  for (const k of Object.keys(p) as Array<keyof typeof p>) expect(p[k].text).not.toContain('sfa_B')
})

test('Codex TOML lines are exact', () => {
  const p = renderSnippets({ ...base, token: null })
  expect(p.codexHttp.text).toBe(
    ['[mcp_servers.sessionforge]', 'url = "http://127.0.0.1:34568/mcp"', 'bearer_token_env_var = "SESSIONFORGE_TOKEN"'].join('\n')
  )
  expect(p.codexStdio.text).toBe(
    ['[mcp_servers.sessionforge]', 'command = "node"', `args = ["${base.scriptPath}"]`, 'env_vars = ["SESSIONFORGE_TOKEN"]'].join('\n')
  )
  const i = renderSnippets({ ...base, token: TOKEN })
  expect(i.codexHttp.text).toContain(`http_headers = { Authorization = "Bearer ${TOKEN}" }`)
  expect(i.codexStdio.text).toContain(`env = { SESSIONFORGE_TOKEN = "${TOKEN}" }`)
  expect(i.shellExport.text).toBe(`export SESSIONFORGE_TOKEN='${TOKEN}'`)
})

test('non-default port appears in URLs and stdio env', () => {
  const p = renderSnippets({ ...base, port: 40000, token: null })
  expect(p.cursorHttp.text).toContain('http://127.0.0.1:40000/mcp')
  expect(JSON.parse(p.cursorStdio.text).mcpServers.sessionforge.env.SESSIONFORGE_MCP_PORT).toBe('40000')
  expect(p.codexStdio.text).toContain('env = { SESSIONFORGE_MCP_PORT = "40000" }')
  expect(p.codexHttp.text).toContain('url = "http://127.0.0.1:40000/mcp"')
})

test('Claude Code commands are exact; placeholder stays literal, inline token is quoted', () => {
  const p = renderSnippets({ ...base, token: null })
  expect(p.claudeHttp.text).toBe(
    "claude mcp add --transport http --scope user sessionforge http://127.0.0.1:34568/mcp --header 'Authorization: Bearer ${SESSIONFORGE_TOKEN}'"
  )
  expect(p.claudeStdio.text).toBe(
    `claude mcp add sessionforge --transport stdio --scope user --env 'SESSIONFORGE_TOKEN=\${SESSIONFORGE_TOKEN}' -- node '${base.scriptPath}'`
  )
  const i = renderSnippets({ ...base, token: TOKEN })
  expect(i.claudeHttp.text).toContain(`--header 'Authorization: Bearer ${TOKEN}'`)
  expect(i.claudeStdio.text).toContain(`--env 'SESSIONFORGE_TOKEN=${TOKEN}'`)
})

test('Claude Code: non-default port and paths with spaces or quotes', () => {
  const p = renderSnippets({ port: 40000, scriptPath: "/home/a b/it's/sessionforge-mcp.mjs", token: null })
  expect(p.claudeHttp.text).toContain(' http://127.0.0.1:40000/mcp ')
  expect(p.claudeStdio.text).toContain("--env 'SESSIONFORGE_MCP_PORT=40000'")
  expect(p.claudeStdio.text.endsWith(`-- node '/home/a b/it'\\''s/sessionforge-mcp.mjs'`)).toBe(true)
})
