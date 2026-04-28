import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { prismaQuery } from '../lib/prisma.ts';
import { ZG_PRIVATE_KEY, ZG_RPC_URL, GAME_MANAGER_ADDRESS } from '../config/main-config.ts';

// GameManager ABI (only the functions we call)
const GAME_MANAGER_ABI = [
  'function createMatch(address agentA, address agentB, uint256 stakePerRound) external returns (uint256)',
  'function commitMove(uint256 matchId, bytes32 commitment) external',
  'function commitMoveFor(uint256 matchId, address agent, bytes32 commitment) external',
  'function revealMove(uint256 matchId, uint8 move, bytes32 secret) external',
  'function revealMoveFor(uint256 matchId, address agent, uint8 move, bytes32 secret) external',
  'function resolveRound(uint256 matchId) external',
  'function checkGameEnd(uint256 matchId) external',
  'function forceEndMatch(uint256 matchId, string reason) external',
  'function getMatch(uint256 matchId) external view returns (tuple(address agentA, address agentB, uint256 currentRound, uint256 scoreA, uint256 scoreB, uint256 stakePerRound, bool active, uint256 startedAt))',
  'function getRound(uint256 matchId, uint256 round) external view returns (tuple(bytes32 commitA, bytes32 commitB, uint8 moveA, uint8 moveB, bool revealedA, bool revealedB, uint256 commitDeadline, uint256 revealDeadline, bool resolved))',
  'function computeCommitment(uint8 move, bytes32 secret) external pure returns (bytes32)',
  'event MatchCreated(uint256 indexed matchId, address indexed agentA, address indexed agentB, uint256 stakePerRound)',
  'event RoundStarted(uint256 indexed matchId, uint256 round, uint256 commitDeadline, uint256 revealDeadline)',
  'event MoveCommitted(uint256 indexed matchId, uint256 round, address indexed agent)',
  'event MoveRevealed(uint256 indexed matchId, uint256 round, address indexed agent, uint8 move)',
  'event RoundResolved(uint256 indexed matchId, uint256 round, uint8 moveA, uint8 moveB, uint256 scoreA, uint256 scoreB)',
  'event MatchEnded(uint256 indexed matchId, uint256 totalScoreA, uint256 totalScoreB, string reason)',
];

// SSE event bus for real-time frontend updates
export const gameEventBus = new EventEmitter();
gameEventBus.setMaxListeners(100);

export function emitGameEvent(matchId: string, type: string, payload: Record<string, unknown>): void {
  gameEventBus.emit(`match:${matchId}`, { type, payload });

  // Also persist to DB for replay
  prismaQuery.gameEvent.create({
    data: { matchId, type, payload: JSON.stringify(payload) },
  }).catch((err: unknown) => console.error('[GameEngine] Failed to persist event:', err));
}

// Singleton provider + wallet (no NonceManager; we serialize all calls instead)
const _provider = new ethers.JsonRpcProvider(ZG_RPC_URL);
const _wallet = new ethers.Wallet(ZG_PRIVATE_KEY, _provider);

// Mutex to serialize all on-chain write transactions from this wallet
let _txQueue: Promise<unknown> = Promise.resolve();
function serializeTx<T>(fn: () => Promise<T>): Promise<T> {
  const p = _txQueue.then(fn, fn);
  _txQueue = p.catch(() => {});
  return p;
}

function getContract(): ethers.Contract {
  return new ethers.Contract(GAME_MANAGER_ADDRESS, GAME_MANAGER_ABI, _wallet);
}

async function getFeeOverrides(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; nonce: number }> {
  const [feeData, nonce] = await Promise.all([
    _provider.getFeeData(),
    _provider.getTransactionCount(_wallet.address, 'latest'),
  ]);
  return {
    maxFeePerGas: (feeData.maxFeePerGas ?? 2000000n) * 3n,
    maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas ?? 1000000n) * 3n,
    nonce,
  };
}

