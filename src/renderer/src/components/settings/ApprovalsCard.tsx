// Per-editor approval presets (design §3.5). Main reads, previews and writes the file; this card only
// sends an editor id, a preset id and the previewed hash.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FileCode2, Info, ShieldCheck } from 'lucide-react'
import {
  APPROVAL_PRESETS,
  APPROVAL_STATE_LABELS,
  type ApprovalPreset,
  type ApprovalPreview,
  type ApprovalState,
  type EditorApprovalInfo,
  type EditorId
} from '../../../../main/agent/types'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { toast } from '../ui/use-toast'
import { callMain } from '../../lib/ipc'
import { cn } from '../../lib/utils'
import { Badge, Callout, CopyBlock, SettingsCard } from './shared'
import { copied, EDITORS, useAgentBridgeData, useApprovals } from './agent-data'
const PRESET_TITLES: Record<ApprovalPreset, string> = {
  ask: 'Ask every time',
  readOnly: 'Auto-run read-only tools',
  all: 'Auto-run all SessionForge tools'
}
function presetDescription(editor: EditorId, preset: ApprovalPreset): string {
  if (preset === 'ask') return 'Your editor asks before every SessionForge tool call.'
  if (preset === 'all') return 'Nothing asks. Best when the sessions you allow are deliberately set to Control.'
  if (editor === 'codex') return 'Uses the Codex default: read-only tools run, others ask.'
  return 'Looking (snapshots, screenshots, logs, layout) runs at once; clicks, typing, navigation and requests still ask.'
}
const STATE_TONE: Record<ApprovalState, 'neutral' | 'blue' | 'green' | 'amber' | 'red'> = {
  ask: 'blue',
  readOnly: 'green',
  all: 'green',
  custom: 'amber',
  default: 'neutral',
  missing: 'amber',
  unreadable: 'red'
}
const EDITOR_NOTE: Record<EditorId, string> = {
  cursor: 'Takes effect only in Run Mode Allowlist or Auto-review (Cursor Settings → Agents → Approvals & Execution).',
  codex: 'Restart Codex to apply.',
  claude: 'Claude Code reloads this file automatically.'
}
const CURSOR_WARNING =
  'Cursor uses this file instead of the MCP allowlist in Cursor Settings. Tools you allowed there (for example Figma or Notion) will ask again unless you add them to this file.'
