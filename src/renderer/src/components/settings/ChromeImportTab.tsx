import { FileText, FolderOpen, AlertTriangle } from 'lucide-react'
import { Button } from '../ui/button'
import { callMain } from '../../lib/ipc'
import { Callout, SettingsCard, SettingsPage, StatusDot } from './shared'
import { useAppInfo } from './app-info'
export function ChromeImportTab() {
  const { data: info } = useAppInfo()
  const s = info?.importServer
  return (
    <SettingsPage>
      <SettingsCard
        title="Import server"
        description="The SessionForge Import extension sends a Chrome tab's cookies and storage here; the session opens in a pane."
      >
        <div className="flex items-center gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5">
          <StatusDot tone={!s ? 'off' : s.listening ? 'ok' : 'error'} />
          <span data-testid="import-status" className="font-mono text-xs">
            {!s ? '…' : s.listening ? `Listening on 127.0.0.1:${s.port}` : `Not running: ${s.error ?? `port ${s.port} unavailable`}`}
          </span>
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">
          Only the extension and local tools can import; web pages are refused. Set <code className="font-mono">SESSIONFORGE_IMPORT_PORT</code> to
          use another port.
        </p>
      </SettingsCard>
      <SettingsCard title="Install the extension" description="Chrome, Edge, Brave and other Chromium browsers.">
        <ol className="list-decimal space-y-2 pl-5 text-[13px] leading-relaxed">
          <li>
            Open <code className="font-mono">chrome://extensions</code> and turn on <strong>Developer mode</strong>.
          </li>
          <li>
            Click <strong>Load unpacked</strong> and choose this folder:
            <div className="mt-1.5 flex items-center gap-2">
              <code data-testid="extension-path" className="min-w-0 flex-1 truncate rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs" title={info?.extensionPath ?? ''}>
                {info ? info.extensionPath ?? '—' : '…'}
              </code>
              <Button size="sm" variant="outline" disabled={!info?.extensionPath} onClick={() => callMain(window.api.app.showExtensionFolder())}>
                <FolderOpen className="mr-1 h-3.5 w-3.5" aria-hidden /> Show folder
              </Button>
            </div>
          </li>
          <li>
            Pin SessionForge Import, open the site you are logged in to, and click <strong>Send to SessionForge</strong> in the extension
            popup (the first time, click <strong>Agree</strong> and allow access to the site).
          </li>
        </ol>
        {info && !info.extensionPath && (
          <div className="mt-3">
            <Callout tone="warn" icon={<AlertTriangle />}>
              Could not prepare the extension folder: {info.extensionError ?? 'unknown error'}
            </Callout>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => callMain(window.api.app.openDoc('chromeExtension'))}>
            <FileText className="mr-1 h-3.5 w-3.5" aria-hidden /> Open extension README
          </Button>
          <span className="font-mono text-xs text-muted-foreground">chrome-extension/README.md</span>
        </div>
      </SettingsCard>
    </SettingsPage>
  )
}
