import type { QueryClient } from '@tanstack/react-query'
import type { ReopenResult, Session } from '../../../main/types'
import { callMain } from './ipc'
import { toast } from '../components/ui/use-toast'
import { ToastAction } from '../components/ui/toast'

/** Lists that change when a session closes, reopens or is deleted (main also broadcasts agent:grants). */
function refresh(qc: QueryClient, sessionId: string): void {
  qc.invalidateQueries({ queryKey: ['sessions'] })
  qc.invalidateQueries({ queryKey: ['agent-grants'] })
  qc.invalidateQueries({ queryKey: ['tabs', sessionId] })
}

/** undefined: callMain already showed the error. A reopened tab just appears, as in Chrome. */
function settle(qc: QueryClient, result: ReopenResult | null | undefined): void {
  if (result === undefined) return
  if (result === null) {
    toast({ title: 'Nothing to reopen' })
    return
  }
  refresh(qc, result.sessionId)
  if (result.kind === 'session') toast({ title: `Reopened ${result.sessionName}` })
}

/** Cmd/Ctrl+Shift+T and the command palette item */
export async function reopenLast(qc: QueryClient): Promise<void> {
  settle(qc, await callMain(window.api.closed.reopenLast()))
}

/** The "Reopen" button of a "Closed <name>" toast: exactly that entry */
export async function reopenEntry(qc: QueryClient, entryId: string): Promise<void> {
  settle(qc, await callMain(window.api.closed.reopen(entryId)))
}

export async function closeSessionWithToast(qc: QueryClient, session: Session): Promise<void> {
  const result = await callMain(window.api.session.close(session.id))
  if (!result) return
  refresh(qc, session.id)
  toast({
    title: `Closed ${result.name}`,
    action: (
      <ToastAction altText="Reopen" data-testid="toast-reopen" onClick={() => void reopenEntry(qc, result.entryId)}>
        Reopen
      </ToastAction>
    )
  })
}

export async function deleteSessionPermanently(qc: QueryClient, session: Session): Promise<void> {
  const deleted = await callMain(window.api.session.delete(session.id))
  if (deleted === undefined) return
  refresh(qc, session.id)
  // false: it was already gone
  if (deleted) toast({ title: `Deleted ${session.name}` })
}
