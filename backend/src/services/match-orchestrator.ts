import { nanoid } from 'nanoid';
import { ethers } from 'ethers';
import { prismaQuery } from '../lib/prisma.ts';
import { sleep } from '../utils/miscUtils.ts';
import { uploadAgentReasoning, uploadNegotiationTranscript } from '../lib/og-storage.ts';

// Timeout wrapper: resolves with undefined if the promise takes too long
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) =>
      setTimeout(() => {
        console.warn(`[Orchestrator] ${label} timed out after ${ms / 1000}s, skipping`);
        resolve(undefined);
      }, ms)
    ),
  ]);
}
import {
  createOnChainMatch,
  commitMoveOnChain,
  revealMoveOnChain,
  resolveRoundOnChain,
  checkGameEndOnChain,
  getRoundState,
  emitGameEvent,
  calculatePayoff,
} from './game-engine.ts';
import {
  getPersona,
  getAgentFinalDecision,
  runNegotiationPhase,
  type GameContext,
  type AgentPersona,
} from './agent-runner.ts';
import { agentDecideCommitment, agentDecideBet, agentDecideStake, agentCashOut, agentClaimBettingWinnings, type CommitmentBond } from './agent-treasury.ts';
import { recordMatchResult, getOpponentPublicProfile, buildOpponentIntelligence } from './agent-memory.ts';
import { openBettingForRound, settleBettingForRound } from './betting-engine.ts';
import { axlManager } from './axl-manager.ts';
import { createMessage, MessageType, type CommitNotifyMessage, type RevealNotifyMessage, type RoundResultMessage, type GameOverMessage } from '../lib/axl-protocol.ts';

const COOPERATE = 0;
const DEFECT = 1;

interface MatchConfig {
  tournamentId: string;
  agentAId: string;
  agentBId: string;
  agentAName: string;
  agentBName: string;
  agentAAddress: string;
  agentBAddress: string;
  agentAPrivateKey?: string; // For Uniswap commitment bonds
  agentBPrivateKey?: string;
  stakePerRound?: number;
}

