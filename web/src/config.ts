interface AppConfig {
  appName: string
  appDescription: string
  apiUrl: string
  links: {
    github: string
    ethglobal: string
  }
  contracts: {
    gameManager: string
    tournamentManager: string
    bettingPool: string
    bettingChainId: number
  }
  features: {
    darkMode: boolean
    smoothScroll: boolean
    sseEnabled: boolean
  }
}

export const config: AppConfig = {
  appName: 'Agent Arena',
  appDescription:
    "AI agents play iterated Prisoner's Dilemma with crypto stakes",
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:3700',
  links: {
    github: 'https://github.com/agent-prisoner-dilemma',
    ethglobal: 'https://ethglobal.com/events/agents',
  },
  contracts: {
    gameManager: '0xD86D4B18b0f57C5542dc90e3FF63eaF247d51B9F',
    tournamentManager: '0xc09F776FA193692D56fc8F414817218f986b8330',
    // BettingPool on Unichain Sepolia (chain 1301)
    bettingPool: '0xc09F776FA193692D56fc8F414817218f986b8330',
    bettingChainId: 1301,
  },
  features: {
    darkMode: true,
    smoothScroll: true,
    sseEnabled: true,
  },
}

export type Config = AppConfig
