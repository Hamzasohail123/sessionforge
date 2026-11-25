import { ArrowUpCircle, Download } from 'lucide-react'
import { Button } from './ui/button'
import { callMain } from '../lib/ipc'
import { useSetUpdateState, useUpdateState } from '../lib/update-state'
import { useStore } from '../store'

/**
 * Slim bar above the session bar when a newer release is out. It sits in normal flow (page views
 * draw above the DOM, so a floating card would be hidden) and waits until the first-run tour ends.
 */
export function UpdateNotice() {
  const { data: state } = useUpdateState()
  const setState = useSetUpdateState()
  const tourActive = useStore((s) => s.tourActive)
  const notice = state?.notice
  if (!notice || tourActive) return null
  return (
    <div
      role="region"
      aria-label="Update available"
      data-testid="update-notice"
      data-version={notice.version}
      className="flex shrink-0 items-center gap-2 border-b border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-950 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100"
    >
      <ArrowUpCircle className="h-4 w-4 shrink-0 text-blue-600" aria-hidden />
      <p data-testid="update-notice-text" className="min-w-0 flex-1 truncate">
        <span className="font-medium">SessionForge {notice.version} is available.</span>{' '}
        <span className="text-blue-900/70 dark:text-blue-100/70">You have {state.currentVersion}.</span>
      </p>
      <Button size="sm" className="h-7" data-testid="update-download" onClick={() => callMain(window.api.update.openRelease())}>
        <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> Download
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7"
        data-testid="update-later"
        aria-label="Hide until the next version"
        title="Hide until the next version"
        onClick={() => callMain(window.api.update.dismiss()).then(setState)}
      >
        Later
      </Button>
    </div>
  )
}
