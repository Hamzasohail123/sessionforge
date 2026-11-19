import { toast } from '../components/ui/use-toast'

/** Run a main-process call; a rejection is logged and shown as a toast instead of failing silently. */
export async function callMain<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch (err) {
    console.error('[ipc]', err)
    const message = err instanceof Error ? err.message : String(err)
    // Electron prefixes handler errors with "Error invoking remote method '<channel>': Error: "
    const description = message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    toast({ variant: 'destructive', title: 'Action failed', description })
    return undefined
  }
}
