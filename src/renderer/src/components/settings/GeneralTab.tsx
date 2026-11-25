import { useState } from 'react'
import { Download, FolderOpen } from 'lucide-react'
import type { UpdateCheckResult } from '../../../../main/types'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { callMain } from '../../lib/ipc'
import { useSetUpdateState, useUpdateState } from '../../lib/update-state'
import { SettingRow, SettingsCard, SettingsPage } from './shared'
import { useAppInfo } from './app-info'
import { useStore } from '../../store'
const RESULT_TEXT: Record<UpdateCheckResult['outcome'], string> = {
  'up-to-date': "You're up to date.",
  available: 'A new version is available.',
  failed: "Couldn't reach GitHub. Try again later.",
  disabled: 'Update checks are off.'
}
export function GeneralTab() {
  const { data: info } = useAppInfo()
  const { data: update } = useUpdateState()
  const setUpdate = useSetUpdateState()
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const enabled = update?.enabled ?? true
  const checkNow = async () => {
    setChecking(true)
    setResult(null)
    const r = await callMain(window.api.update.checkNow())
    setChecking(false)
    if (!r) return
    setUpdate(r.state)
    setResult(r)
  }
  const setEnabled = async (value: boolean) => {
    setResult(null)
    setUpdate(await callMain(window.api.update.setEnabled(value)))
  }
  return (
    <SettingsPage>
      <SettingsCard title="Application">
        <SettingRow label="Version" hint="Install new versions yourself from the releases page.">
          <span data-testid="app-version" className="font-mono text-sm">
            {info?.version ?? '…'}
          </span>
        </SettingRow>
        <SettingRow label="Platform">
          <span className="font-mono text-sm">{info?.platform ?? '…'}</span>
        </SettingRow>
        <SettingRow
          label="Check for updates"
          htmlFor="update-check-enabled"
          hint="Once a day, SessionForge asks GitHub for the latest version number. Nothing about you is sent."
        >
          <Switch
            id="update-check-enabled"
            data-testid="update-check-enabled"
            checked={enabled}
            disabled={!update}
            onCheckedChange={(v) => void setEnabled(v)}
          />
        </SettingRow>
        <SettingRow
          label="Check now"
          hint={
            <span data-testid="update-check-result" aria-live="polite" className="inline-flex flex-wrap items-center gap-2">
              {result &&
                (result.outcome === 'available' && result.version ? (
                  <>
                    <span className="font-medium text-foreground">SessionForge {result.version} is available.</span>
                    <Button
                      size="sm"
                      className="h-7"
                      data-testid="update-check-download"
                      onClick={() => callMain(window.api.update.openRelease())}
                    >
                      <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> Download
                    </Button>
                  </>
                ) : (
                  <span>{RESULT_TEXT[result.outcome]}</span>
                ))}
            </span>
          }
        >
          <Button
            size="sm"
            variant="outline"
            data-testid="update-check-now"
            disabled={!enabled || checking || !update}
            onClick={() => void checkNow()}
          >
            {checking ? 'Checking…' : 'Check now'}
          </Button>
        </SettingRow>
      </SettingsCard>
      <SettingsCard
        title="Data folder"
        description="Sessions, cookies, the session database and the Agent Bridge token live here, on this computer only."
      >
        <div className="flex items-center gap-2">
          <code data-testid="user-data-path" className="min-w-0 flex-1 truncate rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs" title={info?.userDataPath}>
            {info?.userDataPath ?? '…'}
          </code>
          <Button size="sm" variant="outline" onClick={() => callMain(window.api.app.showUserData())}>
            <FolderOpen className="mr-1 h-3.5 w-3.5" aria-hidden /> Show in folder
          </Button>
        </div>
      </SettingsCard>
      <SettingsCard title="Product tour" description="A one-minute walk through split view, Settings and the MCP server.">
        <Button size="sm" variant="outline" data-testid="replay-tour" onClick={() => useStore.getState().startTour()}>
          Show tour again
        </Button>
      </SettingsCard>
    </SettingsPage>
  )
}
