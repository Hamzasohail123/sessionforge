// Snapshot outline → text (design §10.1). Pure.
import { cut } from './redact'

export const TRUNCATION_HINT = 'Use interactive_only: true, or a selector with wait_for.'

export function formatSnapshot(
  snap: { title: string; url: string; lines: string[]; truncated: number },
  maxChars: number
): string {
  const header = [
    `Page: ${JSON.stringify(cut(snap.title, 200))} ${cut(snap.url, 500)}`,
    'Refs: use ref values with click/type/select/press. Refs stay valid until the page navigates.'
  ]
  let used = header.join('\n').length
  const body: string[] = []
  let dropped = snap.truncated
  for (let i = 0; i < snap.lines.length; i++) {
    const line = snap.lines[i]
    if (used + 1 + line.length > maxChars) {
      dropped += snap.lines.length - i
      break
    }
    body.push(line)
    used += 1 + line.length
  }
  if (snap.lines.length === 0 && dropped === 0) body.push('- (no visible elements)')
  const out = [...header, ...body]
  if (dropped > 0) out.push(`… truncated: ${dropped} more elements not shown. ${TRUNCATION_HINT}`)
  return out.join('\n')
}