const isPreset = (s: ApprovalState): s is ApprovalPreset => (APPROVAL_PRESETS as readonly string[]).includes(s)
function PresetPicker({
  editor,
  value,
  onChange,
  suggestAll
}: {
  editor: EditorId
  value: ApprovalPreset
  onChange: (p: ApprovalPreset) => void
  suggestAll: boolean
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const n = (i + d + APPROVAL_PRESETS.length) % APPROVAL_PRESETS.length
    onChange(APPROVAL_PRESETS[n])
    refs.current[n]?.focus()
  }
  return (
    <div role="radiogroup" aria-label="Approval preset" className="grid gap-2">
      {APPROVAL_PRESETS.map((p, i) => {
        const checked = value === p
        return (
          <button
            key={p}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-testid={`approval-preset-${editor}-${p}`}
            onClick={() => onChange(p)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              checked ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                checked ? 'border-primary' : 'border-muted-foreground/40'
              )}
            >
              {checked && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {PRESET_TITLES[p]}
                {p === 'readOnly' && <Badge tone="green">Recommended</Badge>}
                {p === 'all' && suggestAll && <Badge tone="blue">Suggested: a session is set to Control</Badge>}
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">{presetDescription(editor, p)}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
function ApplyPreviewDialog({
  editor,
  preset,
  open,
  onOpenChange
}: {
  editor: EditorId
  preset: ApprovalPreset
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [ack, setAck] = useState(false)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (open) setAck(false)
  }, [open])
  const preview = useQuery<ApprovalPreview>({
    queryKey: ['approval-preview', editor, preset],
    queryFn: () => window.api.agent.previewApproval({ editor, preset }),
    enabled: open,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false
  })
  const p = preview.data
  const confirm = async () => {
    if (!p) return
    setPending(true)
    try {
      const r = await callMain(window.api.agent.applyApproval({ editor, preset, expectedSha256: p.sha256 }))
      if (!r) {
        void preview.refetch()
        return
      }
      const restart = editor === 'codex' ? ' Restart Codex to apply.' : ''
      if (r.unchanged) toast({ title: 'Already set', description: `${r.displayPath} already has this preset.` })
      else if (r.backupPath) toast({ title: `Saved. Backup: ${r.backupPath.split(/[\\/]/).pop()}`, description: `${r.displayPath}.${restart}` })
      else toast({ title: `Saved ${r.displayPath}`, description: `Created the file.${restart}` })
      onOpenChange(false)
    } finally {
      setPending(false)
      void queryClient.invalidateQueries({ queryKey: ['agent-approvals'] })
    }
  }
  const showCursorWarning = editor === 'cursor' && preset !== 'ask'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // minmax(0, 1fr): a long config line scrolls inside the diff instead of widening the dialog
        className="max-h-[calc(100vh-4rem)] max-w-2xl grid-cols-[minmax(0,1fr)] overflow-y-auto"
        data-testid="approval-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {PRESET_TITLES[preset]} in {EDITORS[editor].label}
          </DialogTitle>
          <DialogDescription>
            Review the change to <span className="font-mono text-xs">{p?.displayPath ?? '…'}</span>. A backup is made first, and
            only SessionForge entries change.
          </DialogDescription>
        </DialogHeader>
        {preview.isLoading && <p className="text-sm text-muted-foreground">Reading the file…</p>}
        {preview.error && <Callout tone="danger">{String((preview.error as Error).message)}</Callout>}
        {p && (
          <div className="space-y-3">
            {!p.canApply && (
              <Callout tone="danger" icon={<AlertTriangle />}>
                {p.reason} Copy the text from the card instead.
              </Callout>
            )}
            {p.canApply && !p.changed && <Callout tone="info">Already set; nothing changes.</Callout>}
            {p.canApply && p.changed && (
              <div
                data-testid="approval-preview"
                className="max-h-72 overflow-auto rounded-lg border bg-muted/40 py-1.5 font-mono text-xs leading-relaxed"
              >
                {p.diff.map((d, i) => (
                  <div
                    key={i}
                    className={cn(
                      'whitespace-pre px-3',
                      d.kind === '+' && 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
                      d.kind === '-' && 'bg-red-500/10 text-red-800 dark:text-red-300',
                      d.kind === '…' && 'text-muted-foreground'
                    )}
                  >
                    {d.kind === '…' ? '  …' : `${d.kind} ${d.text}`}
                  </div>
                ))}
              </div>
            )}
            {(showCursorWarning && (p.requiresAck || p.warnings.length > 0)) && (
              <Callout tone="danger" icon={<AlertTriangle />}>
                {CURSOR_WARNING}
              </Callout>
            )}
            {p.notes.map((n) => (
              <Callout key={n} tone="info" icon={<Info />}>
                {n}
              </Callout>
            ))}
            {p.requiresAck && (
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  data-testid="approval-ack"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                />
                I understand: my other MCP servers in Cursor will ask again until I add them to this file.
              </label>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="approval-confirm"
            disabled={!p || !p.canApply || pending || (p.requiresAck && !ack)}
            onClick={confirm}
          >
            {pending ? 'Saving…' : p && !p.changed ? 'OK' : 'Back up and apply'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
export function ApprovalsCard({ editor }: { editor: EditorId }) {
  const approvals = useApprovals()
  const { grants } = useAgentBridgeData()
  const info: EditorApprovalInfo | undefined = approvals.data?.find((a) => a.editor === editor)
  const [preset, setPreset] = useState<ApprovalPreset | null>(null)
  const [dialog, setDialog] = useState(false)
  const selected: ApprovalPreset = preset ?? (info && isPreset(info.state) ? info.state : 'readOnly')
  const presetInfo = info?.presets[selected]
  const suggestAll = grants.some((g) => g.stored === 'control')
  return (
    <SettingsCard
      testid={`approval-card-${editor}`}
      title="Approvals"
      description={`Choose whether ${EDITORS[editor].label} asks before it runs SessionForge tools.`}
      action={
        info && (
          <span data-testid={`approval-state-${editor}`} className="inline-flex">
            <Badge tone={STATE_TONE[info.state]}>{APPROVAL_STATE_LABELS[info.state]}</Badge>
          </span>
        )
      }
    >
      <div className="space-y-4">
        <Callout tone="info" icon={<ShieldCheck />}>
          Approval prompts come from your editor. SessionForge's own limits still apply: Hidden/Read/Control per session,
          read-only production sessions, and Stop.
        </Callout>
        {approvals.error && <Callout tone="danger">{String((approvals.error as Error).message)}</Callout>}
        <PresetPicker editor={editor} value={selected} onChange={setPreset} suggestAll={suggestAll} />
        {editor === 'cursor' && selected !== 'ask' && (
          <Callout tone="danger" icon={<AlertTriangle />}>
            {CURSOR_WARNING}
          </Callout>
        )}
        {presetInfo && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileCode2 className="h-3.5 w-3.5" aria-hidden />
              <span className="font-mono">{info.displayPath}</span>
              {!info.exists && <span>(not created yet)</span>}
            </div>
            <CopyBlock
              testid={`approval-text-${editor}`}
              copyTestid={`approval-copy-${editor}`}
              text={presetInfo.text}
              onCopy={() => callMain(window.api.agent.copyApprovalText({ editor, preset: selected })).then(() => copied('Config text'))}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            data-testid={`approval-apply-${editor}`}
            disabled={!presetInfo?.canApply}
            onClick={() => setDialog(true)}
          >
            Apply to {info?.displayPath ?? '…'}
          </Button>
          {presetInfo && !presetInfo.canApply && (
            <span data-testid={`approval-reason-${editor}`} className="text-[13px] text-muted-foreground">
              {presetInfo.reason}
              {/copy/i.test(presetInfo.reason ?? '') ? '' : '. Copy still works.'}
            </span>
          )}
        </div>
        <ul className="space-y-1 text-[13px] text-muted-foreground">
          <li className="flex gap-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {EDITOR_NOTE[editor]}
          </li>
          {info?.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {n}
            </li>
          ))}
          <li className="flex gap-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Read-only tools ({info?.readOnlyTools.join(', ') ?? '…'}) never change a page. Recommended for most setups; use All
            tools when you deliberately set sessions to Control.
          </li>
        </ul>
      </div>
      <ApplyPreviewDialog editor={editor} preset={selected} open={dialog} onOpenChange={setDialog} />
    </SettingsCard>
  )
}
