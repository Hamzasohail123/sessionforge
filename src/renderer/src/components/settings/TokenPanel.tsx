import { useState } from 'react'
import { AlertTriangle, Copy, KeyRound, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { callMain } from '../../lib/ipc'
import { Callout, SettingRow, SettingsCard, SettingsPage } from './shared'
import { copied, useAgentBridgeData } from './agent-data'
export function TokenPanel() {
  const { status, setStatus } = useAgentBridgeData()
  const [confirmRotate, setConfirmRotate] = useState(false)
  return (
    <SettingsPage>
      <SettingsCard
        title="Bearer token"
        description="Every request to the bridge needs this token. It never leaves SessionForge except through the copy buttons."
      >
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
          <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="font-mono text-xs">sfa_••••••••••••••••{status?.tokenHint}</span>
        </div>
        <div className="mt-4">
          <SettingRow label="Copy token" hint="Paste it where an editor needs the raw value.">
            <Button size="sm" variant="outline" onClick={() => callMain(window.api.agent.copyToken()).then(() => copied('Token'))}>
              <Copy className="mr-1 h-3 w-3" aria-hidden /> Copy token
            </Button>
          </SettingRow>
          <SettingRow
            label="Copy export line"
            hint={
              <>
                <code className="font-mono text-xs">export SESSIONFORGE_TOKEN='sfa_…'</code> for ~/.bashrc or ~/.zshrc. Editors
                read it from the environment.
              </>
            }
          >
            <Button size="sm" variant="outline" onClick={() => callMain(window.api.agent.copyExportLine()).then(() => copied('Export line'))}>
              <Copy className="mr-1 h-3 w-3" aria-hidden /> Copy export line
            </Button>
          </SettingRow>
          <SettingRow
            label="Rotate token"
            hint={
              confirmRotate
                ? 'Connected agents will be disconnected and need the new token.'
                : 'Makes a new token; old clients get 401 until you update them.'
            }
          >
            {!confirmRotate ? (
              <Button size="sm" variant="outline" onClick={() => setConfirmRotate(true)}>
                <RefreshCw className="mr-1 h-3 w-3" aria-hidden /> Rotate…
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setConfirmRotate(false)
                    callMain(window.api.agent.rotateToken()).then(setStatus)
                  }}
                >
                  Rotate
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRotate(false)}>
                  Cancel
                </Button>
              </>
            )}
          </SettingRow>
        </div>
      </SettingsCard>
      {status && !status.tokenPersisted && (
        <Callout tone="warn" icon={<AlertTriangle />} testid="agent-token-warning">
          The OS keyring is unavailable, so the token is not saved and changes every time SessionForge starts.
        </Callout>
      )}
      {status?.tokenRegenerated && (
        <Callout tone="warn" icon={<AlertTriangle />}>
          A new token was created; update your editor config.
        </Callout>
      )}
    </SettingsPage>
  )
}
