import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'

interface Props {
  sessionName: string | null
  onCancel: () => void
  onConfirm: (typed: string) => void
}

/** Typed confirmation before agents may control a production session (main checks it again). */
export function ProductionGrantDialog({ sessionName, onCancel, onConfirm }: Props) {
  const [typed, setTyped] = useState('')
  useEffect(() => setTyped(''), [sessionName])
  return (
    <Dialog open={sessionName !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Allow agent control of a production session?</DialogTitle>
          <DialogDescription>
            {sessionName} is a production session. Allowing control lets AI agents click, type and send write
            requests there until SessionForge restarts. Type the session name to confirm.
          </DialogDescription>
        </DialogHeader>
        <Input
          data-testid="prod-confirm-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={sessionName ?? ''}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            data-testid="prod-confirm"
            variant="destructive"
            disabled={typed.trim() !== sessionName}
            onClick={() => onConfirm(typed)}
          >
            Allow control until restart
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
