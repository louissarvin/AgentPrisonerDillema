import type {
  Agent,
  AutonomousStatus,
  AxlStatus,
  GameEvent,
  LeaderboardEntry,
  Match,
  MatchDetail,
  McpServices,
  SwapTransaction,
  Tournament,
  TournamentDetail,
} from '@/lib/types'
import { config } from '@/config'

const BASE = config.apiUrl

interface ApiResponse<T> {
  success: boolean
  error: null | { code: string; message: string }
  data: T
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  const json: ApiResponse<T> = await res.json()
  if (!json.success) throw new Error(json.error?.message ?? 'Request failed')
  return json.data
}

export const api = {
  getAgents: () => request<Array<Agent>>('/game/agents'),
  getLeaderboard: () => request<Array<LeaderboardEntry>>('/game/leaderboard'),
  getTournaments: () => request<Array<Tournament>>('/game/tournaments'),
  getTournament: (id: string) =>
    request<TournamentDetail>(`/game/tournaments/${id}`),
  getMatches: () => request<Array<Match>>('/game/matches'),
  getMatch: (id: string) => request<MatchDetail>(`/game/matches/${id}`),
  getMatchEvents: (matchId: string) =>
    request<Array<GameEvent>>(`/game/matches/${matchId}/events`),
  startMatch: (tournamentId: string, agentAName: string, agentBName: string) =>
    request<{ message: string }>('/game/matches/start', {
      method: 'POST',
      body: JSON.stringify({ tournamentId, agentAName, agentBName }),
    }),
  createTournament: () =>
    request<Tournament>('/game/tournaments', { method: 'POST', body: '{}' }),
  getSwaps: () => request<Array<SwapTransaction>>('/game/swaps'),
  getAxlStatus: async (): Promise<AxlStatus> => {
    const raw = await request<{
      hubHealthy: boolean
      agents: Array<{
        name: string
        port: number
        healthy: boolean
        peerId: string | null
      }>
    }>('/axl/status')
    return {
      hub: { connected: raw.hubHealthy, peerId: undefined },
      agents: Object.fromEntries(
        raw.agents.map((a) => [
          a.name,
          { connected: a.healthy, peerId: a.peerId ?? undefined },
        ]),
      ),
    }
  },
  getAutonomousStatus: () =>
    request<AutonomousStatus>('/axl/autonomous/status'),
  getMcpServices: () => request<McpServices>('/axl/mcp/services'),
  // SSE endpoints return URLs, not fetched responses
  sseMatchUrl: (matchId: string) => `${BASE}/sse/matches/${matchId}/live`,
  sseLiveUrl: () => `${BASE}/sse/live`,
}