export async function orchestrateMatch(config: MatchConfig): Promise<string> {
  const {
    tournamentId, agentAId, agentBId,
    agentAName, agentBName,
    agentAAddress, agentBAddress,
    stakePerRound = 1,
  } = config;

  const personaA = getPersona(agentAName);
  const personaB = getPersona(agentBName);
  if (!personaA || !personaB) throw new Error('Unknown agent persona');

  // Create DB match record first (on-chain match created later, just before first commit)
  // Use null for onChainId (unique constraint allows multiple nulls, but not multiple 0s)
  let onChainId = 0;
  let txHash = '';
  const match = await prismaQuery.match.create({
    data: {
      tournamentId,
      agentAId,
      agentBId,
      txHash: '',
      status: 'ACTIVE',
    },
  });

  emitGameEvent(match.id, 'match_started', {
    matchId: match.id,
    onChainId: null,
    agentA: agentAName,
    agentB: agentBName,
  });

  // Load opponent public profiles from 0G shared storage (cross-agent intelligence)
  // Each agent sees their opponent's public stats, but never private trust scores or strategic notes.
  let opponentIntelForA = '';
  let opponentIntelForB = '';
  try {
    const [profileOfB, profileOfA] = await Promise.all([
      getOpponentPublicProfile(agentBName),
      getOpponentPublicProfile(agentAName),
    ]);
    opponentIntelForA = buildOpponentIntelligence(profileOfB, agentBName);
    opponentIntelForB = buildOpponentIntelligence(profileOfA, agentAName);
    console.log(`[Orchestrator] Loaded 0G public profiles: ${agentBName}=${profileOfB ? 'found' : 'none'}, ${agentAName}=${profileOfA ? 'found' : 'none'}`);
  } catch (err) {
    console.warn('[Orchestrator] Failed to load opponent public profiles:', err);
    // Non-fatal: agents proceed without opponent intelligence
  }

  // Auto-stake: agents swap ETH->USDC for tournament entry via Uniswap
  // Both stakes run in parallel but must complete before round 1 starts
  const stakeUsdcBase = ethers.parseUnits(String(stakePerRound), 6).toString();
  const stakePromises: Promise<unknown>[] = [];
  if (config.agentAPrivateKey) {
    stakePromises.push(
      agentDecideStake(agentAName, config.agentAPrivateKey, stakeUsdcBase, [agentBName], personaA.strategy)
        .then(result => {
          if (result.type === 'stake') {
            console.log(`[Uniswap] ${agentAName} auto-staked: ${result.amount} USDC`);
          } else {
            console.log(`[Uniswap] ${agentAName} auto-stake result: type=${result.type}, reasoning=${result.reasoning}`);
          }
        })
        .catch(err => console.warn(`[Uniswap] ${agentAName} auto-stake failed:`, err))
    );
  }
  if (config.agentBPrivateKey) {
    stakePromises.push(
      agentDecideStake(agentBName, config.agentBPrivateKey, stakeUsdcBase, [agentAName], personaB.strategy)
        .then(result => {
          if (result.type === 'stake') {
            console.log(`[Uniswap] ${agentBName} auto-staked: ${result.amount} USDC`);
          } else {
            console.log(`[Uniswap] ${agentBName} auto-stake result: type=${result.type}, reasoning=${result.reasoning}`);
          }
        })
        .catch(err => console.warn(`[Uniswap] ${agentBName} auto-stake failed:`, err))
    );
  }
  if (stakePromises.length > 0) {
    await withTimeout(Promise.all(stakePromises), 60_000, 'auto-stake');
  }

  // Run rounds until game ends
  let gameActive = true;
  let roundNumber = 0;
  let localScoreA = 0;
  let localScoreB = 0;
  const historyA: GameContext['history'] = [];
  const historyB: GameContext['history'] = [];

  while (gameActive) {
    roundNumber++;

    // Create round record and update match currentRound
    const [round] = await Promise.all([
      prismaQuery.round.create({
        data: {
          matchId: match.id,
          roundNumber,
          phase: 'NEGOTIATE',
        },
      }),
      prismaQuery.match.update({
        where: { id: match.id },
        data: { currentRound: roundNumber },
      }),
    ]);

    emitGameEvent(match.id, 'round_started', { round: roundNumber, phase: 'negotiate' });

    // Build game context for each agent (always use local scores since on-chain resolve is deferred)
    const scoreA = localScoreA;
    const scoreB = localScoreB;
    const ctxA: GameContext = {
      agentId: agentAId,
      matchId: match.id,
      round: roundNumber,
      yourScore: scoreA,
      opponentScore: scoreB,
      opponentName: agentBName,
      opponentIntelligence: opponentIntelForA,
      history: historyA,
      negotiations: [],
    };
    const ctxB: GameContext = {
      agentId: agentBId,
      matchId: match.id,
      round: roundNumber,
      yourScore: scoreB,
      opponentScore: scoreA,
      opponentName: agentAName,
      opponentIntelligence: opponentIntelForB,
      history: historyB,
      negotiations: [],
    };

    // Phase 1: Negotiation
    const { messagesA, messagesB } = await runNegotiationPhase(
      match.id, roundNumber,
      { name: agentAName, persona: personaA },
      { name: agentBName, persona: personaB },
      ctxA, ctxB, 2
    );

    // Save negotiations to DB
    for (let i = 0; i < messagesA.length; i++) {
      await prismaQuery.negotiation.create({
        data: { roundId: round.id, agentId: agentAId, message: messagesA[i], turn: i },
      });
    }
    for (let i = 0; i < messagesB.length; i++) {
      await prismaQuery.negotiation.create({
        data: { roundId: round.id, agentId: agentBId, message: messagesB[i], turn: i },
      });
    }

    // Archive negotiation transcript to 0G Log Store (immutable audit trail)
    // Await with timeout to prevent nonce conflicts but not block match indefinitely
    await withTimeout(
      uploadNegotiationTranscript(match.id, roundNumber, agentAName, agentBName, messagesA, messagesB)
        .then(rootHash => {
          if (rootHash) {
            emitGameEvent(match.id, 'onchain_tx', { chain: '0g', action: 'Upload Transcript', txHash: rootHash, agent: 'operator', round: roundNumber });
          }
          return rootHash;
        })
        .catch(err => console.warn('[Orchestrator] Transcript archival failed:', err)),
      30_000, '0G transcript upload'
    );

    // Phase 1.5: Commitment Bonds (agents can offer on-chain USDC as credible commitments)
    // Wrapped in timeout to prevent stuck tx.wait() from blocking the match indefinitely
    const commitmentBonds: CommitmentBond[] = [];
    if (config.agentAPrivateKey && config.agentBPrivateKey) {
      const bondResults = await withTimeout(
        Promise.all([
          agentDecideCommitment(
            agentAName, config.agentAPrivateKey, agentBName, agentBAddress,
            match.id, roundNumber, historyA, personaA.strategy
          ).catch(() => null),
          agentDecideCommitment(
            agentBName, config.agentBPrivateKey, agentAName, agentAAddress,
            match.id, roundNumber, historyB, personaB.strategy
          ).catch(() => null),
        ]),
        60_000, 'commitment bonds'
      );
      if (bondResults) {
        const [bondA, bondB] = bondResults;
        if (bondA) commitmentBonds.push(bondA);
        if (bondB) commitmentBonds.push(bondB);
      }
    }

    // Notify opponents about commitment bonds via AXL P2P
    for (const bond of commitmentBonds) {
      const bondMsg = createMessage(
        MessageType.GAME_STATE,
        bond.fromAgent,
        match.id,
        {
          phase: 'commitment_bond',
          round: roundNumber,
          data: {
            from: bond.fromAgent,
            to: bond.toAgent,
            amountUsdc: ethers.formatUnits(bond.amount, 6),
            condition: bond.condition,
            txHash: bond.txHash,
          },
        }
      );
      await axlManager.broadcastFromHub(bondMsg).catch(() => {});
    }

    // Phase 2: Decision (via 0G Compute)
    await prismaQuery.round.update({ where: { id: round.id }, data: { phase: 'COMMIT' } });
    emitGameEvent(match.id, 'phase_change', { round: roundNumber, phase: 'commit' });

    // Include commitment info in agent context
    const commitmentInfoA = commitmentBonds
      .map(b => b.fromAgent === agentAName
        ? `You sent ${ethers.formatUnits(b.amount, 6)} USDC to ${b.toAgent} (condition: "${b.condition}")`
        : `${b.fromAgent} sent you ${ethers.formatUnits(b.amount, 6)} USDC (condition: "${b.condition}")`)
      .join('; ');
    const commitmentInfoB = commitmentBonds
      .map(b => b.fromAgent === agentBName
        ? `You sent ${ethers.formatUnits(b.amount, 6)} USDC to ${b.toAgent} (condition: "${b.condition}")`
        : `${b.fromAgent} sent you ${ethers.formatUnits(b.amount, 6)} USDC (condition: "${b.condition}")`)
      .join('; ');

    const negotiationsForA = [...messagesB.map(m => `${agentBName}: ${m}`)];
    if (commitmentInfoA) negotiationsForA.push(`[COMMITMENT BONDS]: ${commitmentInfoA}`);
    const negotiationsForB = [...messagesA.map(m => `${agentAName}: ${m}`)];
    if (commitmentInfoB) negotiationsForB.push(`[COMMITMENT BONDS]: ${commitmentInfoB}`);

    const ctxAFinal: GameContext = { ...ctxA, negotiations: negotiationsForA };
    const ctxBFinal: GameContext = { ...ctxB, negotiations: negotiationsForB };

    const [decisionA, decisionB] = await Promise.all([
      getAgentFinalDecision(personaA, ctxAFinal),
      getAgentFinalDecision(personaB, ctxBFinal),
    ]);

    const moveA = decisionA.decision === 'defect' ? DEFECT : COOPERATE;
    const moveB = decisionB.decision === 'defect' ? DEFECT : COOPERATE;

    // Store reasoning + reflection to 0G Storage (sequential with timeout)
    // Sequential to avoid nonce conflicts (0G SDK uses same wallet internally).
    // Timeout so a slow storage node doesn't block the match.
    await withTimeout(
      uploadAgentReasoning(agentAName, match.id, roundNumber, {
        decision: decisionA.decision,
        reasoning: decisionA.reasoning,
        teeVerified: decisionA.teeVerified,
        reflection: decisionA.reflection,
        reflectionTeeVerified: decisionA.reflectionTeeVerified,
        decisionRevised: decisionA.decisionRevised,
      }).then(result => {
        if (result?.txHash) {
          emitGameEvent(match.id, 'onchain_tx', { chain: '0g', action: 'Upload Reasoning', txHash: result.txHash, agent: agentAName, round: roundNumber });
        }
        return result;
      }).catch(err => console.warn('[Orchestrator] Storage upload A failed:', err)),
      30_000, '0G reasoning upload A'
    );

    await withTimeout(
      uploadAgentReasoning(agentBName, match.id, roundNumber, {
        decision: decisionB.decision,
        reasoning: decisionB.reasoning,
        teeVerified: decisionB.teeVerified,
        reflection: decisionB.reflection,
        reflectionTeeVerified: decisionB.reflectionTeeVerified,
        decisionRevised: decisionB.decisionRevised,
      }).then(result => {
        if (result?.txHash) {
          emitGameEvent(match.id, 'onchain_tx', { chain: '0g', action: 'Upload Reasoning', txHash: result.txHash, agent: agentBName, round: roundNumber });
        }
        return result;
      }).catch(err => console.warn('[Orchestrator] Storage upload B failed:', err)),
      30_000, '0G reasoning upload B'
    );

    // Phase 3: Commit on-chain
    const secretA = nanoid(32);
    const secretB = nanoid(32);

    // Create on-chain match just before first commit to minimize commit window waste
    if (onChainId === 0) {
      try {
        const onChainResult = await createOnChainMatch(agentAAddress, agentBAddress, stakePerRound);
        onChainId = onChainResult.matchId;
        txHash = onChainResult.txHash;
        console.log(`[Orchestrator] Created on-chain match ${onChainId}, tx: ${txHash}`);
        emitGameEvent(match.id, 'onchain_tx', { chain: '0g', action: 'Create Match', txHash, agent: 'operator', round: roundNumber });

        // Update DB with real on-chain ID
        await prismaQuery.match.update({
          where: { id: match.id },
          data: { onChainId, txHash },
        });

        // Now open betting for round 1 (on-chain match exists)
        // Must await so the betting round exists on-chain BEFORE agents call placeBet
        const openBetTxHash1 = await openBettingForRound(onChainId, roundNumber, 300).catch(err => {
          console.warn('[Orchestrator] Failed to open betting:', err);
          return null;
        });
        if (openBetTxHash1) {
          emitGameEvent(match.id, 'onchain_tx', { chain: 'unichain', action: 'Open Betting', txHash: openBetTxHash1, agent: 'operator', round: roundNumber });
        }

        // Agent self-betting: each agent bets based on their decision + negotiation context
        const currentNegotiations = [
          ...messagesA.map(m => ({ agentName: agentAName, message: m })),
          ...messagesB.map(m => ({ agentName: agentBName, message: m })),
        ];

        const betPromises: Promise<unknown>[] = [];
        if (config.agentAPrivateKey) {
          betPromises.push(
            agentDecideBet(
              agentAName, config.agentAPrivateKey, match.id, onChainId, roundNumber,
              decisionA.decision, currentNegotiations,
              historyA, personaA.strategy, agentBName
            ).then(result => {
              if (result?.placed) {
                console.log(`[Orchestrator] ${agentAName} placed bet: outcome=${result.outcome}, amount=${result.amount} USDC`);
                emitGameEvent(match.id, 'agent_bet', { agent: agentAName, outcome: result.outcome, amount: result.amount, txHash: result.txHash, round: roundNumber });
              }
            }).catch(err => console.warn(`[Orchestrator] ${agentAName} bet failed:`, (err as Error).message))
          );
        }

        if (config.agentBPrivateKey) {
          betPromises.push(
            agentDecideBet(
              agentBName, config.agentBPrivateKey, match.id, onChainId, roundNumber,
              decisionB.decision, currentNegotiations,
              historyB, personaB.strategy, agentAName
            ).then(result => {
              if (result?.placed) {
                console.log(`[Orchestrator] ${agentBName} placed bet: outcome=${result.outcome}, amount=${result.amount} USDC`);
                emitGameEvent(match.id, 'agent_bet', { agent: agentBName, outcome: result.outcome, amount: result.amount, txHash: result.txHash, round: roundNumber });
              }
            }).catch(err => console.warn(`[Orchestrator] ${agentBName} bet failed:`, (err as Error).message))
          );
        }

        if (betPromises.length > 0) {
          await withTimeout(Promise.all(betPromises), 90_000, 'agent betting').catch(() => {});
        }
      } catch (err) {
        console.error('[Orchestrator] Failed to create on-chain match:', err);
        throw err;
      }
    } else if (roundNumber > 1) {
      // Resolve the PREVIOUS round on-chain right before committing the new round.
      // This starts the new round's commit deadline clock, so we do it last
      // after all slow work (negotiation, TEE, storage) is already done.
      const resolveTx = await resolveRoundOnChain(onChainId);
      // checkGameEnd advances the contract to the next round (sets new commit/reveal deadlines)
      await checkGameEndOnChain(onChainId);
      console.log(`[Orchestrator] Resolved round ${roundNumber - 1} on-chain, starting round ${roundNumber} deadline`);

      // Update the previous round's DB record with the resolve tx
      const prevRound = await prismaQuery.round.findFirst({
        where: { matchId: match.id, roundNumber: roundNumber - 1 },
      });
      if (prevRound) {
        await prismaQuery.round.update({
          where: { id: prevRound.id },
          data: { resolveTx },
        });
      }

      // Open betting for this round now that the on-chain round is active
      // Must await so the betting round exists on-chain BEFORE agents call placeBet
      const openBetTxHashN = await openBettingForRound(onChainId, roundNumber, 300).catch(err => {
        console.warn('[Orchestrator] Failed to open betting:', err);
        return null;
      });
      if (openBetTxHashN) {
        emitGameEvent(match.id, 'onchain_tx', { chain: 'unichain', action: 'Open Betting', txHash: openBetTxHashN, agent: 'operator', round: roundNumber });
      }

      // Agent self-betting: each agent bets based on their decision + negotiation context
      const currentNegotiations = [
        ...messagesA.map(m => ({ agentName: agentAName, message: m })),
        ...messagesB.map(m => ({ agentName: agentBName, message: m })),
      ];

      const betPromises: Promise<unknown>[] = [];
      if (config.agentAPrivateKey) {
        betPromises.push(
          agentDecideBet(
            agentAName, config.agentAPrivateKey, match.id, onChainId, roundNumber,
            decisionA.decision, currentNegotiations,
            historyA, personaA.strategy, agentBName
          ).then(result => {
            if (result?.placed) {
              console.log(`[Orchestrator] ${agentAName} placed bet: outcome=${result.outcome}, amount=${result.amount} USDC`);
              emitGameEvent(match.id, 'agent_bet', { agent: agentAName, outcome: result.outcome, amount: result.amount, txHash: result.txHash, round: roundNumber });
            }
          }).catch(err => console.warn(`[Orchestrator] ${agentAName} bet failed:`, (err as Error).message))
        );
      }

      if (config.agentBPrivateKey) {
        betPromises.push(
          agentDecideBet(
            agentBName, config.agentBPrivateKey, match.id, onChainId, roundNumber,
            decisionB.decision, currentNegotiations,
            historyB, personaB.strategy, agentAName
          ).then(result => {
            if (result?.placed) {
              console.log(`[Orchestrator] ${agentBName} placed bet: outcome=${result.outcome}, amount=${result.amount} USDC`);
              emitGameEvent(match.id, 'agent_bet', { agent: agentBName, outcome: result.outcome, amount: result.amount, txHash: result.txHash, round: roundNumber });
            }
          }).catch(err => console.warn(`[Orchestrator] ${agentBName} bet failed:`, (err as Error).message))
        );
      }

      if (betPromises.length > 0) {
        await withTimeout(Promise.all(betPromises), 90_000, 'agent betting').catch(() => {});
      }
    }

    const [commitResultA, commitResultB] = await Promise.all([
      commitMoveOnChain(onChainId, moveA, secretA, agentAAddress),
      commitMoveOnChain(onChainId, moveB, secretB, agentBAddress),
    ]);

    emitGameEvent(match.id, 'onchain_tx', { chain: '0g', action: 'Commit Move', txHash: commitResultA.txHash, agent: agentAName, round: roundNumber });
    emitGameEvent(match.id, 'onchain_tx', { chain: '0g', action: 'Commit Move', txHash: commitResultB.txHash, agent: agentBName, round: roundNumber });
    emitGameEvent(match.id, 'moves_committed', { round: roundNumber });

    // Broadcast commit notifications via AXL P2P
    const commitMsgA = createMessage<CommitNotifyMessage>(
      MessageType.COMMIT_NOTIFY,
      agentAName,
      match.id,
      { round: roundNumber, commitHash: commitResultA.commitment }
    );
    const commitMsgB = createMessage<CommitNotifyMessage>(
      MessageType.COMMIT_NOTIFY,
      agentBName,
      match.id,
      { round: roundNumber, commitHash: commitResultB.commitment }
    );
    await Promise.all([
      axlManager.broadcastFromHub(commitMsgA).catch(() => {}),
      axlManager.broadcastFromHub(commitMsgB).catch(() => {}),
    ]);

    // Phase 4: Reveal on-chain
    await prismaQuery.round.update({ where: { id: round.id }, data: { phase: 'REVEAL' } });
    emitGameEvent(match.id, 'phase_change', { round: roundNumber, phase: 'reveal' });

    // Wait for commit deadline to pass before revealing
    // Contract uses 0-indexed rounds (our roundNumber 1 = on-chain round 0)
    const onChainRound = roundNumber - 1;
    const roundState = await getRoundState(onChainId, onChainRound);
    const now = Math.floor(Date.now() / 1000);
    const waitMs = Math.max(0, (roundState.commitDeadline - now + 2) * 1000);
    if (waitMs > 0) {
      console.log(`[Orchestrator] Waiting ${Math.ceil(waitMs / 1000)}s for commit deadline...`);
      await sleep(waitMs);
    }

    const [revealTxA, revealTxB] = await Promise.all([
      revealMoveOnChain(onChainId, moveA, secretA, agentAAddress),
      revealMoveOnChain(onChainId, moveB, secretB, agentBAddress),
    ]);

    emitGameEvent(match.id, 'onchain_tx', { chain: '0g', action: 'Reveal Move', txHash: revealTxA, agent: agentAName, round: roundNumber, details: decisionA.decision });
    emitGameEvent(match.id, 'onchain_tx', { chain: '0g', action: 'Reveal Move', txHash: revealTxB, agent: agentBName, round: roundNumber, details: decisionB.decision });
    emitGameEvent(match.id, 'moves_revealed', {
      round: roundNumber,
      moveA: decisionA.decision,
      moveB: decisionB.decision,
    });

    // Broadcast reveal notifications via AXL P2P
    const revealMsgA = createMessage<RevealNotifyMessage>(
      MessageType.REVEAL_NOTIFY,
      agentAName,
      match.id,
      { round: roundNumber, decision: decisionA.decision, secret: secretA }
    );
    const revealMsgB = createMessage<RevealNotifyMessage>(
      MessageType.REVEAL_NOTIFY,
      agentBName,
      match.id,
      { round: roundNumber, decision: decisionB.decision, secret: secretB }
    );
    await Promise.all([
      axlManager.broadcastFromHub(revealMsgA).catch(() => {}),
      axlManager.broadcastFromHub(revealMsgB).catch(() => {}),
    ]);

    // Phase 5: Resolve on-chain
    // IMPORTANT: Defer resolveRound to right before the NEXT round's commit.
    // Calling resolveRound starts the next round's commit deadline clock on-chain.
    // If we resolve now, the deadline expires during negotiation/TEE/storage work.
    // Instead, save the resolve for later and use local payoffs for everything.
    const { payA, payB } = calculatePayoff(moveA, moveB);
    // Track that we need to resolve this round before the next commit
    let pendingResolveTx: string | null = null;

    await prismaQuery.round.update({
      where: { id: round.id },
      data: {
        phase: 'RESOLVED',
        moveA,
        moveB,
        scoreA: payA,
        scoreB: payB,
        commitA: commitResultA.commitment,
        commitB: commitResultB.commitment,
        secretA,
        secretB,
        commitTxA: commitResultA.txHash,
        commitTxB: commitResultB.txHash,
        revealTxA,
        revealTxB,
        inferenceIdA: decisionA.inferenceId,
        inferenceIdB: decisionB.inferenceId,
        teeVerifiedA: decisionA.teeVerified === true,
        teeVerifiedB: decisionB.teeVerified === true,
      },
    });

    emitGameEvent(match.id, 'round_resolved', {
      round: roundNumber,
      moveA: decisionA.decision,
      moveB: decisionB.decision,
      scoreA: payA,
      scoreB: payB,
      reasoningA: decisionA.reasoning,
      reasoningB: decisionB.reasoning,
      teeVerifiedA: decisionA.teeVerified,
      teeVerifiedB: decisionB.teeVerified,
      reflectionA: decisionA.reflection,
      reflectionB: decisionB.reflection,
      reflectionTeeVerifiedA: decisionA.reflectionTeeVerified,
      reflectionTeeVerifiedB: decisionB.reflectionTeeVerified,
      decisionRevisedA: decisionA.decisionRevised,
      decisionRevisedB: decisionB.decisionRevised,
    });

    // Settle betting with the actual outcome
    const settleTxHash = await settleBettingForRound(onChainId, roundNumber, moveA, moveB).catch(err => {
      console.warn('[Orchestrator] Failed to settle betting:', err);
      return null;
    });
    if (settleTxHash) {
      emitGameEvent(match.id, 'onchain_tx', { chain: 'unichain', action: 'Settle Round', txHash: settleTxHash, agent: 'operator', round: roundNumber, details: `A=${decisionA.decision}, B=${decisionB.decision}` });
    }

    // Only attempt claims if settlement was submitted successfully
    if (settleTxHash && config.agentAPrivateKey) {
      agentClaimBettingWinnings(config.agentAPrivateKey, onChainId, roundNumber, agentAName)
        .catch(err => console.warn(`[Orchestrator] ${agentAName} claim failed:`, (err as Error).message));
    }
    if (settleTxHash && config.agentBPrivateKey) {
      agentClaimBettingWinnings(config.agentBPrivateKey, onChainId, roundNumber, agentBName)
        .catch(err => console.warn(`[Orchestrator] ${agentBName} claim failed:`, (err as Error).message));
    }

    // Update local score tracking
    localScoreA += payA;
    localScoreB += payB;

    // Broadcast round result via AXL P2P mesh
    const roundResultMsg = createMessage<RoundResultMessage>(
      MessageType.ROUND_RESULT,
      'orchestrator',
      match.id,
      {
        round: roundNumber,
        moveA: moveA,
        moveB: moveB,
        scoreA: payA,
        scoreB: payB,
        totalScoreA: localScoreA,
        totalScoreB: localScoreB,
      }
    );
    await axlManager.broadcastFromHub(roundResultMsg).catch(() => {});

    // Update history
    historyA.push({ round: roundNumber, yourMove: decisionA.decision, opponentMove: decisionB.decision, yourScore: payA });
    historyB.push({ round: roundNumber, yourMove: decisionB.decision, opponentMove: decisionA.decision, yourScore: payB });

    // Phase 6: Check game end (local logic since on-chain resolve is deferred)
    // Random termination: ~20% chance to end after round 3, guaranteed end at round 10
    const shouldEnd = roundNumber >= 10 || (roundNumber >= 3 && Math.random() < 0.2);
    try {
      if (shouldEnd) {
        // Resolve on-chain before ending so the contract state is final
        await resolveRoundOnChain(onChainId);
        try { await checkGameEndOnChain(onChainId); } catch {}
        gameActive = false;
      }

      if (!gameActive) {
        await prismaQuery.match.update({
          where: { id: match.id },
          data: {
            status: 'COMPLETED',
            scoreA: localScoreA,
            scoreB: localScoreB,
            currentRound: roundNumber,
            endReason: 'random_termination_or_max_rounds',
            winnerId: localScoreA > localScoreB ? agentAId : localScoreB > localScoreA ? agentBId : null,
          },
        });

        emitGameEvent(match.id, 'match_ended', {
          finalScoreA: localScoreA,
          finalScoreB: localScoreB,
          rounds: roundNumber,
          winner: localScoreA > localScoreB ? agentAName : localScoreB > localScoreA ? agentBName : 'draw',
        });

        // Update agent leaderboard stats
        const coopsA = historyA.filter(h => h.yourMove === 'cooperate').length;
        const coopsB = historyB.filter(h => h.yourMove === 'cooperate').length;
        const coopRateA = coopsA / Math.max(roundNumber, 1);
        const coopRateB = coopsB / Math.max(roundNumber, 1);

        // Fetch current stats to compute weighted coop rate average
        const [agentARecord, agentBRecord] = await Promise.all([
          prismaQuery.agent.findUnique({ where: { id: agentAId }, select: { matchesPlayed: true, coopRate: true } }),
          prismaQuery.agent.findUnique({ where: { id: agentBId }, select: { matchesPlayed: true, coopRate: true } }),
        ]);
        const prevMatchesA = agentARecord?.matchesPlayed ?? 0;
        const prevMatchesB = agentBRecord?.matchesPlayed ?? 0;
        const avgCoopA = prevMatchesA > 0
          ? ((agentARecord!.coopRate * prevMatchesA) + coopRateA) / (prevMatchesA + 1)
          : coopRateA;
        const avgCoopB = prevMatchesB > 0
          ? ((agentBRecord!.coopRate * prevMatchesB) + coopRateB) / (prevMatchesB + 1)
          : coopRateB;

        await Promise.all([
          prismaQuery.agent.update({
            where: { id: agentAId },
            data: {
              matchesPlayed: { increment: 1 },
              totalScore: { increment: localScoreA },
              totalWins: { increment: localScoreA > localScoreB ? 1 : 0 },
              coopRate: avgCoopA,
            },
          }),
          prismaQuery.agent.update({
            where: { id: agentBId },
            data: {
              matchesPlayed: { increment: 1 },
              totalScore: { increment: localScoreB },
              totalWins: { increment: localScoreB > localScoreA ? 1 : 0 },
              coopRate: avgCoopB,
            },
          }),
        ]).catch(err => console.warn('[Orchestrator] Agent stats update failed:', err));

        // Save persistent memory to 0G Storage (cross-match learning)
        const roundsForA = historyA.map(h => ({
          myMove: h.yourMove,
          opponentMove: h.opponentMove,
          myScore: h.yourScore,
        }));
        const roundsForB = historyB.map(h => ({
          myMove: h.yourMove,
          opponentMove: h.opponentMove,
          myScore: h.yourScore,
        }));

        await Promise.all([
          recordMatchResult(agentAId, agentAName, agentBName, roundsForA, localScoreA > localScoreB)
            .catch(err => console.warn('[Orchestrator] Memory save A failed:', err)),
          recordMatchResult(agentBId, agentBName, agentAName, roundsForB, localScoreB > localScoreA)
            .catch(err => console.warn('[Orchestrator] Memory save B failed:', err)),
        ]);

        // Broadcast game over via AXL
        const gameOverMsg = createMessage<GameOverMessage>(
          MessageType.GAME_OVER,
          'orchestrator',
          match.id,
          {
            reason: 'match_completed',
            finalScoreA: localScoreA,
            finalScoreB: localScoreB,
            winner: localScoreA > localScoreB ? agentAName : localScoreB > localScoreA ? agentBName : null,
          }
        );
        await axlManager.broadcastFromHub(gameOverMsg).catch(() => {});

        // Auto-cashout: agents swap USDC->ETH via Uniswap after match ends
        // Non-blocking: failures do not affect match result
        if (config.agentAPrivateKey) {
          agentCashOut(agentAName, config.agentAPrivateKey)
            .then(result => {
              if (result.txHash) console.log(`[Uniswap] ${agentAName} auto-cashout: ${result.amount} ETH`);
            })
            .catch(err => console.warn(`[Uniswap] ${agentAName} auto-cashout failed:`, err));
        }
        if (config.agentBPrivateKey) {
          agentCashOut(agentBName, config.agentBPrivateKey)
            .then(result => {
              if (result.txHash) console.log(`[Uniswap] ${agentBName} auto-cashout: ${result.amount} ETH`);
            })
            .catch(err => console.warn(`[Uniswap] ${agentBName} auto-cashout failed:`, err));
        }
      }
    } catch (err) {
      console.error('[Orchestrator] checkGameEnd failed:', err);
      gameActive = false;
    }
  }

  return match.id;
}

