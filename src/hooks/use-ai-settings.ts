import { useQuery } from '@tanstack/react-query'

export interface AiSettings {
  enabled: boolean
  provider: string
  connected: boolean
  hasKey: boolean
}

async function fetchAiSettings(): Promise<AiSettings> {
  const r = await fetch('/api/ai-settings', { cache: 'no-store' })
  if (r.status === 401 || r.status === 403) throw new Error('Unauthorized')
  if (!r.ok) throw new Error('Failed to load AI settings')
  return r.json()
}

export function useAiSettings() {
  return useQuery({
    queryKey: ['ai-settings'],
    queryFn: fetchAiSettings,
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message === 'Unauthorized') return false
      return failureCount < 2
    },
  })
}