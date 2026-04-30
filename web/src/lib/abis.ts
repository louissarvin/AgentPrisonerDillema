export const bettingPoolAbi = [
  {
    name: 'placeBet',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'roundNumber', type: 'uint256' },
      { name: 'prediction', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'claimWinnings',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'roundNumber', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'refundBet',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'roundNumber', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'getRound',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'roundNumber', type: 'uint256' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'matchId', type: 'uint256' },
          { name: 'roundNumber', type: 'uint256' },
          { name: 'poolCooperate', type: 'uint256' },
          { name: 'poolDefect', type: 'uint256' },
          { name: 'poolMixed', type: 'uint256' },
          { name: 'result', type: 'uint8' },
          { name: 'settled', type: 'bool' },
          { name: 'cancelled', type: 'bool' },
          { name: 'bettingDeadline', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getUserBet',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'roundNumber', type: 'uint256' },
      { name: 'bettor', type: 'address' },
      { name: 'prediction', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getTotalPool',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'roundNumber', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'USDC',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'MIN_BET',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'MAX_BET',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// Outcome enum values for placeBet prediction argument
export const Outcome = {
  NONE: 0,
  BOTH_COOPERATE: 1,
  BOTH_DEFECT: 2,
  MIXED: 3,
} as const

export type OutcomeValue = (typeof Outcome)[keyof typeof Outcome]

export const erc20Abi = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const
