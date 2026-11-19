// Page work on a WebContents (design §9.2, §10): isolated-world scripts with a timeout and schema
// validation, real input events, load and settle waits.
import type { WebContents } from 'electron'
import type { z } from 'zod'
import { AGENT_WORLD_ID, LIMITS } from './config'
import { AgentError } from './errors'
import type { KeyEventPayload } from './keys'
import type { ScriptFail } from './page-scripts'

export function abortError(signal: AbortSignal): AgentError {
  const r = signal.reason
  return r instanceof AgentError ? r : new AgentError('stopped', 'The call was cancelled.')
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal))
    const onAbort = () => {
      clearTimeout(t)
      reject(abortError(signal!))
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Race a promise against the abort signal. */
export function withSignal<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      }
    )
  })
}

export async function runInPage<T>(
  wc: WebContents,
  code: string,
  schema: z.ZodType<T>,
  opts: { signal: AbortSignal; timeoutMs?: number; name: string }
): Promise<T> {
  if (wc.isDestroyed()) throw new AgentError('no_tab', 'The tab was closed.')
  throwIfAborted(opts.signal)
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new AgentError(
            'page_unresponsive',
            'The page did not respond (it may be showing an alert or be busy).',
            'Retry, or reload the page.'
          )
        ),
      opts.timeoutMs ?? LIMITS.pageScriptTimeoutMs
    )
  })
  let raw: unknown
  try {
    raw = await withSignal(
      Promise.race([wc.executeJavaScriptInIsolatedWorld(AGENT_WORLD_ID, [{ code }], true), timeout]),
      opts.signal
    )
  } catch (e) {
    if (e instanceof AgentError) throw e
    if (wc.isDestroyed()) throw new AgentError('no_tab', 'The tab was closed.')
    throw new AgentError('page_error', 'The page script failed.', undefined, String((e as Error)?.message ?? e).slice(0, 300))
  } finally {
    clearTimeout(timer)
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    console.debug(`[agent] unexpected result from page script ${opts.name}`)
    throw new AgentError('page_error', 'Unexpected result from page script.')
  }
  return parsed.data
}

type Fail = z.infer<typeof ScriptFail>

/** ScriptFail → AgentError with SessionForge text; page text goes into pageText. */
export function scriptFailError(f: Fail, what: string): AgentError {
  switch (f.code) {
    case 'stale_ref':
      return new AgentError('stale_ref', `Ref ${what} is no longer on the page.`, 'Take a new snapshot.')
    case 'not_found':
      return new AgentError('not_found', `No element matches ${what}.`, 'Take a new snapshot.')
    case 'disabled':
      return new AgentError('disabled', `Element ${what} is disabled.`)
    case 'not_visible_element':
      return new AgentError('not_visible_element', `Element ${what} has no visible box.`)
    case 'obscured':
      return new AgentError(
        'obscured',
        `Element ${what} is covered by another element.`,
        'Close the overlay first, or use force: true.',
        f.pageText
      )
    case 'not_editable':
      return new AgentError('not_editable', `Element ${what} is not a text field.`)
    case 'not_a_select':
      return new AgentError('not_a_select', `Element ${what} is not a <select>.`)
    case 'option_not_found':
      return new AgentError('option_not_found', `No option matches the requested value in ${what}.`, undefined, f.pageText)
    case 'invalid_arguments':
      return new AgentError('invalid_arguments', `Invalid target ${what} (bad selector, or several values for a single select).`)
  }
}

/** Real mouse events at a top-level CSS-pixel point (scaled by the page zoom to DIP). */
export async function clickAt(
  wc: WebContents,
  cssX: number,
  cssY: number,
  clickCount: 1 | 2,
  signal: AbortSignal,
  bounds: { width: number; height: number }
): Promise<{ x: number; y: number }> {
  const zoom = wc.getZoomFactor()
  const x = Math.round(cssX * zoom)
  const y = Math.round(cssY * zoom)
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) {
    throw new AgentError('not_visible_element', 'The element is outside the visible pane.')
  }
  throwIfAborted(signal)
  wc.sendInputEvent({ type: 'mouseMove', x, y })
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  if (clickCount === 2) {
    throwIfAborted(signal)
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 2 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 2 })
  }
  return { x, y }
}

export function sendKeys(wc: WebContents, events: KeyEventPayload[], signal: AbortSignal): void {
  for (const e of events) {
    throwIfAborted(signal)
    wc.sendInputEvent({ type: e.type, keyCode: e.keyCode, modifiers: e.modifiers })
  }
}

export type LoadOutcome = { load: 'loaded' | 'timeout' } | { load: 'failed'; description: string }

/**
 * Created before the navigation is triggered. Resolves on did-stop-loading, a main-frame failure
 * other than ERR_ABORTED, or the timeout; checks the URL-guard block first.
 */
export function loadWaiter(
  wc: WebContents,
  blocked: () => { host: string } | null
): { wait: (timeoutMs: number, signal: AbortSignal) => Promise<LoadOutcome>; dispose: () => void } {
  let result: LoadOutcome | null = null
  let notify: (() => void) | null = null
  const set = (r: LoadOutcome) => {
    if (result) return
    result = r
    notify?.()
  }
  const onStop = () => set({ load: 'loaded' })
  const onFail = (_e: unknown, code: number, desc: string, _url: string, isMainFrame: boolean) => {
    if (!isMainFrame || code === -3) return
    set({ load: 'failed', description: String(desc).slice(0, 300) })
  }
  wc.on('did-stop-loading', onStop)
  wc.on('did-fail-load', onFail)
  const dispose = () => {
    if (wc.isDestroyed()) return
    wc.removeListener('did-stop-loading', onStop)
    wc.removeListener('did-fail-load', onFail)
  }
  const wait = async (timeoutMs: number, signal: AbortSignal): Promise<LoadOutcome> => {
    try {
      await withSignal(
        new Promise<void>((resolve) => {
          if (result) return resolve()
          notify = resolve
          setTimeout(resolve, timeoutMs)
        }),
        signal
      )
      const b = blocked()
      if (b) {
        throw new AgentError('url_guarded', `The page redirected to ${b.host}, which agents may not open in this session.`)
      }
      return result ?? { load: 'timeout' }
    } finally {
      dispose()
    }
  }
  return { wait, dispose }
}

/** After a click or key: 150 ms settle; if a main-frame navigation started, wait up to 2 s for it. */
export async function settle(wc: WebContents, signal: AbortSignal): Promise<{ navigationStarted: boolean }> {
  let started = false
  let stopped = false
  const onStart = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (details.isMainFrame && !details.isSameDocument) started = true
  }
  const onStop = () => {
    stopped = true
  }
  wc.on('did-start-navigation', onStart)
  wc.on('did-stop-loading', onStop)
  try {
    await sleep(150, signal)
    if (started) {
      const deadline = Date.now() + 2000
      while (!stopped && Date.now() < deadline && !wc.isDestroyed()) await sleep(50, signal)
    }
    return { navigationStarted: started }
  } finally {
    if (!wc.isDestroyed()) {
      wc.removeListener('did-start-navigation', onStart)
      wc.removeListener('did-stop-loading', onStop)
    }
  }
}
