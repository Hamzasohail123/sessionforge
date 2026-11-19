// The 17 Agent Bridge tools (design §9). Each tool resolves its targets and checks grants in
// prepare() (before any tab precondition), then does the work in run().
import { nativeImage, session as electronSession } from 'electron'
import { z } from 'zod'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { isHttpUrl } from '../import-payload'
import type { LayoutMode, PaneId, Session } from '../types'
import type { AgentBridge } from './mcp-server'
import { AgentError } from './errors'
import { READ, WRITE } from './annotations'
import { wrapUntrusted } from './untrusted'
import { cut, redactUrl } from './redact'
import { checkAgentUrl, isSelfTarget, SELF_TARGET_MESSAGE } from './url-guard'
import { choosePane, paneNumber, planLayout } from './placement'
import { parsePress } from './keys'
import { composite, type CompositeItem } from './composite'
import { columnOut, summarize, toDiffColumn, type RawColumn } from './diff'
import { formatSnapshot } from './snapshot-format'
import {
  FocusResult,
  PrepareResult,
  ProbeResult,
  SelectResult,
  SnapshotResult,
  ValueResult,
  focusScript,
  prepareActionScript,
  probeScript,
  selectContentScript,
  selectScript,
  snapshotScript,
  valueScript,
  type Target
} from './page-scripts'
import {
  clickAt,
  loadWaiter,
  runInPage,
  scriptFailError,
  sendKeys,
  settle,
  sleep,
  throwIfAborted,
  withSignal,
  type LoadOutcome
} from './page-actions'
import { isForbiddenHeader, runColumn } from './request-as'
import { getChromeUserAgent } from '../user-agent'
import { LIMITS } from './config'

// ---------------------------------------------------------------- shared inputs (§9.1)

const SessionArg = z.string().trim().min(1).max(200).describe('Session name (case-insensitive) or id, from list_sessions')
const TabArg = z.string().uuid().optional().describe('Tab id from list_sessions; default: the tab shown in a pane')
const RefArg = z.string().regex(/^e\d{1,9}$/).optional().describe('Element ref from snapshot, e.g. "e12"')
const SelectorArg = z
  .string()
  .min(1)
  .max(1000)
  .optional()
  .describe('CSS selector (searches open shadow roots and same-origin iframes)')
const PaneArg = z.number().int().min(1).max(4)
const Cursor = z.number().int().min(0).optional().describe('next_cursor from the previous call')
const ModeArg = z.enum(['single', 'columns', 'rows', 'grid'])
const AgentUrl = z.string().max(8192).refine(isHttpUrl, 'Only http:// and https:// URLs')
const Timeout = (def: number, max: number) => z.number().int().min(100).max(max).default(def)
const WaitUntil = z.enum(['load', 'none']).default('load').describe("'load' waits for the page to finish loading")

// ---------------------------------------------------------------- tool plumbing

export interface Prep {
  /** Target session ids (abort registry, presence, activity) */
  sessions: Session[]
  tabId?: string
  /** Presence shows Stop only for calls that need control */
  control: boolean
  /** Control actions take the tab's mutex */
  mutexTab?: string
}

export interface RunCtx {
  signal: AbortSignal
  started: number
  /** type: whether the target is a password field (until called, the text is masked in the log) */
  markPassword: (isPassword: boolean) => void
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string
  description: string
  shape: S
  annotations: ToolAnnotations
  refine?: (args: z.infer<z.ZodObject<S>>) => void
  prepare: (b: AgentBridge, args: z.infer<z.ZodObject<S>>) => Prep | Promise<Prep>
  run: (b: AgentBridge, args: z.infer<z.ZodObject<S>>, prep: Prep, ctx: RunCtx) => Promise<CallToolResult>
}

function def<S extends z.ZodRawShape>(d: ToolDef<S>): ToolDef {
  return d as unknown as ToolDef
}

const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] })
const wrapped = (label: string, value: unknown): CallToolResult =>
  text(wrapUntrusted(label, JSON.stringify(value, null, 2)))


function exactlyOne(args: Record<string, unknown>, keys: string[], what: string): void {
  const n = keys.filter((k) => args[k] !== undefined && args[k] !== false).length
  if (n !== 1) throw new AgentError('invalid_arguments', `Give exactly one of ${what}.`)
}

function targetOf(args: { ref?: string; selector?: string }): { target: Target; what: string } {
  if (args.ref) return { target: { ref: args.ref }, what: args.ref }
  return { target: { selector: args.selector! }, what: `selector ${JSON.stringify(cut(args.selector!, 80))}` }
}

function tabLabel(s: Session, tabId: string): string {
  return `session "${s.name}", tab ${tabId}`
}

function pageInfo(b: AgentBridge, tabId: string): { url: string; title: string } {
  const wc = b.wm.getLiveWebContents(tabId)
  const t = b.wm.listTabs().find((x) => x.id === tabId)
  return { url: redactUrl(wc?.getURL() || t?.url || ''), title: cut(wc?.getTitle() || t?.title || '', 200) }
}

function loadFields(o: LoadOutcome): Record<string, unknown> {
  return o.load === 'failed' ? { load: 'failed', error: o.description } : { load: o.load }
}

