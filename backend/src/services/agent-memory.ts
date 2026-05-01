import { prismaQuery } from '../lib/prisma.ts';
import {
  saveAgentMemory,
  loadAgentMemory,
  createEmptyMemory,
  updateMemoryAfterMatch,
  writeAgentState,
  type AgentMemoryState,
} from '../lib/og-storage.ts';
import { runInference } from '../lib/og-compute.ts';

// In-memory cache for current session
const memoryCache = new Map<string, AgentMemoryState>();

// Cache for opponent public profiles (avoid repeated 0G downloads within a session)
const publicProfileCache = new Map<string, PublicProfile | null>();

/**
 * Public-facing profile extracted from an agent's memory.
 * Only contains aggregate stats safe to share with opponents.
 * NEVER includes trustScores (per-opponent intelligence) or strategicNotes (private reasoning).
 */
export interface PublicProfile {
  agentName: string;
  totalMatches: number;
  totalWins: number;
  averageCoopRate: number;
  totalScore: number;
}

/**
 * Load agent's persistent memory from 0G Storage.
 * Checks DB for latest rootHash, downloads from 0G, caches in memory.
 */
export async function getAgentMemory(agentId: string, agentName: string): Promise<AgentMemoryState> {
  // Check cache first
  const cached = memoryCache.get(agentId);
  if (cached) return cached;

  // Check DB for stored rootHash
  try {
    const record = await prismaQuery.agentMemory.findUnique({
      where: { agentId },
    });

    if (record?.rootHash) {
      console.log(`[AgentMemory] Loading ${agentName} memory from 0G: ${record.rootHash.slice(0, 16)}...`);
      const memory = await loadAgentMemory(record.rootHash);
      if (memory) {
        memoryCache.set(agentId, memory);
        return memory;
      }
    }
  } catch (err) {
    console.warn(`[AgentMemory] DB lookup failed for ${agentName}:`, err);
  }

  // No stored memory, create fresh
  const fresh = createEmptyMemory(agentId, agentName);
  memoryCache.set(agentId, fresh);
  return fresh;
}

/**
 * Save agent's updated memory to 0G Storage and update DB rootHash.
 */
export async function persistAgentMemory(agentId: string, memory: AgentMemoryState): Promise<void> {
  // Update cache
  memoryCache.set(agentId, memory);

  try {
    // Upload to 0G Storage
    const { rootHash, txHash } = await saveAgentMemory(memory);

    // Update DB with new rootHash
    await prismaQuery.agentMemory.upsert({
      where: { agentId },
      update: { rootHash, txHash, version: { increment: 1 }, agentName: memory.agentName },
      create: { agentId, agentName: memory.agentName, rootHash, txHash },
    });

    console.log(`[AgentMemory] Persisted ${memory.agentName} memory to 0G: ${rootHash.slice(0, 16)}...`);

    // Dual-write: blob storage (primary, readable) + KV store (for when KV nodes are available)
    writeAgentState(memory.agentName, memory as unknown as Record<string, unknown>).catch(err =>
      console.warn('[AgentMemory] KV dual-write failed:', err)
    );
  } catch (err) {
    console.error(`[AgentMemory] Failed to persist ${memory.agentName} memory:`, err);
    // Memory is still in cache, will retry next save
  }
}

/**
 * Update agent memory after a match completes, then persist to 0G.
 */
export async function recordMatchResult(
  agentId: string,
  agentName: string,
  opponentName: string,
  rounds: Array<{ myMove: string; opponentMove: string; myScore: number }>,
  won: boolean
): Promise<void> {
  const memory = await getAgentMemory(agentId, agentName);
  const updated = updateMemoryAfterMatch(memory, opponentName, rounds, won);

  // Generate strategic note via 0G Compute (TEE-verified learning)
  try {
    const note = await generateStrategicNote(agentName, opponentName, rounds, won);
    if (note) {
      updated.strategicNotes = [...(updated.strategicNotes || []).slice(-4), note]; // Keep last 5
      console.log(`[0G Memory] ${agentName} strategic note: "${note}"`);
    }
  } catch (err) {
    console.warn(`[0G Memory] Failed to generate strategic note for ${agentName}:`, err);
  }

  await persistAgentMemory(agentId, updated);
}

/**
 * Generate a concise strategic note about what the agent learned from a match.
 * Uses 0G Compute inference (TEE-verified) so the learning is provably unbiased.
 */
async function generateStrategicNote(
  agentName: string,
  opponentName: string,
  rounds: Array<{ myMove: string; opponentMove: string; myScore: number }>,
  won: boolean
): Promise<string | null> {
  if (rounds.length === 0) return null;

  const totalScore = rounds.reduce((sum, r) => sum + r.myScore, 0);
  const opponentCoopRate = Math.round(
    (rounds.filter(r => r.opponentMove === 'cooperate').length / rounds.length) * 100
  );
  const lastThree = rounds.slice(-3).map(r => `${r.myMove}/${r.opponentMove}`).join(', ');

  const prompt = `You are ${agentName}. You just finished a match against ${opponentName}.
Result: ${won ? 'YOU WON' : 'YOU LOST'}. Your score: ${totalScore}. Rounds played: ${rounds.length}.
Opponent cooperation rate: ${opponentCoopRate}%.
Last 3 rounds (your move/opponent move): ${lastThree}.

Write ONE concise strategic note (under 30 words) about what you learned about ${opponentName}'s behavior that will help you in future matches. Focus on patterns, not emotions.`;

  const result = await runInference(
    'You are a strategic AI analyst. Write concise, actionable notes.',
    prompt,
    0.5,
    64
  );

  const note = result.content.trim();
  if (!note || note.length > 200) return null;
  return note;
}

