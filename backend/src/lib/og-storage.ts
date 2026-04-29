import { ethers } from 'ethers';
import { Indexer, MemData, Batcher, getFlowContract } from '@0gfoundation/0g-ts-sdk';
import { ZG_PRIVATE_KEY, ZG_RPC_URL, ZG_INDEXER_URL, ZG_FLOW_ADDRESS } from '../config/main-config.ts';

let indexerInstance: Indexer | null = null;
let signerInstance: ethers.Wallet | null = null;

function getIndexer(): Indexer {
  if (!indexerInstance) {
    indexerInstance = new Indexer(ZG_INDEXER_URL);
  }
  return indexerInstance;
}

function getSigner(): ethers.Wallet {
  if (!signerInstance) {
    const provider = new ethers.JsonRpcProvider(ZG_RPC_URL);
    signerInstance = new ethers.Wallet(ZG_PRIVATE_KEY, provider);
  }
  return signerInstance;
}

// ========== LOG STORAGE (Immutable blobs) ==========

export interface UploadResult {
  rootHash: string;
  txHash: string;
}

export async function uploadMatchHistory(matchId: string, data: Record<string, unknown>): Promise<UploadResult> {
  const indexer = getIndexer();
  const signer = getSigner();

  const payload = JSON.stringify({
    matchId,
    uploadedAt: Date.now(),
    ...data,
  });

  const memData = new MemData(new TextEncoder().encode(payload));
  const [tree, treeErr] = await memData.merkleTree();
  if (treeErr) throw new Error(`Merkle tree failed: ${treeErr.message}`);

  const rootHash: string = tree!.rootHash() ?? '';

  const [tx, uploadErr] = await indexer.upload(memData, ZG_RPC_URL, signer);
  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

  console.log(`[0G Storage] Uploaded match history: ${rootHash}`);
  return { rootHash, txHash: (tx as any).txHash || '' };
}

export async function downloadMatchHistory(rootHash: string): Promise<Record<string, unknown>> {
  const indexer = getIndexer();

  const [blob, dlErr] = await indexer.downloadToBlob(rootHash, { proof: true });
  if (dlErr) throw new Error(`Download failed: ${dlErr.message}`);

  const text = await (blob as Blob).text();
  return JSON.parse(text);
}

// ========== KV STORAGE (Mutable key-value) ==========
// NOTE: KV read (KvClient.getValue()) requires a dedicated KV node not available on testnet.
// We keep writing to KV so data is ready when KV nodes become available.
// Primary reads come from blob storage (dual-write pattern).

export async function writeAgentState(
  agentName: string,
  memoryData: Record<string, unknown>
): Promise<void> {
  const streamId = getAgentStreamId(agentName);
  const keys = Object.keys(memoryData);
  console.log(`[0G KV Store] Writing agent state for ${agentName}: ${keys.join(', ')}`);

  const indexer = getIndexer();
  const signer = getSigner();
  const flowContract = getFlowContract(ZG_FLOW_ADDRESS, signer);

  const [nodes, nodeErr] = await indexer.selectNodes(1);
  if (nodeErr) throw new Error(`Node selection failed: ${nodeErr.message}`);

  const batcher = new Batcher(1, nodes!, flowContract, ZG_RPC_URL);

  batcher.streamDataBuilder.set(
    streamId,
    Uint8Array.from(Buffer.from(`agent-state-${agentName}`, 'utf-8')),
    Uint8Array.from(Buffer.from(JSON.stringify(memoryData), 'utf-8'))
  );

  const [tx, batchErr] = await batcher.exec();
  if (batchErr) throw new Error(`KV write failed: ${batchErr.message}`);

  console.log(`[0G KV Store] Successfully wrote agent state for ${agentName} to stream ${streamId.slice(0, 16)}...`);
}

export async function uploadAgentReasoning(
  agentName: string,
  matchId: string,
  round: number,
  reasoning: Record<string, unknown>
): Promise<UploadResult> {
  return uploadMatchHistory(`${matchId}-${agentName}-r${round}`, {
    type: 'agent_reasoning',
    agentName,
    matchId,
    round,
    reasoning,
  });
}

export async function uploadNegotiationTranscript(
  matchId: string,
  roundNumber: number,
  agentAName: string,
  agentBName: string,
  messagesA: string[],
  messagesB: string[],
): Promise<string | null> {
  try {
    const transcript = {
      matchId,
      round: roundNumber,
      agents: [agentAName, agentBName],
      messages: messagesA.map((msg, i) => ([
        { agent: agentAName, turn: i, message: msg },
        ...(messagesB[i] ? [{ agent: agentBName, turn: i, message: messagesB[i] }] : []),
      ])).flat(),
      timestamp: new Date().toISOString(),
      storageType: '0G_LOG_STORE',
    };

    const payload = JSON.stringify(transcript);
    const memData = new MemData(new TextEncoder().encode(payload));
    const [tree, treeErr] = await memData.merkleTree();
    if (treeErr) throw new Error(`Merkle tree failed: ${treeErr.message}`);

    const rootHash: string = tree!.rootHash() ?? '';

    const indexer = getIndexer();
    const signer = getSigner();

    const [tx, uploadErr] = await indexer.upload(memData, ZG_RPC_URL, signer);
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    console.log(`[0G Log Store] Archived negotiation transcript: match=${matchId} round=${roundNumber} hash=${rootHash.slice(0, 16)}...`);
    return rootHash;
  } catch (err) {
    console.warn('[0G Log Store] Failed to archive negotiation transcript:', err);
    return null;
  }
}

