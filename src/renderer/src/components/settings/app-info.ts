import { useQuery } from '@tanstack/react-query'
import type { AppInfo } from '../../../../main/types'
export function useAppInfo() {
  return useQuery<AppInfo>({ queryKey: ['app-info'], queryFn: () => window.api.app.getInfo() })
}
