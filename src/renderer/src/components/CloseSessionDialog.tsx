import { useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { useViewOverlay } from '../hooks/useViewOverlay'
import { closeSessionWithToast, deleteSessionPermanently } from '../lib/recently-closed'
import type { Session } from '../../../main/types'

interface CloseSessionDialogProps {
  /** The session to close; null when the dialog is closed */
  session: Session | null
  onOpenChange: (open: boolean) => void
}

/** The SessionBar x: close (reopenable with Cmd/Ctrl+Shift+T), or delete with its storage. */
export function CloseSessionDialog({ session, onOpenChange }: CloseSessionDialogProps) {
  // Page views draw above the DOM, so hide them while the dialog is open
  useViewOverlay(!!session)
  const queryClient = useQueryClient()
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Keeps the title during the closing animation
  const last = useRef<Session | null>(null)
  if (session) last.current = session
  const shown = session ?? last.current

  const close = () => {
    if (!session) return
    onOpenChange(false)
    void closeSessionWithToast(queryClient, session)
  }
  const remove = () => {
    if (!session) return
    onOpenChange(false)
    void deleteSessionPermanently(queryClient, session)
  }

  return (
    <Dialog open={!!session} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="close-dialog"
        className="max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          confirmRef.current?.focus()
        }}
        // Focus must not go back to the x, which may be gone (and must not show a ring on a session)
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="pr-6 leading-snug break-words">Close session "{shown?.name}"?</DialogTitle>
          <DialogDescription>
            Its tabs close. Your logins are kept so you can reopen it with Ctrl+Shift+T (Cmd+Shift+T on Mac).
            <span className="mt-1 block">SessionForge keeps your last 10 closed sessions.</span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-3 sm:items-end sm:justify-between sm:space-x-0">
          <div className="flex flex-col items-start gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="close-dialog-delete"
              className="-ml-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={remove}
            >
              Delete permanently
            </Button>
            <p className="text-xs text-muted-foreground">Removes its cookies and storage. It can't be reopened.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" data-testid="close-dialog-cancel" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button ref={confirmRef} type="button" data-testid="close-dialog-confirm" onClick={close}>
              Close session
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
