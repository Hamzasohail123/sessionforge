import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateState } from '../../../main/types'

const KEY = ['update-state'] as const

/** Main's update state: pulled once, then kept current by 'update:state' pushes. */
export function useUpdateState() {
  const queryClient = useQueryClient()
  const api = window.api.update as typeof window.api.update | undefined
  useEffect(() => {
    if (!api) return
    return api.onState((state) => queryClient.setQueryData(KEY, state))
  }, [api, queryClient])
  return useQuery<UpdateState | null>({
    queryKey: KEY,
    queryFn: () => (api ? api.getState() : null),
    enabled: !!api
  })
}

/** Replace the cached state with one main returned */
export function useSetUpdateState() {
  const queryClient = useQueryClient()
  return (state: UpdateState | undefined) => {
    if (state) queryClient.setQueryData(KEY, state)
  }
}
