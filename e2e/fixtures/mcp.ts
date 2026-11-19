// MCP SDK client helpers for the Agent Bridge specs.
import { request } from 'node:http'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { AgentGrant } from '../../src/main/agent/types'
import type { EnvTag, Session } from '../../src/main/types'
import { projectRoot, waitFor, wm, type AppCtx } from './app'

export const TOOL_NAMES = [
  'list_sessions',
  'open',
  'navigate',
  'back',
  'reload',
  'snapshot',
  'click',
  'type',
  'select',
  'press',
  'wait_for',
  'screenshot',
  'console_logs',
  'network_log',
  'send_request_as',
  'get_layout',
  'set_layout'
]

export const bridgeScript = join(projectRoot, 'bin', 'sessionforge-mcp.mjs')

export const bridgeToken = (ctx: AppCtx): Promise<string> => wm(ctx.app, (sf) => sf.agentBridge.getTokenForTest())

export type AgentSubTab = 'overview' | 'access' | 'editors' | 'token' | 'activity'
/** Gear → Agent Bridge → sub-tab. Always navigates, so the remembered last tab never leaks between tests. */
export async function openSettings(ctx: AppCtx, agentTab: AgentSubTab = 'overview'): Promise<void> {
  await ctx.page.click('[data-testid="open-settings"]')
  await ctx.page.waitForSelector('[data-testid="settings-dialog"]')
  await ctx.page.click('[data-testid="settings-nav-agent"]')
  await ctx.page.click(`[data-testid="settings-subtab-${agentTab}"]`)
  await ctx.page.waitForSelector(`[data-testid="settings-subtab-${agentTab}"][data-state="active"]`)
}

export async function closeSettings(ctx: AppCtx): Promise<void> {
  // Escape closes the topmost layer first, and an open toast is a layer too (Radix), so retry
  for (let i = 0; i < 4; i++) {
    await ctx.page.keyboard.press('Escape')
    const closed = await ctx.page
      .waitForSelector('[data-testid="settings-dialog"]', { state: 'detached', timeout: 2_000 })
      .then(() => true, () => false)
    if (closed) return
  }
  await ctx.page.waitForSelector('[data-testid="settings-dialog"]', { state: 'detached' })
}

/** Settings → toggle the switch → wait for "Listening" → close. */
export async function enableBridgeViaUi(ctx: AppCtx): Promise<void> {
  await openSettings(ctx)
  const sw = ctx.page.locator('[data-testid="agent-enable"]')
  if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
  await ctx.page.waitForSelector('[data-testid="agent-status"]:has-text("Listening on")')
  await closeSettings(ctx)
}

export async function httpClient(ctx: AppCtx, token?: string): Promise<Client> {
  const t = token ?? (await bridgeToken(ctx))
  const client = new Client({ name: 'e2e-http', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${ctx.mcpPort}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${t}` } }
  })
  await client.connect(transport)
  return client
}

export async function stdioClient(ctx: AppCtx, token: string): Promise<Client> {
  const client = new Client({ name: 'e2e-stdio', version: '1.0.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bridgeScript],
    env: { SESSIONFORGE_TOKEN: token, SESSIONFORGE_MCP_PORT: String(ctx.mcpPort), PATH: process.env.PATH ?? '' },
    stderr: 'pipe'
  })
  await client.connect(transport)
  return client
}

export interface CallResult {
  isError: boolean
  text: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each tool returns its own JSON shape; specs assert on it field by field
  json: any
  images: Array<{ data: string; mimeType: string }>
}

/** JSON inside the untrusted wrapper (or the whole text) when it parses. */
export function parseWrapped(text: string): unknown {
  const m = /<untrusted_page_content>\n([\s\S]*)\n<\/untrusted_page_content>/.exec(text)
  const body = m ? m[1] : text
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
  const r = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  }
  const text = r.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
  return {
    isError: !!r.isError,
    text,
    json: parseWrapped(text),
    images: r.content.filter((c) => c.type === 'image').map((c) => ({ data: c.data!, mimeType: c.mimeType! }))
  }
}

/** An initialize POST with node:http, so Host/Origin/Authorization are under test control. */
export function rawPost(
  ctx: AppCtx,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  const payload =
    body ??
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } }
    })
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: ctx.mcpPort,
        path: '/mcp',
        method: 'POST',
        setHost: false,
        headers: {
          host: `127.0.0.1:${ctx.mcpPort}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'content-length': String(Buffer.byteLength(payload)),
          ...headers
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') })
        )
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}

/** Through the renderer's IPC path, exactly as the Settings panel does. */
export async function setGrant(ctx: AppCtx, sessionId: string, level: AgentGrant, confirm?: string): Promise<void> {
  await ctx.page.evaluate((a) => window.api.agent.setGrant(a), { sessionId, level, confirm })
}

/** A session with cookies set by the test server (/login-as), its tab left open on /app. */
export async function makeSession(
  ctx: AppCtx,
  base: string,
  name: string,
  user: string,
  role: string,
  env: EnvTag = 'local',
  color = '#3b82f6'
): Promise<{ session: Session; tabId: string }> {
  const session = await ctx.page.evaluate((i) => window.api.session.create(i), { name, color, env })
  const tabId = await wm(
    ctx.app,
    async (sf, a) => (await sf.windowManager.createTab(a.id, a.url, { assign: 'none' })).id,
    { id: session.id, url: `${base}/login-as?user=${user}&role=${role}` }
  )
  await waitFor(
    async () =>
      wm(ctx.app, (sf, id) => {
        const s = sf.windowManager.getTabState(id)
        return !!s && !s.isLoading && s.url.endsWith('/app')
      }, tabId),
    20_000,
    `${name} logged in`
  )
  return { session, tabId }
}