// Generate a deterministic stream ID for an agent
export function getAgentStreamId(agentId: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`agent-pd-state-${agentId}`));
}

// ========== PERSISTENT AGENT MEMORY (Blob-based, read-write) ==========

export interface AgentMemoryState {
  agentId: string;
  agentName: string;
  updatedAt: number;
  trustScores: Record<string, number>; // opponentName -> trust score (0-1)
  opponentHistory: Record<string, {
    matchesPlayed: number;
    totalCooperations: number;
    totalDefections: number;
    lastMatchOutcome: string;
    betrayalRounds: number[];
  }>;
  lifetimeStats: {
    totalMatches: number;
    totalWins: number;
    totalScore: number;
    averageCoopRate: number;
  };
  strategicNotes: string[]; // Free-form notes from agent reasoning
}

export function createEmptyMemory(agentId: string, agentName: string): AgentMemoryState {
  return {
    agentId,
    agentName,
    updatedAt: Date.now(),
    trustScores: {},
    opponentHistory: {},
    lifetimeStats: {
      totalMatches: 0,
      totalWins: 0,
      totalScore: 0,
      averageCoopRate: 0,
    },
    strategicNotes: [],
  };
}

export async function saveAgentMemory(memory: AgentMemoryState): Promise<UploadResult> {
  const indexer = getIndexer();
  const signer = getSigner();

  const payload = JSON.stringify({
    type: 'agent_persistent_memory',
    ...memory,
    updatedAt: Date.now(),
  });

  const memData = new MemData(new TextEncoder().encode(payload));

  const [tx, uploadErr] = await indexer.upload(memData, ZG_RPC_URL, signer);
  if (uploadErr) throw new Error(`Memory upload failed: ${uploadErr.message}`);

  const rootHash = (tx as any).rootHash || '';
  const txHash = (tx as any).txHash || '';

  console.log(`[0G Storage] Saved ${memory.agentName} memory: ${rootHash}`);
  return { rootHash, txHash };
}

export async function loadAgentMemory(rootHash: string): Promise<AgentMemoryState | null> {
  try {
    const indexer = getIndexer();
    const [blob, dlErr] = await indexer.downloadToBlob(rootHash, { proof: true });
    if (dlErr) {
      console.warn(`[0G Storage] Memory download failed: ${dlErr.message}`);
      return null;
    }

    const text = await (blob as Blob).text();
    const data = JSON.parse(text);
    return data as AgentMemoryState;
  } catch (err) {
    console.warn(`[0G Storage] Failed to load memory from ${rootHash}:`, err);
    return null;
  }
}

export function updateMemoryAfterMatch(
  memory: AgentMemoryState,
  opponentName: string,
  rounds: Array<{ myMove: string; opponentMove: string; myScore: number }>,
  won: boolean
): AgentMemoryState {
  const updated = { ...memory, updatedAt: Date.now() };

  // Update opponent history
  const existing = updated.opponentHistory[opponentName] || {
    matchesPlayed: 0,
    totalCooperations: 0,
    totalDefections: 0,
    lastMatchOutcome: '',
    betrayalRounds: [],
  };

  existing.matchesPlayed += 1;
  existing.lastMatchOutcome = won ? 'won' : 'lost';

  const betrayalRounds: number[] = [];
  for (let i = 0; i < rounds.length; i++) {
    if (rounds[i].opponentMove === 'defect') {
      existing.totalDefections += 1;
      betrayalRounds.push(i + 1);
    } else {
      existing.totalCooperations += 1;
    }
  }
  existing.betrayalRounds = [...existing.betrayalRounds, ...betrayalRounds].slice(-20);

  updated.opponentHistory[opponentName] = existing;

  // Update trust score
  const totalMoves = existing.totalCooperations + existing.totalDefections;
  updated.trustScores[opponentName] = totalMoves > 0
    ? existing.totalCooperations / totalMoves
    : 0.5;

  // Update lifetime stats
  updated.lifetimeStats.totalMatches += 1;
  if (won) updated.lifetimeStats.totalWins += 1;
  updated.lifetimeStats.totalScore += rounds.reduce((sum, r) => sum + r.myScore, 0);

  const allCoops = Object.values(updated.opponentHistory)
    .reduce((sum, h) => sum + h.totalCooperations, 0);
  const allTotal = Object.values(updated.opponentHistory)
    .reduce((sum, h) => sum + h.totalCooperations + h.totalDefections, 0);
  updated.lifetimeStats.averageCoopRate = allTotal > 0 ? allCoops / allTotal : 0.5;

  return updated;
}