export async function createOnChainMatch(
  agentAAddress: string,
  agentBAddress: string,
  stakePerRound: number = 1
): Promise<{ matchId: number; txHash: string }> {
  return serializeTx(async () => {
    const contract = getContract();
    const fees = await getFeeOverrides();
    const tx = await contract.createMatch(
      agentAAddress,
      agentBAddress,
      ethers.parseEther(stakePerRound.toString()),
      fees
    );
    const receipt = await tx.wait();

    // Parse MatchCreated event
    const event = receipt.logs
      .map((log: any) => { try { return contract.interface.parseLog(log); } catch { return null; } })
      .find((e: any) => e?.name === 'MatchCreated');

    const matchId = Number(event?.args?.matchId ?? 0);
    return { matchId, txHash: receipt.hash };
  });
}

export async function commitMoveOnChain(
  matchId: number,
  move: number,
  secret: string,
  agentAddress?: string
): Promise<{ commitment: string; txHash: string }> {
  return serializeTx(async () => {
    const contract = getContract();
    const secretBytes = ethers.id(secret);
    const commitment = await contract.computeCommitment(move, secretBytes);

    // Use commitMoveFor (owner-delegated) if agentAddress provided
    const fees = await getFeeOverrides();
    const tx = agentAddress
      ? await contract.commitMoveFor(matchId, agentAddress, commitment, fees)
      : await contract.commitMove(matchId, commitment, fees);
    const receipt = await tx.wait();

    return { commitment, txHash: receipt.hash };
  });
}

export async function revealMoveOnChain(
  matchId: number,
  move: number,
  secret: string,
  agentAddress?: string
): Promise<string> {
  return serializeTx(async () => {
    const contract = getContract();
    const secretBytes = ethers.id(secret);

    // Use revealMoveFor (owner-delegated) if agentAddress provided
    const fees = await getFeeOverrides();
    const tx = agentAddress
      ? await contract.revealMoveFor(matchId, agentAddress, move, secretBytes, fees)
      : await contract.revealMove(matchId, move, secretBytes, fees);
    const receipt = await tx.wait();
    return receipt.hash;
  });
}

export async function resolveRoundOnChain(matchId: number): Promise<string> {
  return serializeTx(async () => {
    const contract = getContract();
    const fees = await getFeeOverrides();
    const tx = await contract.resolveRound(matchId, fees);
    const receipt = await tx.wait();
    return receipt.hash;
  });
}

export async function checkGameEndOnChain(matchId: number): Promise<string> {
  return serializeTx(async () => {
    const contract = getContract();
    const fees = await getFeeOverrides();
    const tx = await contract.checkGameEnd(matchId, fees);
    const receipt = await tx.wait();
    return receipt.hash;
  });
}

export async function getMatchState(matchId: number): Promise<{
  agentA: string;
  agentB: string;
  currentRound: number;
  scoreA: number;
  scoreB: number;
  active: boolean;
}> {
  const contract = getContract();
  const m = await contract.getMatch(matchId);
  return {
    agentA: m.agentA,
    agentB: m.agentB,
    currentRound: Number(m.currentRound),
    scoreA: Number(m.scoreA),
    scoreB: Number(m.scoreB),
    active: m.active,
  };
}

export async function getRoundState(matchId: number, round: number): Promise<{
  commitA: string;
  commitB: string;
  moveA: number;
  moveB: number;
  revealedA: boolean;
  revealedB: boolean;
  commitDeadline: number;
  revealDeadline: number;
  resolved: boolean;
}> {
  const contract = getContract();
  const r = await contract.getRound(matchId, round);
  return {
    commitA: r.commitA,
    commitB: r.commitB,
    moveA: Number(r.moveA),
    moveB: Number(r.moveB),
    revealedA: r.revealedA,
    revealedB: r.revealedB,
    commitDeadline: Number(r.commitDeadline),
    revealDeadline: Number(r.revealDeadline),
    resolved: r.resolved,
  };
}

// Payoff calculation (mirrors contract logic)
export function calculatePayoff(moveA: number, moveB: number): { payA: number; payB: number } {
  const COOPERATE = 0;
  const DEFECT = 1;

  if (moveA === COOPERATE && moveB === COOPERATE) return { payA: 3, payB: 3 };
  if (moveA === DEFECT && moveB === COOPERATE) return { payA: 5, payB: 0 };
  if (moveA === COOPERATE && moveB === DEFECT) return { payA: 0, payB: 5 };
  return { payA: 1, payB: 1 }; // Both defect
}
