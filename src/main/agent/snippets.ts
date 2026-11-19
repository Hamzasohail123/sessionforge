// Editor config snippets for Cursor, Codex and Claude Code (design §18.1, §18.2). Pure.
import { DEFAULT_MCP_PORT } from './config'
import type { Snippet, SnippetKind } from './types'

export interface SnippetInput {
  port: number
  scriptPath: string
  /** null → placeholder that reads the SESSIONFORGE_TOKEN environment variable */
  token: string | null
}

export const TOKEN_PLACEHOLDER = '<token from SessionForge → Settings → Agent Bridge>'

const toml = (s: string) => JSON.stringify(s)

export function endpointFor(port: number): string {
  return `http://127.0.0.1:${port}/mcp`
}

export function cursorHttp({ port, token }: SnippetInput): string {
  const auth = token ? `Bearer ${token}` : 'Bearer ${env:SESSIONFORGE_TOKEN}'
  return JSON.stringify(
    { mcpServers: { sessionforge: { url: endpointFor(port), headers: { Authorization: auth } } } },
    null,
    2
  )
}

export function cursorStdio({ port, scriptPath, token }: SnippetInput): string {
  const env: Record<string, string> = { SESSIONFORGE_TOKEN: token ?? '${env:SESSIONFORGE_TOKEN}' }
  if (port !== DEFAULT_MCP_PORT) env.SESSIONFORGE_MCP_PORT = String(port)
  return JSON.stringify(
    { mcpServers: { sessionforge: { type: 'stdio', command: 'node', args: [scriptPath], env } } },
    null,
    2
  )
}

export function codexHttp({ port, token }: SnippetInput): string {
  const lines = ['[mcp_servers.sessionforge]', `url = ${toml(endpointFor(port))}`]
  if (token) lines.push(`http_headers = { Authorization = ${toml(`Bearer ${token}`)} }`)
  else lines.push('bearer_token_env_var = "SESSIONFORGE_TOKEN"')
  return lines.join('\n')
}

export function codexStdio({ port, scriptPath, token }: SnippetInput): string {
  const lines = ['[mcp_servers.sessionforge]', 'command = "node"', `args = [${toml(scriptPath)}]`]
  const env: string[] = []
  if (token) env.push(`SESSIONFORGE_TOKEN = ${toml(token)}`)
  if (port !== DEFAULT_MCP_PORT) env.push(`SESSIONFORGE_MCP_PORT = ${toml(String(port))}`)
  if (env.length) lines.push(`env = { ${env.join(', ')} }`)
  if (!token) lines.push('env_vars = ["SESSIONFORGE_TOKEN"]')
  return lines.join('\n')
}

// Single-quote a value for POSIX shells
const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// Claude Code: one `claude mcp add` command. Without an inline token, the single-quoted
// ${SESSIONFORGE_TOKEN} is stored literally and Claude Code expands it when it connects.
export function claudeHttp({ port, token }: SnippetInput): string {
  const header = `Authorization: Bearer ${token ?? '${SESSIONFORGE_TOKEN}'}`
  return `claude mcp add --transport http --scope user sessionforge ${endpointFor(port)} --header ${sh(header)}`
}

export function claudeStdio({ port, scriptPath, token }: SnippetInput): string {
  const env = [`--env ${sh(`SESSIONFORGE_TOKEN=${token ?? '${SESSIONFORGE_TOKEN}'}`)}`]
  if (port !== DEFAULT_MCP_PORT) env.push(`--env ${sh(`SESSIONFORGE_MCP_PORT=${port}`)}`)
  // Name first: --env is variadic and would swallow a name that follows it
  return `claude mcp add sessionforge --transport stdio --scope user ${env.join(' ')} -- node ${sh(scriptPath)}`
}

export function shellExport({ token }: SnippetInput): string {
  // Tokens are base64url, so single quotes need no escaping
  return `export SESSIONFORGE_TOKEN='${token ?? TOKEN_PLACEHOLDER}'`
}

export function renderSnippets(input: SnippetInput): Record<SnippetKind, Snippet> {
  return {
    cursorHttp: {
      title: 'Cursor (HTTP, recommended)',
      location: '.cursor/mcp.json in a project, or ~/.cursor/mcp.json for all projects',
      text: cursorHttp(input)
    },
    cursorStdio: {
      title: 'Cursor (stdio alternative)',
      location: '.cursor/mcp.json or ~/.cursor/mcp.json',
      text: cursorStdio(input)
    },
    codexHttp: {
      title: 'Codex CLI and VS Code extension (HTTP, recommended)',
      location: '~/.codex/config.toml (or .codex/config.toml in a project)',
      text: codexHttp(input)
    },
    codexStdio: {
      title: 'Codex (stdio alternative)',
      location: '~/.codex/config.toml',
      text: codexStdio(input)
    },
    claudeHttp: {
      title: 'Claude Code (HTTP, recommended)',
      location: 'Run once in a terminal; check with `claude mcp list` (use stdio if it shows 401)',
      text: claudeHttp(input)
    },
    claudeStdio: {
      title: 'Claude Code (stdio alternative)',
      location: 'Run once in a terminal (remove the HTTP entry first: claude mcp remove sessionforge)',
      text: claudeStdio(input)
    },
    shellExport: {
      title: 'Shell',
      location: '~/.bashrc or ~/.zshrc, then restart the editor from a shell (or log out and in)',
      text: shellExport(input)
    }
  }
}
