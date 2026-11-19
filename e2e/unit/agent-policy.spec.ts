import { test, expect } from '@playwright/test'
import { AgentPolicy, effectiveGrant, type PolicySession } from '../../src/main/agent/policy'
import { AgentError } from '../../src/main/agent/errors'
import type { AgentGrant } from '../../src/main/agent/types'
import type { EnvTag } from '../../src/main/types'

function setup() {
  const rows = new Map<string, AgentGrant>()
  const sessions: PolicySession[] = [
    { id: 'a', name: 'Alice', env: 'local' },
    { id: 'p', name: 'Prod', env: 'production' }
  ]
  let changes = 0
  const policy = new AgentPolicy(
    {
      getAgentGrants: () => [...rows].map(([sessionId, level]) => ({ sessionId, level })),
      setAgentGrant: (id, level) => void rows.set(id, level)
    },
    { getSession: (id) => sessions.find((s) => s.id === id), getAllSessions: () => sessions },
    () => changes++
  )
  return { rows, policy, changes: () => changes }
}

const code = (fn: () => unknown) => {
  try {
    fn()
    return 'ok'
  } catch (e) {
    return e instanceof AgentError ? e.code : (e as Error).message
  }
}

test('effectiveGrant table', () => {
  const envs: EnvTag[] = ['local', 'staging', 'production', 'custom']
  for (const env of envs)
    for (const stored of ['hidden', 'read', 'control'] as AgentGrant[])
      for (const elevated of [false, true]) {
        const want = env === 'production' && stored === 'control' && !elevated ? 'read' : stored
        expect(effectiveGrant(stored, env, elevated), `${env}/${stored}/${elevated}`).toBe(want)
      }
})

test('default read; read refuses control; hidden and unknown look the same', () => {
  const { policy } = setup()
  expect(policy.effective('a')).toBe('read')
  expect(code(() => policy.check('a', 'read'))).toBe('ok')
  expect(code(() => policy.check('a', 'control'))).toBe('permission_denied')
  policy.setGrant('a', 'hidden')
  expect(code(() => policy.check('a', 'read'))).toBe('unknown_session')
  expect(code(() => policy.check('nope', 'read'))).toBe('unknown_session')
})

test('production confirm: exact name only, trimmed; capped without elevation', () => {
  const { policy, rows } = setup()
  expect(code(() => policy.setGrant('p', 'control'))).toContain('Type the session name')
  expect(code(() => policy.setGrant('p', 'control', 'prod'))).toContain('Type the session name')
  rows.set('p', 'control') // stored before a restart
  expect(code(() => policy.check('p', 'control'))).toBe('production_read_only')
  expect(policy.grantOf('p')).toMatchObject({ productionCapped: true, elevated: false, effective: 'read' })
  policy.setGrant('p', 'control', '  Prod ')
  expect(code(() => policy.check('p', 'control'))).toBe('ok')
  expect(policy.grantOf('p')).toMatchObject({ elevated: true, productionCapped: false })
})

test('stop resets to read, clears elevation and aborts registered controllers', () => {
  const { policy, rows, changes } = setup()
  policy.setGrant('p', 'control', 'Prod')
  const c1 = new AbortController()
  const c2 = new AbortController()
  policy.register(['p'], c1)
  const off = policy.register(['a'], c2)
  policy.stop('p')
  expect(rows.get('p')).toBe('read')
  expect(policy.grantOf('p')?.elevated).toBe(false)
  expect(c1.signal.aborted).toBe(true)
  expect((c1.signal.reason as AgentError).code).toBe('stopped')
  expect(c2.signal.aborted).toBe(false)
  off()
  expect(policy.inflightCount).toBe(1)
  expect(changes()).toBeGreaterThan(0)
})

test('forgetElevation caps a production session again; the stored grant stays', () => {
  const { policy, rows } = setup()
  policy.setGrant('p', 'control', 'Prod')
  expect(policy.effective('p')).toBe('control')
  policy.forgetElevation('p')
  expect(policy.effective('p')).toBe('read')
  expect(policy.grantOf('p')).toMatchObject({ stored: 'control', productionCapped: true, elevated: false })
  expect(rows.get('p')).toBe('control')
})

test('downgrade aborts with grant_changed', () => {
  const { policy } = setup()
  policy.setGrant('a', 'control')
  const c = new AbortController()
  policy.register(['a'], c)
  policy.setGrant('a', 'read')
  expect((c.signal.reason as AgentError).code).toBe('grant_changed')
})
