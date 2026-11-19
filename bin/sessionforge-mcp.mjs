#!/usr/bin/env node
// SessionForge stdio MCP bridge. Zero dependencies (Node >= 18 global fetch), so it runs from outside
// app.asar with system node, or as `ELECTRON_RUN_AS_NODE=1 <SessionForge executable> sessionforge-mcp.mjs`.
// Reads newline-delimited JSON-RPC from stdin, POSTs each message to the running app's Streamable HTTP
// endpoint with the bearer token, and writes replies to stdout. stdout carries protocol messages only;
// logs go to stderr. The app answers with plain JSON (enableJsonResponse) and sends no
// server-initiated messages.
import { createInterface } from 'node:readline'

const log = (m) => process.stderr.write(`sessionforge-mcp: ${m}\n`)

// Same rule as resolveMcpPort in src/main/agent/config.ts (this script cannot import it):
// absent or empty → 34568, otherwise an integer 1024-65535.
const rawPort = process.env.SESSIONFORGE_MCP_PORT
let port = 34568
if (rawPort !== undefined && rawPort !== '') {
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1024 || Number(rawPort) > 65535) {
    log('SESSIONFORGE_MCP_PORT must be an integer 1024-65535.')
    process.exit(2)
  }
  port = Number(rawPort)
}
const token = process.env.SESSIONFORGE_TOKEN ?? ''
if (!/^sfa_[A-Za-z0-9_-]{43}$/.test(token)) {
  log(
    token
      ? 'SESSIONFORGE_TOKEN does not look like a SessionForge token. Copy it from SessionForge → Settings → Agent Bridge.'
      : 'SESSIONFORGE_TOKEN is not set. Copy it from SessionForge → Settings → Agent Bridge.'
  )
  process.exit(2)
}

const endpoint = `http://127.0.0.1:${port}/mcp`
const NOT_RUNNING = `SessionForge is not running, or the Agent Bridge is turned off (nothing listening on ${endpoint}). Start SessionForge and enable Settings → Agent Bridge.`
const BAD_TOKEN =
  'SessionForge rejected the token. Copy the current token from Settings → Agent Bridge (it changes when rotated).'

let sessionId
let protocolVersion
let initMessage = null
let initialized = Promise.resolve()
let reinit = null
let nextReplayId = 1
const pending = new Set()

const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
const errorReply = (id, message, code = -32000) => {
  if (id !== undefined && id !== null) out({ jsonrpc: '2.0', id, error: { code, message } })
}

class BridgeError extends Error {}

/** POST one message. Returns { status, messages } or throws BridgeError with a user-facing text. */
async function post(msg) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion
  let res
  try {
    res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(msg) })
  } catch {
    throw new BridgeError(NOT_RUNNING)
  }
  const sid = res.headers.get('mcp-session-id')
  if (sid) sessionId = sid
  const body = await res.text()
  if (res.status === 401) throw new BridgeError(BAD_TOKEN)
  if (res.status === 403) {
    let m = 'SessionForge refused the request (403).'
    try {
      m = JSON.parse(body).error?.message ?? m
    } catch {
      // keep the default
    }
    throw new BridgeError(m)
  }
  if (res.status === 202 || res.status === 204) return { status: res.status, messages: [] }
  const type = res.headers.get('content-type') || ''
  const messages = []
  if (type.includes('text/event-stream')) {
    for (const line of body.split('\n')) {
      if (line.startsWith('data:')) {
        const d = line.slice(5).trim()
        if (d) messages.push(JSON.parse(d))
      }
    }
  } else if (body.trim()) {
    try {
      messages.push(JSON.parse(body))
    } catch {
      throw new BridgeError(`Unexpected reply from SessionForge (HTTP ${res.status}).`)
    }
  }
  return { status: res.status, messages }
}

/** The app restarted or the bridge was toggled: replay initialize once (single-flight). */
function reinitialize() {
  if (!reinit) {
    reinit = (async () => {
      sessionId = undefined
      if (!initMessage) throw new BridgeError('The MCP session ended; restart the MCP server in your editor.')
      const r = await post({ ...initMessage, id: `sessionforge-mcp-replay-${nextReplayId++}` })
      const result = r.messages.find((m) => m.result)?.result
      if (!result) throw new BridgeError('SessionForge did not accept the new MCP session.')
      if (result.protocolVersion) protocolVersion = result.protocolVersion
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    })().finally(() => {
      reinit = null
    })
  }
  return reinit
}

async function forward(msg) {
  try {
    let r = await post(msg)
    if (r.status === 404 && msg.method !== 'initialize') {
      await reinitialize()
      r = await post(msg)
    }
    for (const m of r.messages) {
      if (msg.method === 'initialize' && m.result?.protocolVersion) protocolVersion = m.result.protocolVersion
      out(m)
    }
    if (r.status >= 400 && r.messages.length === 0) errorReply(msg.id, `SessionForge returned HTTP ${r.status}.`)
  } catch (e) {
    const m = e instanceof BridgeError ? e.message : `sessionforge-mcp internal error: ${e?.message ?? e}`
    log(m)
    errorReply(msg.id, m)
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    return
  }
  let p
  if (msg.method === 'initialize') {
    initMessage = msg
    sessionId = undefined
    p = initialized.then(() => forward(msg))
    initialized = p
  } else {
    // initialize must finish first (it sets the session id); later messages run concurrently,
    // so a long wait_for does not block other calls
    p = initialized.then(() => forward(msg))
  }
  pending.add(p)
  p.finally(() => pending.delete(p))
})
rl.on('close', () => {
  Promise.allSettled([initialized, ...pending]).finally(async () => {
    if (sessionId) {
      await fetch(endpoint, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}`, 'mcp-session-id': sessionId }
      }).catch(() => undefined)
    }
    process.exit(0)
  })
})
