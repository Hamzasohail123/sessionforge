// agent:* IPC handlers (design §16). Zod-validated; the token never crosses IPC (copies run in main).
import { clipboard, ipcMain } from 'electron'
import { homedir } from 'os'
import { z } from 'zod'
import type { AgentBridge } from './mcp-server'
import { APPROVAL_PRESETS, EDITOR_IDS, SNIPPET_KINDS } from './types'
import { shellExport } from './snippets'
import { applyApproval, getApprovals, previewApproval, type ApprovalDeps } from './approvals'
import { editorDisplayPath, resolveConfigPaths } from './approvals/paths'
import { presetText } from './approvals/presets'
const Id = z.string().uuid()
const SetGrant = z.object({
  sessionId: Id,
  level: z.enum(['hidden', 'read', 'control']),
  confirm: z.string().max(200).optional()
})
const CopySnippet = z.object({ kind: z.enum(SNIPPET_KINDS), inlineToken: z.boolean() })
// Editor approvals: only an editor id and a preset id (plus the previewed hash) ever cross IPC; main picks the path
const ApprovalPickSchema = z.object({ editor: z.enum(EDITOR_IDS), preset: z.enum(APPROVAL_PRESETS) }).strict()
const ApprovalApplySchema = ApprovalPickSchema.extend({ expectedSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict()
function valid<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input)
  if (!r.success) {
    console.warn('[approvals] invalid input')
    throw new Error('Invalid input')
  }
  return r.data
}
export function registerAgentIpc(bridge: AgentBridge): void {
  ipcMain.handle('agent:getStatus', async () => bridge.getStatus())
  ipcMain.handle('agent:setEnabled', async (_, enabled: unknown) => bridge.setEnabled(z.boolean().parse(enabled)))
  ipcMain.handle('agent:copyToken', async () => {
    clipboard.writeText(bridge.tokenValue())
  })
  ipcMain.handle('agent:copyExportLine', async () => {
    clipboard.writeText(shellExport({ port: 0, scriptPath: '', token: bridge.tokenValue() }))
  })
  ipcMain.handle('agent:rotateToken', async () => bridge.rotateToken())
  ipcMain.handle('agent:getGrants', async () => bridge.getGrants())
  ipcMain.handle('agent:setGrant', async (_, input: unknown) => {
    const { sessionId, level, confirm } = SetGrant.parse(input)
    return bridge.setGrant(sessionId, level, confirm)
  })
  ipcMain.handle('agent:stop', async (_, sessionId: unknown) => {
    bridge.stopSession(Id.parse(sessionId))
  })
  ipcMain.handle('agent:getSnippets', async () => bridge.getSnippets(false))
  ipcMain.handle('agent:copySnippet', async (_, input: unknown) => {
    const { kind, inlineToken } = CopySnippet.parse(input)
    clipboard.writeText(bridge.getSnippets(inlineToken)[kind].text)
  })
  ipcMain.handle('agent:getActivity', async () => bridge.getActivity())
  ipcMain.handle('agent:clearActivity', async () => {
    bridge.activity.clear()
  })
  // Editor approval presets. Paths come from the environment once at startup: the injected
  // SESSIONFORGE_EDITOR_CONFIG_HOME (tests) always wins, and a relative value disables the feature.
  const paths = resolveConfigPaths(process.env, homedir())
  if (paths.error) console.error('[approvals]', paths.error)
  const deps = (): ApprovalDeps => ({
    paths,
    homedir: homedir(),
    readOnlyTools: bridge.readOnlyToolNames(),
    liveToken: bridge.tokenValue()
  })
  ipcMain.handle('agent:getApprovals', async () => getApprovals(deps()))
  ipcMain.handle('agent:previewApproval', async (_, input: unknown) =>
    previewApproval(deps(), valid(ApprovalPickSchema, input))
  )
  ipcMain.handle('agent:applyApproval', async (_, input: unknown) => applyApproval(deps(), valid(ApprovalApplySchema, input)))
  ipcMain.handle('agent:copyApprovalText', async (_, input: unknown) => {
    const { editor, preset } = valid(ApprovalPickSchema, input)
    if (paths.error) throw new Error(paths.error)
    clipboard.writeText(presetText(editor, preset, bridge.readOnlyToolNames(), editorDisplayPath(paths, editor, homedir())))
  })
}
