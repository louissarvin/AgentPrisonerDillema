import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useAgents() {
  return useQuery({ queryKey: ['agents'], queryFn: api.getAgents })
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ['leaderboard'],
    queryFn: api.getLeaderboard,
    refetchInterval: 10000,
  })
}

export function useTournaments() {
  return useQuery({ queryKey: ['tournaments'], queryFn: api.getTournaments })
}

export function useTournament(id: string) {
  return useQuery({
    queryKey: ['tournament', id],
    queryFn: () => api.getTournament(id),
    enabled: !!id,
  })
}

export function useMatches() {
  return useQuery({
    queryKey: ['matches'],
    queryFn: api.getMatches,
    refetchInterval: 5000,
  })
}

export function useMatch(id: string) {
  return useQuery({
    queryKey: ['match', id],
    queryFn: () => api.getMatch(id),
    enabled: !!id,
    refetchInterval: 3000,
  })
}

export function useMatchEvents(matchId: string) {
  return useQuery({
    queryKey: ['matchEvents', matchId],
    queryFn: () => api.getMatchEvents(matchId),
    enabled: !!matchId,
    refetchInterval: 3000,
  })
}

export function useSwaps() {
  return useQuery({
    queryKey: ['swaps'],
    queryFn: api.getSwaps,
    refetchInterval: 8000,
  })
}

export function useAxlStatus() {
  return useQuery({
    queryKey: ['axlStatus'],
    queryFn: api.getAxlStatus,
    refetchInterval: 10000,
  })
}

export function useAutonomousStatus() {
  return useQuery({
    queryKey: ['autonomousStatus'],
    queryFn: api.getAutonomousStatus,
    refetchInterval: 5000,
  })
}

export function useMcpServices() {
  return useQuery({
    queryKey: ['mcpServices'],
    queryFn: api.getMcpServices,
    refetchInterval: 15000,
  })
}
