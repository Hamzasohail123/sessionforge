import { useState } from 'react'
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
import { callMain } from '../lib/ipc'
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

  const { register, handleSubmit, reset } = useForm<{ name: string }>()

  const createMutation = useMutation({
    mutationFn: (input: CreateSessionInput) => window.api.session.create(input),
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
      name: data.name,
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
              {...register('name', { required: true })}
            />
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex gap-2">
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
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="env">Environment</Label>
            <Select value={selectedEnv} onValueChange={(v: any) => setSelectedEnv(v)}>
              <SelectTrigger>
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
