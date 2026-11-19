// Redaction of config-file lines shown in the Apply preview (design §2.6, design-verdict finding 11). Pure.
import { REDACTED, redactText, redactUrl } from '../redact'
const ANY_TOKEN_RE = /sfa_[A-Za-z0-9_-]{16,}/g
const SECRET_KEY_RE = /(token|secret|password|passwd|authorization|api[_-]?key|cookie|bearer)/i
const QUOTED_RE = /"(?:[^"\\]|\\.)*"|'[^']*'/g
const QUOTED_AT_START_RE = /^(?:"(?:[^"\\]|\\.)*"|'[^']*')/
const WORD_AT_START_RE = /^[A-Za-z0-9_.-]+/
const SEP_AT_START_RE = /^\s*[:=]\s*/
const REDACTED_VALUE = `"${REDACTED}"`
/** Quoted http(s) values go through redactUrl (user:password and secret query parameters). */
function redactUrls(line: string): string {
  return line.replace(QUOTED_RE, (q) => {
    const inner = q.slice(1, -1)
    if (!/^https?:\/\//i.test(inner)) return q
    return q[0] + redactUrl(inner) + q[0]
  })
}
/**
 * Redact one line. pending says the previous line ended with a secret key and its separator, so the
 * first quoted value here is the secret. Returns the redacted line and the pending flag for the next.
 * Quoted strings are scanned as units, so key-like text inside a value is never taken for a key.
 */
export function redactConfigLine(line: string, liveToken: string, pending = false): { text: string; pending: boolean } {
  let s = line
  if (liveToken) s = s.split(liveToken).join('sfa_' + REDACTED)
  s = redactUrls(redactText(s).replace(ANY_TOKEN_RE, 'sfa_' + REDACTED))
  let out = ''
  let i = 0
  let carry = pending
  let nextPending = false
  while (i < s.length) {
    const rest = s.slice(i)
    const quoted = QUOTED_AT_START_RE.exec(rest)
    const word = quoted ? null : WORD_AT_START_RE.exec(rest)
    const tok = quoted?.[0] ?? word?.[0]
    if (!tok) {
      out += s[i++]
      continue
    }
    if (quoted && carry) {
      carry = false
      out += REDACTED_VALUE
      i += tok.length
      continue
    }
    const sep = SEP_AT_START_RE.exec(s.slice(i + tok.length))
    const key = quoted ? tok.slice(1, -1) : tok
    if (!sep || !SECRET_KEY_RE.test(key)) {
      out += tok
      i += tok.length
      continue
    }
    const valueAt = i + tok.length + sep[0].length
    const value = s.slice(valueAt)
    out += tok + sep[0]
    const q = QUOTED_AT_START_RE.exec(value)
    if (q) {
      out += REDACTED_VALUE
      i = valueAt + q[0].length
    } else if (value.trim() === '') {
      nextPending = true
      i = s.length
    } else if (/^[{[]/.test(value)) {
      i = valueAt // a table or array: its inner pairs are handled one by one
    } else {
      out += REDACTED
      i = s.length
    }
  }
  return { text: out, pending: nextPending }
}
/** Redact every line of a file, carrying a pending secret value over to the next line. */
export function redactConfigLines(text: string, liveToken: string): string[] {
  let pending = false
  return text.split('\n').map((l) => {
    const r = redactConfigLine(l, liveToken, pending)
    pending = r.pending
    return r.text
  })
}