async function waitLoad(
  b: AgentBridge,
  tabId: string,
  start: number,
  waitUntil: 'load' | 'none',
  timeoutMs: number,
  signal: AbortSignal,
  navigate: () => void
): Promise<LoadOutcome> {
  const wc = b.wm.getOrCreateWebContents(tabId)
  const waiter = loadWaiter(wc, () => b.blockedSince(tabId, start))
  b.agentNav.add(tabId)
  navigate()
  if (waitUntil === 'none') {
    waiter.dispose()
    return { load: 'timeout' }
  }
  return waiter.wait(timeoutMs, signal)
}

/** Prepare (resolve + check + scroll + hit-test) an element and return its point. */
async function prepareElement(
  b: AgentBridge,
  tabId: string,
  args: { ref?: string; selector?: string; force?: boolean },
  needEditable: boolean,
  signal: AbortSignal
) {
  const wc = b.requireLive(tabId)
  const { target, what } = targetOf(args)
  const r = await runInPage(wc, prepareActionScript(target, { force: !!args.force, needEditable }), PrepareResult, {
    signal,
    name: 'prepareAction'
  })
  if (!r.ok) throw scriptFailError(r, what)
  return { wc, target, what, point: r }
}

// ---------------------------------------------------------------- tools

export function buildTools(): ToolDef[] {
  return [
    def({
      name: 'list_sessions',
      description:
        "List the user's browser sessions (already logged in) with their tabs and your access (read or control). Call this first and use sessions by name.",
      shape: {},
      annotations: READ,
      prepare: () => ({ sessions: [], control: false }),
      run: async (b) => {
        const layout = b.wm.getLayoutState()
        const tabs = b.wm.listTabs()
        const sessions = b.sm
          .getAllSessions()
          .filter((s) => b.policy.isVisible(s.id))
          .map((s) => {
            const g = b.policy.grantOf(s.id)!
            return {
              name: s.name,
              id: s.id,
              env: s.env,
              color: s.color,
              agent_access: g.effective,
              production_capped: g.productionCapped,
              tabs: tabs
                .filter((t) => t.sessionId === s.id)
                .sort((a, c) => a.order - c.order)
                .map((t) => ({
                  tab_id: t.id,
                  url: redactUrl(t.url),
                  title: cut(t.title, 200),
                  pane: t.paneId ? paneNumber(t.paneId) : null,
                  loading: t.isLoading
                }))
            }
          })
        return wrapped('session list', { layout_mode: layout.mode, sessions })
      }
    }),

    def({
      name: 'open',
      description:
        'Open a URL in a session and show it in a pane (reuses the session tab unless new_tab). Needs control access. Call list_sessions first.',
      shape: {
        session: SessionArg,
        url: AgentUrl,
        pane: PaneArg.optional().describe('Pane 1-4 (default: chosen automatically)'),
        new_tab: z.boolean().default(false),
        wait_until: WaitUntil,
        timeout_ms: Timeout(15_000, 60_000)
      },
      annotations: WRITE,
      prepare: (b, a) => {
        const s = b.resolveSession(a.session)
        b.policy.check(s.id, 'control')
        b.guardUrl(a.url, s)
        choosePane(b.placeState(), s.id, (id) => b.policy.canControl(id), a.pane)
        return { sessions: [s], control: true }
      },
      run: async (b, a, prep, ctx) => {
        const s = prep.sessions[0]
        const choice = choosePane(b.placeState(), s.id, (id) => b.policy.canControl(id), a.pane)
        b.touch(s.id)
        if (choice.grow) b.wm.setMode(choice.grow)
        const shown = b.wm.getLayoutState().panes.find((p) => p.paneId === choice.paneId)
        let tabId: string
        let reused = false
        let outcome: LoadOutcome
        if (!a.new_tab && shown?.tabId && shown.sessionId === s.id) {
          tabId = shown.tabId
          reused = true
        } else {
          const reusable = a.new_tab ? null : b.wm.pickReusableTab(s.id)
          if (reusable) {
            tabId = reusable
            reused = true
            b.wm.assignTab(choice.paneId, tabId)
          } else {
            const tab = await b.wm.createTab(s.id, a.url, { assign: 'none' })
            tabId = tab.id
            b.wm.assignTab(choice.paneId, tabId)
            b.agentNav.add(tabId)
            const wc = b.wm.getOrCreateWebContents(tabId)
            const waiter = loadWaiter(wc, () => b.blockedSince(tabId, ctx.started))
            if (a.wait_until === 'none') {
              waiter.dispose()
              outcome = { load: 'timeout' }
            } else {
              outcome = await waiter.wait(a.timeout_ms, ctx.signal)
            }
            const visible = await b.attachWait([tabId], ctx.signal)
            return openResult(b, tabId, outcome, visible[tabId], reused)
          }
        }
        outcome = await waitLoad(b, tabId, ctx.started, a.wait_until, a.timeout_ms, ctx.signal, () =>
          b.wm.navigateTo(tabId, a.url)
        )
        const visible = await b.attachWait([tabId], ctx.signal)
        return openResult(b, tabId, outcome, visible[tabId], reused)
      }
    }),

    def({
      name: 'navigate',
      description: 'Navigate a session tab to a URL. Needs control access. Call list_sessions first.',
      shape: { session: SessionArg, tab: TabArg, url: AgentUrl, wait_until: WaitUntil, timeout_ms: Timeout(15_000, 60_000) },
      annotations: WRITE,
      prepare: (b, a) => {
        const s = b.resolveSession(a.session)
        b.policy.check(s.id, 'control')
        const tabId = b.resolveTab(s, a.tab)
        b.guardUrl(a.url, s)
        return { sessions: [s], tabId, control: true, mutexTab: tabId }
      },
      run: async (b, a, prep, ctx) => {
        const tabId = prep.tabId!
        b.touch(prep.sessions[0].id)
        const outcome = await waitLoad(b, tabId, ctx.started, a.wait_until, a.timeout_ms, ctx.signal, () =>
          b.wm.navigateTo(tabId, a.url)
        )
        const pane = b.wm.listTabs().find((t) => t.id === tabId)?.paneId
        return wrapped(tabLabel(prep.sessions[0], tabId), {
          tab_id: tabId,
          pane: pane ? paneNumber(pane) : null,
          ...pageInfo(b, tabId),
          ...loadFields(outcome),
          visible: b.wm.isTabAttached(tabId)
        })
      }
    }),

    def({
      name: 'back',
      description: 'Go back in a session tab history. Needs control access.',
      shape: { session: SessionArg, tab: TabArg, wait_until: WaitUntil, timeout_ms: Timeout(15_000, 60_000) },
      annotations: WRITE,
      prepare: (b, a) => {
        const s = b.resolveSession(a.session)
        b.policy.check(s.id, 'control')
        const tabId = b.resolveTab(s, a.tab)
        return { sessions: [s], tabId, control: true, mutexTab: tabId }
      },
      run: async (b, a, prep, ctx) => {
        const tabId = prep.tabId!
        const wc = b.wm.getOrCreateWebContents(tabId)
        if (!wc.navigationHistory.canGoBack()) {
          return wrapped(tabLabel(prep.sessions[0], tabId), { navigated: false, ...pageInfo(b, tabId) })
        }
        b.touch(prep.sessions[0].id)
        const outcome = await waitLoad(b, tabId, ctx.started, a.wait_until, a.timeout_ms, ctx.signal, () =>
          b.wm.goBack(tabId)
        )
        return wrapped(tabLabel(prep.sessions[0], tabId), { navigated: true, ...pageInfo(b, tabId), ...loadFields(outcome) })
      }
    }),

    def({
      name: 'reload',
      description: 'Reload a session tab. Needs control access.',
      shape: {
        session: SessionArg,
        tab: TabArg,
        ignore_cache: z.boolean().default(false),
        wait_until: WaitUntil,
        timeout_ms: Timeout(15_000, 60_000)
      },
      annotations: WRITE,
      prepare: (b, a) => {
        const s = b.resolveSession(a.session)
        b.policy.check(s.id, 'control')
        const tabId = b.resolveTab(s, a.tab)
        return { sessions: [s], tabId, control: true, mutexTab: tabId }
      },
      run: async (b, a, prep, ctx) => {
        const tabId = prep.tabId!
        b.touch(prep.sessions[0].id)
        const outcome = await waitLoad(b, tabId, ctx.started, a.wait_until, a.timeout_ms, ctx.signal, () =>
          a.ignore_cache ? b.wm.reloadIgnoringCache(tabId) : b.wm.reload(tabId)
        )
        return wrapped(tabLabel(prep.sessions[0], tabId), { ...pageInfo(b, tabId), ...loadFields(outcome) })
      }
    }),

    def({
      name: 'snapshot',
      description:
        'Compact outline of the page with stable element refs for click/type/select/press. Prefer this over screenshot. Needs read access.',
      shape: {
        session: SessionArg,
        tab: TabArg,
        interactive_only: z.boolean().default(false),
        max_chars: z.number().int().min(500).max(100_000).default(20_000)
      },
      annotations: READ,
      prepare: (b, a) => {
        const s = b.resolveSession(a.session)
        b.policy.check(s.id, 'read')
        return { sessions: [s], tabId: b.resolveTab(s, a.tab), control: false }
      },
      run: async (b, a, prep, ctx) => {
        const tabId = prep.tabId!
        const wc = b.requireLive(tabId)
        const base = b.refBase.get(tabId) ?? 1
        const snap = await runInPage(
          wc,
          snapshotScript({ base, interactiveOnly: a.interactive_only, maxChars: a.max_chars }),
          SnapshotResult,
          { signal: ctx.signal, name: 'snapshot' }
        )
        if (snap.next < base) throw new AgentError('page_error', 'Unexpected result from page script.')
        b.refBase.set(tabId, snap.next)
        return text(
          wrapUntrusted(
            tabLabel(prep.sessions[0], tabId),
            formatSnapshot({ ...snap, url: redactUrl(snap.url) }, a.max_chars)
          )
        )
      }
    }),

    def({
      name: 'click',
      description:
        'Click an element (ref from snapshot, or a CSS selector) with a real mouse event. The tab must be shown in a pane. Needs control access.',
      shape: {
        session: SessionArg,
        tab: TabArg,
        ref: RefArg,
        selector: SelectorArg,
        click_count: z.union([z.literal(1), z.literal(2)]).default(1),
        force: z.boolean().default(false).describe('Click even if another element covers it')
      },
      annotations: WRITE,
      refine: (a) => exactlyOne(a, ['ref', 'selector'], 'ref or selector'),
      prepare: (b, a) => {
        const s = b.resolveSession(a.session)
        b.policy.check(s.id, 'control')
        const tabId = b.resolveTab(s, a.tab)
        b.requireInteractive(tabId)
        return { sessions: [s], tabId, control: true, mutexTab: tabId }
      },
      run: async (b, a, prep, ctx) => {
        const tabId = prep.tabId!
        b.touch(prep.sessions[0].id)
        const { wc, point } = await prepareElement(b, tabId, a, false, ctx.signal)
        b.requireInteractive(tabId)
        b.touch(prep.sessions[0].id)
        const at = await clickAt(wc, point.x, point.y, a.click_count, ctx.signal, b.viewSize(tabId))
        const { navigationStarted } = await settle(wc, ctx.signal)
        const blocked = b.blockedSince(tabId, ctx.started) !== null
        return wrapped(tabLabel(prep.sessions[0], tabId), {
          clicked: true,
          x: at.x,
          y: at.y,
          navigation_started: navigationStarted,
          ...(blocked ? { navigation_blocked: true } : {}),
          url: pageInfo(b, tabId).url
        })
      }
    }),

    def({
      name: 'type',
      description:
        'Type text into a text field (ref or selector); clears it first unless clear is false; submit presses Enter. The tab must be shown in a pane. Needs control access.',
      shape: {
        session: SessionArg,
        tab: TabArg,
        ref: RefArg,
        selector: SelectorArg,
        text: z.string().max(10_000),
        clear: z.boolean().default(true),
        submit: z.boolean().default(false)
      },
      annotations: WRITE,
      refine: (a) => exactlyOne(a, ['ref', 'selector'], 'ref or selector'),
      prepare: (b, a) => {
        const s = b.resolveSession(a.session)
        b.policy.check(s.id, 'control')
        const tabId = b.resolveTab(s, a.tab)
        b.requireInteractive(tabId)
        return { sessions: [s], tabId, control: true, mutexTab: tabId }
      },
      run: async (b, a, prep, ctx) => {
        const tabId = prep.tabId!
        b.touch(prep.sessions[0].id)
        const { wc, point, target } = await prepareElement(b, tabId, a, true, ctx.signal)
        ctx.markPassword(point.isPassword)
        b.requireInteractive(tabId)
        await clickAt(wc, point.x, point.y, 1, ctx.signal, b.viewSize(tabId))
        await sleep(50, ctx.signal)
        if (a.clear) {
          const r = await runInPage(wc, selectContentScript(target), FocusResult, { signal: ctx.signal, name: 'selectContent' })
          if (!r.ok) throw scriptFailError(r, a.ref ?? 'selector')
        }
        b.touch(prep.sessions[0].id)
        if (a.text.length > 0) {
          let timer: NodeJS.Timeout | undefined
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new AgentError('page_unresponsive', 'The page did not accept the text in time.')),
              LIMITS.pageScriptTimeoutMs
            )
          })
          try {
            await withSignal(Promise.race([wc.insertText(a.text), timeout]), ctx.signal)
          } finally {
            clearTimeout(timer)
          }
        } else if (a.clear) {
          sendKeys(wc, parsePress('Backspace').events, ctx.signal)
        }
        if (a.submit) {
          sendKeys(wc, parsePress('Enter').events, ctx.signal)
          await settle(wc, ctx.signal)
        } else {
          await sleep(50, ctx.signal)
        }
        const out: Record<string, unknown> = { typed_chars: [...a.text].length }
        if (!point.isPassword && !a.submit) {
          const v = await runInPage(wc, valueScript(target), ValueResult, { signal: ctx.signal, name: 'value' }).catch(
            () => null
          )
          if (v && !v.isPassword && v.value !== a.text) out.value_after = cut(v.value, 2000)
        }
        return out.value_after !== undefined ? wrapped(tabLabel(prep.sessions[0], tabId), out) : text(JSON.stringify(out))
      }
    }),

    def({
      name: 'select',
      description: 'Choose option(s) of a <select> by value or label (ref or selector). Needs control access.',
      shape: {
        session: SessionArg,
        tab: TabArg,
        ref: RefArg,
        selector: SelectorArg,
        values: z.array(z.string().max(500)).min(1).max(50)
      },
      annotations: WRITE,
      refine: (a) => exactlyOne(a, ['ref', 'selector'], 'ref or selector'),
      prepare: (b, a) => {
        const s = b.resolveSession(a.session)
        b.policy.check(s.id, 'control')
        const tabId = b.resolveTab(s, a.tab)
        return { sessions: [s], tabId, control: true, mutexTab: tabId }
      },
      run: async (b, a, prep, ctx) => {
        const tabId = prep.tabId!
        const wc = b.requireLive(tabId)
        const { target, what } = targetOf(a)
        b.touch(prep.sessions[0].id)
        const r = await runInPage(wc, selectScript(target, a.values), SelectResult, { signal: ctx.signal, name: 'select' })
        if (!r.ok) throw scriptFailError(r, what)
        return wrapped(tabLabel(prep.sessions[0], tabId), { selected: r.selected })
      }
    }),

    def({
      name: 'press',
      description:
        'Press one key (Enter, Tab, Escape, arrows, a character…) optionally with Shift, or Control/Meta with a, z, y, Enter. Optional ref/selector is focused first. Needs control access.',
      shape: {
        session: SessionArg,
        tab: TabArg,
        key: z.string().min(1).max(12),
        modifiers: z.array(z.enum(['Shift', 'Control', 'Meta'])).max(3).optional(),
        ref: RefArg,
        selector: SelectorArg
      },
      annotations: WRITE,
      refine: (a) => {
        if (a.ref && a.selector) throw new AgentError('invalid_arguments', 'Give ref or selector, not both.')
        parsePress(a.key, a.modifiers)
      },
      prepare: (b, a) => {
        const s = b.resolveSession(a.session)
        b.policy.check(s.id, 'control')
        const tabId = b.resolveTab(s, a.tab)
        b.requireInteractive(tabId)
        return { sessions: [s], tabId, control: true, mutexTab: tabId }
      },
      run: async (b, a, prep, ctx) => {
        const tabId = prep.tabId!
        const wc = b.requireLive(tabId)
        const { label, events } = parsePress(a.key, a.modifiers)
        if (a.ref || a.selector) {
          const { target, what } = targetOf(a)
          const r = await runInPage(wc, focusScript(target), FocusResult, { signal: ctx.signal, name: 'focus' })
          if (!r.ok) throw scriptFailError(r, what)
        }
        b.requireInteractive(tabId)
        b.touch(prep.sessions[0].id)
        sendKeys(wc, events, ctx.signal)
        await settle(wc, ctx.signal)
        return text(JSON.stringify({ pressed: label }))
      }
    }),

    def({
      name: 'wait_for',
      description:
        'Wait until text or a selector is present (or absent), the URL contains a string, or the network is idle. Give exactly one condition. Needs read access.',
      shape: {
        session: SessionArg,
        tab: TabArg,
        text: z.string().min(1).max(1000).optional(),
        selector: z.string().min(1).max(1000).optional(),
        url_contains: z.string().min(1).max(2000).optional(),
        network_idle: z.literal(true).optional(),
        state: z.enum(['present', 'absent']).default('present'),
        timeout_ms: Timeout(5000, 30_000)
      },
      annotations: READ,
      refine: (a) => exactlyOne(a, ['text', 'selector', 'url_contains', 'network_idle'], 'text, selector, url_contains or network_idle'),
      prepare: (b, a) => {
        const s = b.resolveSession(a.session)
        b.policy.check(s.id, 'read')
        return { sessions: [s], tabId: b.resolveTab(s, a.tab), control: false }
      },
      run: async (b, a, prep, ctx) => {
        const tabId = prep.tabId!
        b.requireLive(tabId)
        if (!b.waitGate.tryEnter()) {
          throw new AgentError('busy', 'Too many wait_for calls are running (max 4).', 'Retry after one finishes.')
        }
        try {
          const want = a.state === 'present'
          const deadline = ctx.started + a.timeout_ms
          let idleSince: number | null = null
          for (;;) {
            throwIfAborted(ctx.signal)
            const wc = b.requireLive(tabId)
            // null: the probe could not run (navigation in progress), which never counts as a match
            let hit: boolean | null
            if (a.url_contains !== undefined) hit = redactUrl(wc.getURL()).includes(a.url_contains)
            else if (a.network_idle) {
              const idle = b.networkLog.inFlight(tabId) === 0
              idleSince = idle ? (idleSince ?? Date.now()) : null
              hit = idleSince !== null && Date.now() - idleSince >= 500
            } else {
              const probe = a.text !== undefined ? { text: a.text } : { selector: a.selector! }
              hit = await runInPage(wc, probeScript(probe), ProbeResult, {
                signal: ctx.signal,
                name: 'probe',
                timeoutMs: 2000
              }).catch((e) => {
                if (e instanceof AgentError && (e.code === 'page_unresponsive' || e.code === 'page_error')) return null
                throw e
              })
            }
            if (hit !== null && hit === want) {
              return wrapped(tabLabel(prep.sessions[0], tabId), {
                matched: true,
                elapsed_ms: Date.now() - ctx.started,
                url: pageInfo(b, tabId).url
              })
            }
            if (Date.now() >= deadline) {
              throw new AgentError('timeout', `Condition not met within ${a.timeout_ms} ms.`)
            }
            await sleep(Math.min(200, Math.max(10, deadline - Date.now())), ctx.signal)
          }
        } finally {
          b.waitGate.leave()
        }
      }
    }),

    def({
      name: 'screenshot',
      description:
        'PNG of a session tab, or of all panes (all_panes: true). Use snapshot for reading pages; this is for visual checks. Needs read access.',
      shape: {
        session: SessionArg.optional(),
        tab: TabArg,
        all_panes: z.boolean().default(false),
        max_width: z.number().int().min(320).max(2560).default(1280)
      },
      annotations: READ,
      refine: (a) => exactlyOne(a, ['session', 'all_panes'], 'session or all_panes: true'),
      prepare: (b, a) => {
        if (a.all_panes) return { sessions: [], control: false }
        const s = b.resolveSession(a.session!)
        b.policy.check(s.id, 'read')
        return { sessions: [s], tabId: b.resolveTab(s, a.tab), control: false }
      },
      run: async (b, a, prep, ctx) => {
        if (!a.all_panes) {
          const tabId = prep.tabId!
          const wc = b.requireLive(tabId)
          const img = await captureTab(b, tabId, wc, ctx.signal)
          if (img.isEmpty()) {
            throw new AgentError('not_visible', 'The tab is not shown in a pane, so it cannot be captured.', 'Call open or set_layout to show it.')
          }
          const png = encodePng(img, a.max_width)
          return {
            content: [
              { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
              { type: 'text', text: wrapUntrusted(tabLabel(prep.sessions[0], tabId), JSON.stringify(pageInfo(b, tabId))) }
            ]
          }
        }
        const views = b.wm.getAttachedPaneViews()
        if (views.length === 0) throw new AgentError('not_visible', 'No pane shows a page.', 'Call open or set_layout.')
        const caps = await Promise.all(
          views.map(async (v) => {
            if (!b.policy.isVisible(v.sessionId)) return { v, img: null }
            const wc = b.wm.getLiveWebContents(v.tabId)
            const img = wc ? await captureTab(b, v.tabId, wc, ctx.signal) : null
            return { v, img: img && !img.isEmpty() ? img : null }
          })
        )
        const withImg = caps.find((c) => c.img)
        const scale = withImg ? withImg.img!.getSize().width / Math.max(1, withImg.v.bounds.width) : 1
        const minX = Math.min(...views.map((v) => v.bounds.x))
        const minY = Math.min(...views.map((v) => v.bounds.y))
        const maxX = Math.max(...views.map((v) => v.bounds.x + v.bounds.width))
        const maxY = Math.max(...views.map((v) => v.bounds.y + v.bounds.height))
        const W = Math.max(1, Math.round((maxX - minX) * scale))
        const H = Math.max(1, Math.round((maxY - minY) * scale))
        const items: CompositeItem[] = caps.map(({ v, img }) => {
          const item: CompositeItem = {
            x: (v.bounds.x - minX) * scale,
            y: (v.bounds.y - minY) * scale,
            width: v.bounds.width * scale,
            height: v.bounds.height * scale
          }
          if (img) {
            const size = img.getSize()
            item.bitmap = img.toBitmap()
            item.bitmapWidth = size.width
            item.bitmapHeight = size.height
          }
          return item
        })
        const canvas = nativeImage.createFromBitmap(composite(items, W, H), { width: W, height: H })
        const png = encodePng(canvas, a.max_width)
        const caption = caps.map(({ v }) => {
          const n = paneNumber(v.paneId)
          if (!b.policy.isVisible(v.sessionId)) return `pane ${n}: (not shared with agents)`
          const s = b.sm.getSession(v.sessionId)
          return `pane ${n}: ${s?.name ?? '?'} ${pageInfo(b, v.tabId).url}`
        })
        return {
          content: [
            { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
            { type: 'text', text: wrapUntrusted('all panes', caption.join('\n')) }
          ]
        }
      }
    }),

    def({
      name: 'console_logs',
      description: 'Console messages of a session tab (since the bridge was enabled). Use since: next_cursor to get only new ones. Needs read access.',
      shape: {
        session: SessionArg,
        tab: TabArg,
        level: z.enum(['debug', 'info', 'warning', 'error']).optional().describe('Minimum level'),
        since: Cursor,
        limit: z.number().int().min(1).max(500).default(100)
      },
      annotations: READ,
      prepare: (b, a) => {
        const s = b.resolveSession(a.session)
        b.policy.check(s.id, 'read')
        return { sessions: [s], tabId: b.resolveTab(s, a.tab), control: false }
      },
      run: async (b, a, prep) => {
        const tabId = prep.tabId!
        b.requireLive(tabId)
        const r = b.consoleBuffer.query(tabId, { level: a.level, since: a.since, limit: a.limit })
        return wrapped(tabLabel(prep.sessions[0], tabId), r)
      }
    }),

    def({
      name: 'network_log',
      description:
        'Requests made by a session tab (since the bridge was enabled), with status and timing; secrets in headers are redacted. Needs read access.',
      shape: {
        session: SessionArg,
        tab: TabArg,
        since: Cursor,
        limit: z.number().int().min(1).max(500).default(100),
        url_contains: z.string().max(500).optional(),
        failed_only: z.boolean().default(false),
        include_headers: z.boolean().default(false)
      },
      annotations: READ,
      prepare: (b, a) => {
        const s = b.resolveSession(a.session)
        b.policy.check(s.id, 'read')
        return { sessions: [s], tabId: b.resolveTab(s, a.tab), control: false }
      },
      run: async (b, a, prep) => {
        const tabId = prep.tabId!
        b.requireLive(tabId)
        const r = b.networkLog.query(tabId, {
          since: a.since,
          limit: a.limit,
          urlContains: a.url_contains,
          failedOnly: a.failed_only,
          includeHeaders: a.include_headers
        })
        return wrapped(tabLabel(prep.sessions[0], tabId), r)
      }
    }),

    def({
      name: 'send_request_as',
      description:
        "Send one HTTP request as several sessions (each with its own cookies) and compare. Best for permission checks. GET/HEAD/OPTIONS need read, other methods need control. Set-Cookie updates the session.",
      shape: {
        sessions: z.array(SessionArg).min(1).max(8),
        include_no_session: z.boolean().default(false),
        method: z.enum(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
        url: AgentUrl,
        headers: z
          .record(
            z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/),
            z.string().max(8192).regex(/^[^\r\n]*$/)
          )
          .optional(),
        body: z.string().max(1024 * 1024).optional(),
        follow_redirects: z.boolean().default(false),
        max_body_chars: z.number().int().min(0).max(100_000).default(4000),
        timeout_ms: Timeout(15_000, 60_000)
      },
      annotations: WRITE,
      refine: (a) => {
        if (a.body !== undefined && (a.method === 'GET' || a.method === 'HEAD')) {
          throw new AgentError('invalid_arguments', 'GET and HEAD requests cannot have a body.')
        }
        if (a.headers && Object.keys(a.headers).length > 50) throw new AgentError('invalid_arguments', 'At most 50 headers.')
        const bad = Object.keys(a.headers ?? {}).find(isForbiddenHeader)
        if (bad) {
          throw new AgentError(
            'invalid_arguments',
            `Header '${bad}' is not allowed. Cookie comes from each session's cookie jar.`
          )
        }
      },
      prepare: (b, a) => {
        const resolved = a.sessions.map((x) => b.resolveSession(x))
        const ids = new Set(resolved.map((s) => s.id))
        if (ids.size !== resolved.length) throw new AgentError('invalid_arguments', 'Each session may be listed once.')
        if (isSelfTarget(a.url, b.ports())) throw new AgentError('url_guarded', SELF_TARGET_MESSAGE)
        const control = !['GET', 'HEAD', 'OPTIONS'].includes(a.method)
        return { sessions: resolved, control }
      },
      run: async (b, a, prep, ctx) => {
        if (!b.requestGate.tryEnter()) {
          throw new AgentError('busy', 'Two send_request_as calls are already running.', 'Retry after one finishes.')
        }
        try {
          const need = prep.control ? 'control' : 'read'
          const common = {
            method: a.method,
            url: a.url,
            headers: a.headers ?? {},
            body: a.body,
            followRedirects: a.follow_redirects,
            timeoutMs: a.timeout_ms,
            signal: ctx.signal
          }
          const jobs: Array<Promise<RawColumn>> = prep.sessions.map(async (s) => {
            try {
              b.policy.check(s.id, need)
            } catch (e) {
              return { name: s.name, sessionId: s.id, error: e instanceof AgentError ? e.code : 'internal' }
            }
            if (!checkAgentUrl(a.url, s, b.ports()).ok) return { name: s.name, sessionId: s.id, error: 'url_guarded' }
            const ses = b.sm.getElectronSession(s.id)
            if (!ses) return { name: s.name, sessionId: s.id, error: 'unknown_session' }
            return runColumn({
              ...common,
              name: s.name,
              sessionId: s.id,
              ses,
              useCookies: true,
              checkHop: (u) => (checkAgentUrl(u, s, b.ports()).ok ? null : 'url_guarded')
            })
          })
          // Write methods without cookies still need control on at least one listed session
          if (a.include_no_session && prep.control && !prep.sessions.some((s) => b.policy.canControl(s.id))) {
            jobs.push(Promise.resolve<RawColumn>({ name: 'No session', sessionId: null, error: 'permission_denied' }))
          } else if (a.include_no_session) {
            const anon = electronSession.fromPartition('sf-agent-anon')
            anon.setUserAgent(getChromeUserAgent())
            jobs.push(
              runColumn({
                ...common,
                name: 'No session',
                sessionId: null,
                ses: anon,
                useCookies: false,
                checkHop: (u) => (isSelfTarget(u, b.ports()) ? 'url_guarded' : null)
              })
            )
          }
          const cols = await Promise.all(jobs)
          throwIfAborted(ctx.signal)
          const summary = summarize(a.method, a.url, cols.map(toDiffColumn))
          const json = JSON.stringify({ columns: cols.map((c) => columnOut(c, a.max_body_chars)) }, null, 2)
          return text(summary + '\n\n' + wrapUntrusted('send_request_as responses', json))
        } finally {
          b.requestGate.leave()
        }
      }
    }),

    def({
      name: 'get_layout',
      description: 'The split layout: mode, active pane and what each pane (1-4) shows.',
      shape: {},
      annotations: READ,
      prepare: () => ({ sessions: [], control: false }),
      run: async (b) => wrapped('layout', layoutOut(b))
    }),

    def({
      name: 'set_layout',
      description:
        'Change the split layout: mode (single/columns/rows/grid), which session each pane shows, and the focused pane. Needs control on every session placed or replaced.',
      shape: {
        mode: ModeArg.optional(),
        panes: z
          .array(z.object({ pane: PaneArg, session: SessionArg.nullable() }))
          .max(4)
          .optional(),
        focus: PaneArg.optional()
      },
      annotations: WRITE,
      refine: (a) => {
        if (a.mode === undefined && a.panes === undefined && a.focus === undefined) {
          throw new AgentError('invalid_arguments', 'Give at least one of mode, panes or focus.')
        }
        const nums = (a.panes ?? []).map((p) => p.pane)
        if (new Set(nums).size !== nums.length) throw new AgentError('invalid_arguments', 'Each pane may be listed once.')
      },
      prepare: (b, a) => {
        const resolved = (a.panes ?? []).map((p) => ({
          pane: p.pane,
          session: p.session === null ? null : b.resolveSession(p.session)
        }))
        planLayout(
          b.placeState(),
          { mode: a.mode, focus: a.focus, panes: resolved.map((p) => ({ pane: p.pane, session: p.session?.id ?? null })) },
          (id) => b.policy.canControl(id)
        )
        const sessions = resolved.map((p) => p.session).filter((s): s is Session => s !== null)
        return { sessions, control: sessions.length > 0 || a.mode !== undefined }
      },
      run: async (b, a, prep, ctx) => {
        const byName = new Map(prep.sessions.map((s) => [s.id, s]))
        const resolved = (a.panes ?? []).map((p) => ({
          pane: p.pane,
          sessionId: p.session === null ? null : b.resolveSession(p.session).id
        }))
        const plan = planLayout(
          b.placeState(),
          { mode: a.mode, focus: a.focus, panes: resolved.map((p) => ({ pane: p.pane, session: p.sessionId })) },
          (id) => b.policy.canControl(id)
        )
        for (const s of byName.values()) b.touch(s.id)
        if (plan.mode) b.wm.setMode(plan.mode as LayoutMode)
        const assigned: string[] = []
        for (const as of plan.assignments) {
          if (as.sessionId === null) b.wm.assignTab(as.paneId, null)
          else if (!b.wm.getLayoutState().panes.some((p) => p.paneId === as.paneId && p.sessionId === as.sessionId)) {
            // A tab of this session already shown in another pane moves here, instead of a new tab
            const shown = b.wm.getLayoutState().panes.find((p) => p.sessionId === as.sessionId && p.tabId)
            if (shown?.tabId) {
              b.wm.assignTab(as.paneId, shown.tabId)
              assigned.push(shown.tabId)
            } else {
              const st = await b.wm.openSession(as.paneId, as.sessionId)
              const tabId = st.panes.find((p) => p.paneId === as.paneId)?.tabId
              if (tabId) assigned.push(tabId)
            }
          } else {
            const st = await b.wm.openSession(as.paneId, as.sessionId)
            const tabId = st.panes.find((p) => p.paneId === as.paneId)?.tabId
            if (tabId) assigned.push(tabId)
          }
        }
        if (plan.focus) b.wm.focusPane(plan.focus as PaneId)
        const visible = await b.attachWait(assigned, ctx.signal)
        const out = layoutOut(b)
        const vis: Record<string, boolean> = {}
        for (const p of b.wm.getLayoutState().panes) if (p.tabId && p.tabId in visible) vis[String(paneNumber(p.paneId))] = visible[p.tabId]
        return wrapped('layout', { ...out, visible: vis })
      }
    })
  ]
}

