import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { EditorId, SnippetKind } from '../../../../main/agent/types'
import { Button } from '../ui/button'
import { toast } from '../ui/use-toast'
import { callMain } from '../../lib/ipc'
import { cn } from '../../lib/utils'
import { CopyBlock, SettingsCard, SettingsPage } from './shared'
import { copied, EDITOR_ORDER, EDITORS, useSnippets } from './agent-data'
import { ApprovalsCard } from './ApprovalsCard'
const VERIFY: Record<EditorId, ReactNode> = {
  cursor: (
    <>
      Quit Cursor and start it from a shell that has <code className="font-mono">SESSIONFORGE_TOKEN</code>. In Cursor Settings → MCP,
      sessionforge should list 17 tools.
    </>
  ),
  codex: (
    <>
      Start a new Codex session from that shell. <code className="font-mono">codex mcp list</code> (or <code className="font-mono">/mcp</code>{' '}
      in the chat) should show sessionforge.
    </>
  ),
  claude: (
    <>
      Start Claude Code from that shell. <code className="font-mono">claude mcp list</code> should say “✔ Connected” (or use{' '}
      <code className="font-mono">/mcp</code> in a session).
    </>
  )
}
function Step({ n, title, hint, children }: { n: number; title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <li className="group/step relative flex gap-4 pb-6 last:pb-0">
      <span className="absolute left-[13px] top-8 h-[calc(100%-2rem)] w-px bg-border group-last/step:hidden" aria-hidden />
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-semibold">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <div className="text-sm font-medium">{title}</div>
        {hint && <p className="text-[13px] leading-relaxed text-muted-foreground">{hint}</p>}
        {children}
      </div>
    </li>
  )
}
export function EditorsPanel() {
  const [editor, setEditor] = useState<EditorId>('cursor')
  const { data: snippets } = useSnippets()
  const e = EDITORS[editor]
  const copySnippet = (kind: SnippetKind, inlineToken: boolean) =>
    callMain(window.api.agent.copySnippet({ kind, inlineToken })).then(() =>
      inlineToken
        ? toast({ title: 'Copied with the token inline', description: "This puts the token in the file. Don't commit it." })
        : copied('Snippet')
    )
  return (
    <SettingsPage>
      <div role="group" aria-label="Editor" className="inline-flex rounded-lg border bg-muted/60 p-1">
        {EDITOR_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`agent-editor-${id}`}
            aria-pressed={editor === id}
            onClick={() => setEditor(id)}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              editor === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {EDITORS[id].label}
          </button>
        ))}
      </div>
      <SettingsCard title={`Connect ${e.label}`} description="Three steps; each one has its own copy button.">
        <ol className="mt-1">
          <Step
            n={1}
            title="Put the token in your shell"
            hint="Add the export line to ~/.bashrc or ~/.zshrc. Desktop-launched editors read the login environment, so log out and in, or start the editor from a shell."
          >
            {snippets && (
              <CopyBlock
                testid="agent-snippet-shellExport"
                text={snippets.shellExport.text}
                copyLabel="Copy export line"
                onCopy={() => callMain(window.api.agent.copyExportLine()).then(() => copied('Export line'))}
              />
            )}
          </Step>
          <Step n={2} title={`Add SessionForge to ${e.label}`} hint={snippets?.[e.http].location}>
            {snippets && (
              <>
                <CopyBlock
                  testid={`agent-snippet-${e.http}`}
                  text={snippets[e.http].text}
                  onCopy={() => copySnippet(e.http, false)}
                  extra={
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 bg-background/80 px-2 text-xs"
                      title="This puts the token in the file. Don't commit it."
                      onClick={() => copySnippet(e.http, true)}
                    >
                      With token
                    </Button>
                  }
                />
                <details className="group rounded-lg border px-3 py-2 text-[13px]">
                  <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-muted-foreground hover:text-foreground">
                    <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden />
                    {snippets[e.stdio].title}
                  </summary>
                  <div className="mt-2 space-y-2">
                    <p className="text-muted-foreground">{snippets[e.stdio].location}</p>
                    <CopyBlock testid={`agent-snippet-${e.stdio}`} text={snippets[e.stdio].text} onCopy={() => copySnippet(e.stdio, false)} />
                  </div>
                </details>
              </>
            )}
          </Step>
          <Step n={3} title="Restart and check" hint={VERIFY[editor]} />
        </ol>
      </SettingsCard>
      <ApprovalsCard editor={editor} />
    </SettingsPage>
  )
}
