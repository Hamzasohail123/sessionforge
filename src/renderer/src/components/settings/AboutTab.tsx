import { FileText, Lock, RefreshCw, WifiOff } from 'lucide-react'
import type { DocId } from '../../../../main/types'
import { Button } from '../ui/button'
import { callMain } from '../../lib/ipc'
import { SettingRow, SettingsCard, SettingsPage } from './shared'
import { useAppInfo } from './app-info'
const DOCS: Array<{ id: DocId; label: string; path: string }> = [
  { id: 'readme', label: 'README', path: 'README.md' },
  { id: 'security', label: 'Security policy', path: 'SECURITY.md' },
  { id: 'privacy', label: 'Privacy policy', path: 'PRIVACY.md' },
  { id: 'license', label: 'License', path: 'LICENSE' }
]
export function AboutTab() {
  const { data: info } = useAppInfo()
  return (
    <SettingsPage>
      <SettingsCard>
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">SF</div>
          <div>
            <div className="text-base font-semibold">SessionForge</div>
            <div className="text-[13px] text-muted-foreground">
              Version {info?.version ?? '…'} · {info?.license ?? 'Apache-2.0'} · open source
            </div>
          </div>
        </div>
      </SettingsCard>
      <SettingsCard title="Privacy">
        <ul className="space-y-3 text-[13px]">
          <li className="flex gap-3">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            <span>
              <span className="font-medium">Local-first.</span>{' '}
              <span className="text-muted-foreground">Sessions, cookies and settings stay on this computer. There are no accounts and no cloud sync.</span>
            </span>
          </li>
          <li className="flex gap-3">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            <span>
              <span className="font-medium">No telemetry.</span>{' '}
              <span className="text-muted-foreground">
                No analytics or crash reports. Apart from the update check below, SessionForge's own only request is send_request_as from an
                agent you connected.
              </span>
            </span>
          </li>
          <li className="flex gap-3" data-testid="about-update-check">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            <span>
              <span className="font-medium">Update check.</span>{' '}
              <span className="text-muted-foreground">
                Checks GitHub once a day for new versions (no data about you is sent). You can turn this off in General.
              </span>
            </span>
          </li>
        </ul>
      </SettingsCard>
      <SettingsCard title="Documents" description="Shipped with the app; they open in your system viewer.">
        {DOCS.map((d) => (
          <SettingRow key={d.id} label={d.label} hint={<span className="font-mono text-xs">{d.path}</span>}>
            <Button size="sm" variant="outline" onClick={() => callMain(window.api.app.openDoc(d.id))}>
              <FileText className="mr-1 h-3.5 w-3.5" aria-hidden /> Open
            </Button>
          </SettingRow>
        ))}
      </SettingsCard>
    </SettingsPage>
  )
}
