import { toast } from '../components/ui/use-toast'

/** Strip Electron's "Error invoking remote method '<channel>': Error: " prefix from a main-process error, so the message reads as main wrote it. */
export function getMainErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  // Electron prefixes handler errors with "Error invoking remote method '<channel>': Error: "
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Run a main-process call; a rejection is logged and shown as a toast instead of failing silently. */
export async function callMain<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch (err) {
    console.error('[ipc]', err)
    toast({ variant: 'destructive', title: 'Action failed', description: getMainErrorMessage(err) })
  }
  return undefined
}
