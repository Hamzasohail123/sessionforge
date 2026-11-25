import { FolderOpen } from 'lucide-react'
import { Button } from '../ui/button'
import { callMain } from '../../lib/ipc'
import { SettingRow, SettingsCard, SettingsPage } from './shared'
import { useAppInfo } from './app-info'
import { useStore } from '../../store'
export function GeneralTab() {
  const { data: info } = useAppInfo()
  return (
    <SettingsPage>
      <SettingsCard title="Application">
        <SettingRow label="Version" hint="SessionForge has no auto-update; new versions are on the releases page.">
          <span data-testid="app-version" className="font-mono text-sm">
            {info?.version ?? '…'}
          </span>
        </SettingRow>
        <SettingRow label="Platform">
          <span className="font-mono text-sm">{info?.platform ?? '…'}</span>
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
