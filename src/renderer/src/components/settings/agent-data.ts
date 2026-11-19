// Queries shared by the Agent Bridge panels. Main pushes status, grants and activity (useAgentEvents).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '../../../../main/types'
import type {
  AgentActivityEntry,
  AgentBridgeStatus,
  AgentGrant,
  AgentSessionGrant,
  EditorApprovalInfo,
  EditorId,
  Snippet,
  SnippetKind
} from '../../../../main/agent/types'
import { toast } from '../ui/use-toast'
export const GRANT_LABELS: Record<AgentGrant, string> = {
  hidden: "Hidden — agents can't see it",
  read: "Read — look, don't touch",
  control: 'Control — click, type, navigate'
}
export const EDITORS: Record<EditorId, { label: string; http: SnippetKind; stdio: SnippetKind }> = {
  cursor: { label: 'Cursor', http: 'cursorHttp', stdio: 'cursorStdio' },
  codex: { label: 'Codex', http: 'codexHttp', stdio: 'codexStdio' },
  claude: { label: 'Claude Code', http: 'claudeHttp', stdio: 'claudeStdio' }
}
export const EDITOR_ORDER: EditorId[] = ['cursor', 'codex', 'claude']
export const copied = (what: string) => toast({ title: `${what} copied to the clipboard` })
export function statusLine(s: AgentBridgeStatus | undefined): string {
  if (!s) return '…'
  switch (s.state) {
    case 'off':
      return 'Off'
    case 'starting':
      return 'Starting…'
    case 'listening':
      return `Listening on ${s.endpoint}`
    case 'error':
      return `Error: ${s.error ?? 'unknown'}`
  }
}
export function useAgentBridgeData() {
  const queryClient = useQueryClient()
  const status = useQuery<AgentBridgeStatus>({ queryKey: ['agent-status'], queryFn: () => window.api.agent.getStatus() })
  const grants = useQuery<AgentSessionGrant[]>({ queryKey: ['agent-grants'], queryFn: () => window.api.agent.getGrants() })
  const sessions = useQuery<Session[]>({ queryKey: ['sessions'], queryFn: () => window.api.session.getAll() })
  return {
    queryClient,
    status: status.data,
    grants: grants.data ?? [],
    sessions: sessions.data ?? [],
    setStatus: (s: AgentBridgeStatus | undefined) => s && queryClient.setQueryData(['agent-status'], s),
    refreshGrants: () => queryClient.invalidateQueries({ queryKey: ['agent-grants'] })
  }
}
export function useSnippets() {
  return useQuery<Record<SnippetKind, Snippet>>({ queryKey: ['agent-snippets'], queryFn: () => window.api.agent.getSnippets() })
}
export function useActivity() {
  return useQuery<AgentActivityEntry[]>({ queryKey: ['agent-activity'], queryFn: () => window.api.agent.getActivity() })
}
export function useApprovals() {
  return useQuery<EditorApprovalInfo[]>({ queryKey: ['agent-approvals'], queryFn: () => window.api.agent.getApprovals() })
}