/**
 * Build a memory context string for the agent's prompt.
 * This is injected into the decision prompt so the agent "remembers" past matches.
 */
export function buildMemoryContext(memory: AgentMemoryState, opponentName: string): string {
  const lines: string[] = [];

  // Lifetime stats
  lines.push(`YOUR PERSISTENT MEMORY (stored on 0G decentralized storage):`);
  lines.push(`  Lifetime: ${memory.lifetimeStats.totalMatches} matches, ${memory.lifetimeStats.totalWins} wins, avg cooperation rate ${Math.round(memory.lifetimeStats.averageCoopRate * 100)}%`);

  // Opponent-specific history
  const opHistory = memory.opponentHistory[opponentName];
  if (opHistory) {
    const trustScore = memory.trustScores[opponentName] || 0.5;
    lines.push(`  HISTORY WITH ${opponentName}:`);
    lines.push(`    Matches played: ${opHistory.matchesPlayed}`);
    lines.push(`    Their cooperation rate: ${Math.round((opHistory.totalCooperations / (opHistory.totalCooperations + opHistory.totalDefections)) * 100)}%`);
    lines.push(`    Your trust score for them: ${Math.round(trustScore * 100)}%`);
    lines.push(`    Last match outcome: ${opHistory.lastMatchOutcome}`);
    if (opHistory.betrayalRounds.length > 0) {
      lines.push(`    WARNING: They betrayed you in rounds: ${opHistory.betrayalRounds.slice(-5).join(', ')}`);
    }
  } else {
    lines.push(`  No prior history with ${opponentName} (first encounter)`);
  }

  // Trust scores for all known opponents
  const knownOpponents = Object.entries(memory.trustScores);
  if (knownOpponents.length > 0) {
    lines.push(`  TRUST SCORES (all opponents):`);
    for (const [name, score] of knownOpponents) {
      const label = score > 0.7 ? 'HIGH' : score > 0.4 ? 'MEDIUM' : 'LOW';
      lines.push(`    ${name}: ${Math.round(score * 100)}% (${label})`);
    }
  }

  // Strategic notes
  if (memory.strategicNotes.length > 0) {
    lines.push(`  STRATEGIC NOTES:`);
    for (const note of memory.strategicNotes.slice(-3)) {
      lines.push(`    - ${note}`);
    }
  }

  return lines.join('\n');
}

/**
 * Load an opponent's public profile from 0G Storage.
 * Looks up by agentName (not agentId) since we may not know their ID.
 * Returns only sanitized public stats. Returns null if no profile exists yet.
 */
export async function getOpponentPublicProfile(opponentName: string): Promise<PublicProfile | null> {
  // Check cache first
  if (publicProfileCache.has(opponentName)) {
    return publicProfileCache.get(opponentName) ?? null;
  }

  try {
    const record = await prismaQuery.agentMemory.findFirst({
      where: { agentName: opponentName },
    });

    if (!record?.rootHash) {
      console.log(`[AgentMemory] No stored memory for opponent ${opponentName}`);
      publicProfileCache.set(opponentName, null);
      return null;
    }

    console.log(`[AgentMemory] Loading ${opponentName} public profile from 0G: ${record.rootHash.slice(0, 16)}...`);
    const memory = await loadAgentMemory(record.rootHash);

    if (!memory) {
      publicProfileCache.set(opponentName, null);
      return null;
    }

    // Extract ONLY public data. Never expose trustScores or strategicNotes.
    const profile: PublicProfile = {
      agentName: memory.agentName,
      totalMatches: memory.lifetimeStats.totalMatches,
      totalWins: memory.lifetimeStats.totalWins,
      averageCoopRate: memory.lifetimeStats.averageCoopRate,
      totalScore: memory.lifetimeStats.totalScore,
    };

    publicProfileCache.set(opponentName, profile);
    return profile;
  } catch (err) {
    console.warn(`[AgentMemory] Failed to load public profile for ${opponentName}:`, err);
    publicProfileCache.set(opponentName, null);
    return null;
  }
}

/**
 * Render an opponent's public profile into a prompt section for the agent's LLM context.
 * Returns an empty string if no profile is available.
 */
export function buildOpponentIntelligence(opponentProfile: PublicProfile | null, opponentName: string): string {
  if (!opponentProfile) {
    return `OPPONENT INTELLIGENCE (from 0G shared storage):\n  No public profile found for ${opponentName}. This may be their first match.`;
  }

  const winRate = opponentProfile.totalMatches > 0
    ? Math.round((opponentProfile.totalWins / opponentProfile.totalMatches) * 100)
    : 0;

  const lines: string[] = [
    `OPPONENT INTELLIGENCE (from 0G shared storage):`,
    `  Agent: ${opponentProfile.agentName}`,
    `  Total matches played: ${opponentProfile.totalMatches}`,
    `  Win rate: ${winRate}%`,
    `  Average cooperation rate: ${Math.round(opponentProfile.averageCoopRate * 100)}%`,
    `  Lifetime score: ${opponentProfile.totalScore}`,
  ];

  // Add behavioral hints based on public stats
  if (opponentProfile.totalMatches >= 3) {
    if (opponentProfile.averageCoopRate > 0.7) {
      lines.push(`  Assessment: This opponent tends to cooperate frequently.`);
    } else if (opponentProfile.averageCoopRate < 0.3) {
      lines.push(`  Assessment: This opponent defects frequently. Exercise caution.`);
    } else {
      lines.push(`  Assessment: This opponent uses a mixed strategy.`);
    }
  }

  return lines.join('\n');
}

/**
 * Clear the in-memory cache (useful for testing)
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
  publicProfileCache.clear();
}

