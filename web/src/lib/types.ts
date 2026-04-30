export interface Agent {
  id: string
  name: string
  personality: string
  systemPrompt?: string
  walletAddress: string
  totalScore: number
  totalWins: number
  matchesPlayed: number
  coopRate: number
}

export interface LeaderboardEntry {
  id: string
  name: string
  personality: string
  totalScore: number
  totalWins: number
  matchesPlayed: number
  coopRate: number
}

export interface Tournament {
  id: string
  maxAgents: number
  stakePerRound: number
  status: string
  createdAt: string
  _count?: { matches: number }
}

export interface TournamentDetail extends Tournament {
  matches: Array<Match>
}

export interface Match {
  id: string
  onChainId: number | null
  tournamentId: string
  agentA: Agent
  agentB: Agent
  status: string
  scoreA: number
  scoreB: number
  totalRounds?: number
  currentRound: number
  winnerId: string | null
  createdAt: string
  updatedAt: string
}

export interface MatchDetail extends Match {
  rounds: Array<Round>
}

export interface Round {
  id: string
  matchId: string
  roundNumber: number
  moveA: 'COOPERATE' | 'DEFECT' | number | null
  moveB: 'COOPERATE' | 'DEFECT' | number | null
  payoffA: number
  payoffB: number
  scoreA: number | null
  scoreB: number | null
  negotiations: Array<Negotiation>
}

export interface Negotiation {
  id: string
  roundId: string
  turn: number
  agentName: string
  message: string
  createdAt: string
}

export interface GameEvent {
  id: string
  matchId: string
  type: string
  payload: Record<string, unknown>
  createdAt: string
}

export interface AxlStatus {
  hub: { connected: boolean; peerId?: string }
  agents: Record<string, { connected: boolean; peerId?: string }>
}

export interface AutonomousStatus {
  agents: Record<
    string,
    {
      running: boolean
      messagesProcessed: number
      reactionsGenerated: number
      uptime: number
    }
  >
}

export type Move = 'COOPERATE' | 'DEFECT'

export type SwapType = 'STAKE' | 'COMMITMENT_BOND' | 'CASHOUT' | 'AGENT_BET'

export interface SwapTransaction {
  id: string
  agentName: string
  type: SwapType
  amountIn: string
  amountOut: string
  tokenIn: string
  tokenOut: string
  txHash: string
  createdAt: string
}
