// Editor approval presets: state, preview and apply (design §2). Node only, no electron import, so the
// whole flow runs in unit tests against a temp config home.
import { APPROVAL_PRESETS, EDITOR_IDS } from '../types'
import type {
  ApprovalApplyInput,
  ApprovalApplyResult,
  ApprovalPick,
  ApprovalPreset,
  ApprovalPreview,
  DiffLine,
  EditorApprovalInfo,
  EditorId,
  PresetInfo
} from '../types'
import { diffHunks } from '../text-diff'
import { detect } from './detect'
import { atomicWrite, backup, readConfig, serialized, sha256, type ReadResult, type WriteDeps } from './files'
import { merge, type MergeResult } from './merge'
import { CODEX_HOME_ERROR, displayPath, editorDisplayPath, editorFile, type ConfigPaths } from './paths'
import { presetText } from './presets'
import { redactConfigLines } from './redact'
export interface ApprovalDeps extends WriteDeps {
  paths: ConfigPaths
  homedir: string
  readOnlyTools: string[]
  /** Live bridge token: never written, redacted from every preview */
  liveToken: string
  now?: () => Date
}
export const TOKEN_REASON = 'Refused: the edit would write a token'
export const CHANGED_REASON = 'The file changed since the preview. Review it again.'
interface Loaded {
  file: string | null
  display: string
  read: ReadResult
}
async function load(deps: ApprovalDeps, editor: EditorId): Promise<Loaded> {
  if (deps.paths.error) throw new Error(deps.paths.error)
  const file = editorFile(deps.paths, editor)
  const display = editorDisplayPath(deps.paths, editor, deps.homedir)
  if (!file) return { file, display, read: { ok: false, exists: false, reason: CODEX_HOME_ERROR } }
  return { file, display, read: await readConfig(file) }
}
/** Added lines must never carry a token (design §2.3 token guard). */
export function writesToken(diff: DiffLine[], liveToken: string): boolean {
  return diff.some((d) => d.kind === '+' && (d.text.includes('sfa_') || (liveToken !== '' && d.text.includes(liveToken))))
}
type Planned = { ok: true; merged: Extract<MergeResult, { ok: true }>; rawDiff: DiffLine[] } | { ok: false; reason: string }
function plan(deps: ApprovalDeps, editor: EditorId, preset: ApprovalPreset, text: string | null): Planned {
  const merged = merge(editor, text, preset, deps.readOnlyTools)
  if (!merged.ok) return merged
  const rawDiff = merged.changed ? diffHunks(text ?? '', merged.after) : []
  if (writesToken(rawDiff, deps.liveToken)) {
    console.error('[approvals]', editor, 'token guard')
    return { ok: false, reason: TOKEN_REASON }
  }
  return { ok: true, merged, rawDiff }
}
function redactDiff(diff: DiffLine[], before: string, after: string, liveToken: string): DiffLine[] {
  const b = redactConfigLines(before, liveToken)
  const a = redactConfigLines(after, liveToken)
  const pick = (lines: string[], n: number) => (lines[n - 1] ?? '').replace(/\r$/, '').replace(/^\uFEFF/, '')
  return diff.map((d) =>
    d.kind === '…' ? d : { ...d, text: d.kind === '+' ? pick(a, d.line) : pick(b, d.line) }
  )
}
export async function getApprovals(deps: ApprovalDeps): Promise<EditorApprovalInfo[]> {
  const out: EditorApprovalInfo[] = []
  for (const editor of EDITOR_IDS) {
    const { display, read } = await load(deps, editor)
    const presets = {} as Record<ApprovalPreset, PresetInfo>
    for (const preset of APPROVAL_PRESETS) {
      const text = presetText(editor, preset, deps.readOnlyTools, display)
      if (!read.ok) {
        presets[preset] = { text, canApply: false, reason: read.reason }
        continue
      }
      const p = plan(deps, editor, preset, read.text)
      presets[preset] = p.ok ? { text, canApply: true } : { text, canApply: false, reason: p.reason }
    }
    const d = read.ok ? detect(editor, read.text, deps.readOnlyTools) : { state: 'unreadable' as const, notes: [read.reason] }
    out.push({ editor, displayPath: display, exists: read.exists, state: d.state, notes: d.notes, readOnlyTools: deps.readOnlyTools, presets })
  }
  return out
}
export async function previewApproval(deps: ApprovalDeps, { editor, preset }: ApprovalPick): Promise<ApprovalPreview> {
  const { display, read } = await load(deps, editor)
  const base = { displayPath: display, exists: read.exists, diff: [], changed: false, warnings: [], notes: [], requiresAck: false }
  if (!read.ok) return { ...base, sha256: sha256(null), canApply: false, reason: read.reason }
  const hash = sha256(read.text)
  const p = plan(deps, editor, preset, read.text)
  if (!p.ok) return { ...base, sha256: hash, canApply: false, reason: p.reason }
  const { merged } = p
  return {
    displayPath: display,
    exists: read.exists,
    diff: redactDiff(p.rawDiff, read.text ?? '', merged.after, deps.liveToken),
    sha256: hash,
    changed: merged.changed,
    warnings: merged.warnings,
    notes: merged.notes,
    requiresAck: merged.requiresAck,
    canApply: true
  }
}
export async function applyApproval(deps: ApprovalDeps, input: ApprovalApplyInput): Promise<ApprovalApplyResult> {
  const { editor, preset, expectedSha256 } = input
  return serialized(editor, async () => {
    const { file, display, read } = await load(deps, editor)
    if (!read.ok || !file) {
      console.warn('[approvals]', editor, 'unreadable')
      throw new Error(read.ok ? CODEX_HOME_ERROR : read.reason)
    }
    if (sha256(read.text) !== expectedSha256) {
      console.info('[approvals]', editor, 'hash mismatch')
      throw new Error(CHANGED_REASON)
    }
    const p = plan(deps, editor, preset, read.text)
    if (!p.ok) {
      console.warn('[approvals]', editor, 'refused')
      throw new Error(p.reason)
    }
    if (!p.merged.changed) {
      const d = detect(editor, read.text, deps.readOnlyTools)
      return { unchanged: true, displayPath: display, backupPath: null, state: d.state }
    }
    let backupPath: string | null = null
    try {
      if (read.exists) backupPath = await backup(file, (deps.now ?? (() => new Date()))())
      await atomicWrite(file, p.merged.after, read.exists ? read.mode : null, deps)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? 'error'
      console.warn('[approvals]', editor, code)
      throw new Error(`Could not save ${display}: ${code}`)
    }
    const again = await readConfig(file)
    const d = again.ok ? detect(editor, again.text, deps.readOnlyTools) : { state: 'unreadable' as const }
    const shownBackup = backupPath ? displayPath(backupPath, deps.homedir) : null
    console.info('[approvals] applied', editor, preset, display, shownBackup)
    return { unchanged: false, displayPath: display, backupPath: shownBackup, state: d.state }
  })
}
