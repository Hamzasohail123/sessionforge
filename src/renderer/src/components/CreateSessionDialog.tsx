import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import type { CreateSessionInput, Session } from '../../../main/types'
import { COLORS, SESSION_NAME_MAX } from '../../../main/constants'
import { useStore } from '../store'
import { callMain, getMainErrorMessage } from '../lib/ipc'
import { useViewOverlay } from '../hooks/useViewOverlay'

interface CreateSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateSessionDialog({ open, onOpenChange }: CreateSessionDialogProps) {
  // Page views draw above the DOM, so hide them while the dialog is open
  useViewOverlay(open)
  const queryClient = useQueryClient()
  const [selectedColor, setSelectedColor] = useState(COLORS[0].value)
  const [selectedEnv, setSelectedEnv] = useState<CreateSessionInput['env']>('local')
  const [saveError, setSaveError] = useState<string | null>(null)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<{ name: string }>()

  // The dialog stays mounted while closed, so reset it each time it opens
  useEffect(() => {
    if (open) {
      setSelectedEnv('local')
      setSelectedColor(COLORS[0].value)
      setSaveError(null)
      reset()
    }
  }, [open, reset])

  const createMutation = useMutation({
    mutationFn: (input: CreateSessionInput) => window.api.session.create(input),
    onError: (error: unknown) => {
      setSaveError(getMainErrorMessage(error))
    },
    onSuccess: (session: Session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      reset()
      onOpenChange(false)
      // A new session fills the focused pane only if that pane is empty
      const layout = useStore.getState().layout
      const pane = layout?.panes.find((p) => p.paneId === layout.activePaneId)
      if (layout && pane && pane.tabId === null) {
        callMain(window.api.layout.openSession(layout.activePaneId, session.id))
      }
    }
  })

  const onSubmit = (data: { name: string }) => {
    createMutation.mutate({
      name: data.name.trim(),
      color: selectedColor,
      env: selectedEnv
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Session</DialogTitle>
          <DialogDescription>
            Create an isolated browser session with its own cookies and storage
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Session Name</Label>
            <Input
              id="name"
              placeholder="e.g., Admin User"
              maxLength={SESSION_NAME_MAX}
              aria-invalid={!!errors.name}
              aria-describedby="name-error"
              {...register('name', { validate: (v) => v.trim().length > 0 || 'Enter a session name' })}
            />
            {errors.name && (
              <p id="name-error" role="alert" className="text-sm text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex gap-2" role="group" aria-label="Color">
              {COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setSelectedColor(color.value)}
                  className="w-8 h-8 rounded-full border-2 transition-all"
                  style={{
                    backgroundColor: color.value,
                    borderColor: selectedColor === color.value ? '#000' : 'transparent'
                  }}
                  title={color.name}
                  aria-label={color.name}
                  aria-pressed={selectedColor === color.value}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="env">Environment</Label>
            <Select value={selectedEnv} onValueChange={(v) => setSelectedEnv(v as CreateSessionInput['env'])}>
              <SelectTrigger id="env">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local</SelectItem>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="production">Production</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {saveError && (
            <p role="alert" className="text-sm text-destructive">
              {saveError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              Create Session
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
