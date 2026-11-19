// URL guards for agent actions and the built-in self-target guard (design §8.5). Pure.

export type ParsedGuard = { kind: 'host'; host: string } | { kind: 'wildcard'; domain: string }

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/
const warned = new Set<string>()

/** A hostname (staging.example.com) or *. + hostname (subdomains and the apex). Anything else → null. */
export function parseGuard(p: string): ParsedGuard | null {
  const s = p.trim().toLowerCase()
  if (s.startsWith('*.')) {
    const d = s.slice(2)
    if (HOST_RE.test(d)) return { kind: 'wildcard', domain: d }
  } else if (HOST_RE.test(s)) {
    return { kind: 'host', host: s }
  }
  if (!warned.has(p)) {
    warned.add(p)
    console.warn('[agent] ignoring invalid URL guard pattern (use a hostname or *.domain)')
  }
  return null
}

function hostnameOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.hostname.toLowerCase()
  } catch {
    return null
  }
}

export function isGuarded(url: string, patterns: string[]): boolean {
  const host = hostnameOf(url)
  if (!host) return false
  for (const raw of patterns) {
    const g = parseGuard(raw)
    if (!g) continue
    if (g.kind === 'host' && host === g.host) return true
    if (g.kind === 'wildcard' && (host === g.domain || host.endsWith('.' + g.domain))) return true
  }
  return false
}

/**
 * Every hostname Chromium sends to this machine: localhost and *.localhost (with or without a
 * trailing dot), 127.0.0.0/8, 0.0.0.0, [::], [::1] and IPv4-mapped [::ffff:127.x.y.z] / [::ffff:0.0.0.0].
 * Input is a WHATWG URL hostname, so IPv4 is already dotted-decimal and IPv6 is compressed.
 */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h === '0.0.0.0') return true
  if (h === '[::]' || h === '[::1]') return true
  // IPv4-mapped IPv6: the URL parser prints [::ffff:7f00:1] for [::ffff:127.0.0.1]
  const m = /^\[::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}\]$/.exec(h)
  if (m) {
    const hi = parseInt(m[1], 16)
    return hi >> 8 === 0x7f || h === '[::ffff:0:0]'
  }
  return false
}

/** Loopback host on SessionForge's own import or MCP port. */
export function isSelfTarget(url: string, ports: { importPort: number; mcpPort: number }): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (!isLoopbackHost(u.hostname)) return false
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
  return port === ports.importPort || port === ports.mcpPort
}

export type UrlCheck = { ok: true } | { ok: false; self: boolean; host: string; message: string }

export const SELF_TARGET_MESSAGE = "Agents may not call SessionForge's own local servers."

/** The one function every agent URL check calls: self-target first, then the session's guards. */
export function checkAgentUrl(
  url: string,
  session: { name: string; urlGuards?: string[] },
  ports: { importPort: number; mcpPort: number }
): UrlCheck {
  const host = hostnameOf(url) ?? ''
  if (isSelfTarget(url, ports)) return { ok: false, self: true, host, message: SELF_TARGET_MESSAGE }
  if (isGuarded(url, session.urlGuards ?? [])) {
    return {
      ok: false,
      self: false,
      host,
      message: `Session '${session.name}' has a URL guard for ${host}; agents may not go there.`
    }
  }
  return { ok: true }
}