function openResult(b: AgentBridge, tabId: string, outcome: LoadOutcome, visible: boolean, reused: boolean): CallToolResult {
  const t = b.wm.listTabs().find((x) => x.id === tabId)
  const s = t ? b.sm.getSession(t.sessionId) : undefined
  const body = {
    tab_id: tabId,
    pane: t?.paneId ? paneNumber(t.paneId) : null,
    ...pageInfo(b, tabId),
    ...loadFields(outcome),
    visible,
    reused
  }
  const r = wrapped(s ? tabLabel(s, tabId) : `tab ${tabId}`, body)
  if (!visible) r.content.push({ type: 'text', text: 'Hint: The pane is not on screen yet; retry shortly.' })
  return r
}

function layoutOut(b: AgentBridge) {
  const st = b.wm.getLayoutState()
  return {
    mode: st.mode,
    active_pane: paneNumber(st.activePaneId),
    panes: st.panes.map((p) => {
      const n = paneNumber(p.paneId)
      if (!p.sessionId || !p.tabId) return { pane: n, session: null }
      if (!b.policy.isVisible(p.sessionId)) return { pane: n, session: null, note: 'not shared with agents' }
      const s = b.sm.getSession(p.sessionId)
      return { pane: n, session: s?.name ?? null, session_id: p.sessionId, tab_id: p.tabId, ...pageInfo(b, p.tabId) }
    })
  }
}

/** capturePage is empty for detached views, and briefly for a view that was just attached. */
async function captureTab(
  b: AgentBridge,
  tabId: string,
  wc: Electron.WebContents,
  signal: AbortSignal
): Promise<Electron.NativeImage> {
  let img = await withSignal(wc.capturePage(), signal)
  for (let i = 0; i < 20 && img.isEmpty() && b.wm.isTabAttached(tabId); i++) {
    await sleep(100, signal)
    img = await withSignal(wc.capturePage(), signal)
  }
  return img
}

function encodePng(img: Electron.NativeImage, maxWidth: number): Buffer {
  let out = img
  const { width } = out.getSize()
  if (width > maxWidth) out = out.resize({ width: maxWidth })
  let png = out.toPNG()
  if (png.length > LIMITS.screenshotMaxPngBytes) {
    out = out.resize({ width: Math.max(1, Math.floor(out.getSize().width / 2)) })
    png = out.toPNG()
    if (png.length > LIMITS.screenshotMaxPngBytes) {
      throw new AgentError('too_large', 'The screenshot is too large.', 'Use a smaller max_width.')
    }
  }
  return png
}
