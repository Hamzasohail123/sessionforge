// Agent Bridge constants and the MCP port rule. Pure: unit specs load this in plain Node.

export const DEFAULT_MCP_PORT = 34568
/** Isolated world for agent page scripts (Electron uses 999 for preload isolation). */
export const AGENT_WORLD_ID = 1001

export const LIMITS = {
  maxBodyBytes: 4 * 1024 * 1024,
  maxMcpSessions: 16,
  mcpIdleMs: 60 * 60 * 1000,
  mcpSweepMs: 5 * 60 * 1000,
  pageScriptTimeoutMs: 5000,
  tabMutexWaitMs: 10_000,
  presenceLingerMs: 10_000,
  agentTouchMs: 3000,
  attachWaitMs: 2000,
  activityEntries: 500,
  consoleEntries: 500,
  networkEntries: 500,
  networkPending: 1000,
  networkPendingMaxAgeMs: 120_000,
  requestAsMaxResponseBytes: 5 * 1024 * 1024,
  requestAsMaxHops: 10,
  screenshotMaxPngBytes: 4 * 1024 * 1024
} as const

/**
 * SESSIONFORGE_MCP_PORT: absent or empty → 34568; an integer 1024–65535 → it; anything else → an
 * error log and 34568. bin/sessionforge-mcp.mjs duplicates this rule (it cannot import this file).
 */
export function resolveMcpPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_MCP_PORT
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    if (n >= 1024 && n <= 65535) return n
  }
  console.error(`[agent] SESSIONFORGE_MCP_PORT must be an integer 1024-65535; using ${DEFAULT_MCP_PORT}`)
  return DEFAULT_MCP_PORT
}
