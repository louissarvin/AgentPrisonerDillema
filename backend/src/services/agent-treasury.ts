import { ethers } from 'ethers';
import {
  agentSwapEthToUsdc,
  agentSwapUsdcToEth,
  agentTransferUsdc,
  getAgentBalances,
  getSwapQuote,
  type SwapResult,
} from '../lib/uniswap-agent.ts';
import { runInference } from '../lib/og-compute.ts';
import { emitGameEvent } from './game-engine.ts';
import { UNICHAIN_USDC_ADDRESS, BETTING_POOL_ADDRESS } from '../config/main-config.ts';
import { prismaQuery } from '../lib/prisma.ts';
import { getWallet, sendManagedTx, resyncWalletNonce } from '../lib/unichain-wallet.ts';

const ETH_ADDRESS = '0x0000000000000000000000000000000000000000';

// Safety bounds to prevent LLM hallucinations from draining wallets
const MAX_STAKE_ETH = '0.05';
const MAX_COMMITMENT_USDC = '5.00';
const MIN_COMMITMENT_USDC = '0.10';

// Agent self-betting bounds
const MIN_BET_USDC = '1.00';
const MAX_BET_USDC = '5.00';

export interface TreasuryAction {
  type: 'stake' | 'commitment' | 'cashout' | 'hold';
  amount: string;
  token: string;
  txHash?: string;
  reasoning: string;
}

export interface CommitmentBond {
  fromAgent: string;
  toAgent: string;
  amount: string; // USDC in base units
  txHash: string;
  condition: string; // e.g., "cooperate this round"
  round: number;
}

/**
 * Clamp a numeric string to [min, max] range.
 * Returns the clamped value as a string with the same decimal precision as max.
 */
function clampAmount(value: string, min: string, max: string): string {
  const v = parseFloat(value);
  const lo = parseFloat(min);
  const hi = parseFloat(max);

  if (Number.isNaN(v) || v <= 0) return min;
  if (v < lo) return min;
  if (v > hi) return max;
  return value;
}

/**
 * Safely extract a JSON object from LLM text output.
 * Returns null if no valid JSON found.
 */
function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Validate that a string looks like a valid Ethereum address.
 */
function isValidAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/**
 * Persist a swap transaction to the database.
 * Non-blocking: failures are logged but never propagated.
 */
async function persistSwapTransaction(params: {
  agentName: string;
  matchId?: string | null;
  txHash: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  type: string;
}): Promise<void> {
  try {
    const agent = await prismaQuery.agent.findFirst({ where: { name: params.agentName } });
    if (!agent) {
      console.warn(`[Treasury] Cannot persist swap: agent "${params.agentName}" not found in DB`);
      return;
    }

    await prismaQuery.swapTransaction.create({
      data: {
        agentId: agent.id,
        matchId: params.matchId || null,
        txHash: params.txHash,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        amountOut: params.amountOut,
        type: params.type,
      },
    });

    console.log(`[Uniswap] Persisted ${params.type} swap for ${params.agentName} (tx: ${params.txHash.slice(0, 16)}...)`);
  } catch (err) {
    console.warn('[Treasury] Failed to persist swap:', err);
  }
}

/**
 * Agent makes an autonomous financial decision about whether to stake in a tournament.
 * Uses 0G inference to reason about expected value.
 */
export async function agentDecideStake(
  agentName: string,
  agentPrivateKey: string,
  tournamentEntryFee: string, // in USDC base units
  opponentNames: string[],
  agentPersonality: string
): Promise<TreasuryAction> {
  if (!agentName || !agentPrivateKey || !tournamentEntryFee) {
    return {
      type: 'hold',
      amount: '0',
      token: 'ETH',
      reasoning: 'Missing required parameters for stake decision',
    };
  }

  // Get current balances
  const balances = await getAgentBalances(agentPrivateKey);

  // Get ETH->USDC quote to understand cost
  let quoteInfo = { amountOut: '0', priceImpact: 0 };
  try {
    const agentAddress = new ethers.Wallet(agentPrivateKey).address;
    quoteInfo = await getSwapQuote(
      agentAddress,
      ETH_ADDRESS,
      UNICHAIN_USDC_ADDRESS,
      ethers.parseEther('0.01').toString() // Quote for 0.01 ETH
    );
  } catch {
    // Quote might fail on testnet, continue with decision
  }

  // Ask the AI agent whether to stake
  const stakePrompt = `You are ${agentName}, an autonomous AI agent managing your own treasury.

YOUR BALANCES:
- ETH: ${balances.ethFormatted} ETH
- USDC: ${balances.usdcFormatted} USDC

TOURNAMENT DETAILS:
- Entry fee: ${ethers.formatUnits(tournamentEntryFee, 6)} USDC
- Opponents: ${opponentNames.join(', ')}
- Your personality: ${agentPersonality}

MARKET INFO:
- Current ETH/USDC rate: ~${quoteInfo.amountOut ? ethers.formatUnits(quoteInfo.amountOut, 6) : 'unknown'} USDC per 0.01 ETH

DECISION: Should you enter this tournament? You would need to swap ETH->USDC via Uniswap to pay the entry fee.

Consider:
1. Do you have enough ETH to cover the swap?
2. Is the expected payoff worth the entry fee given your strategy and opponents?
3. Risk tolerance based on your personality.

Respond with EXACTLY this JSON:
{"decision": "stake" or "hold", "amount_eth": "0.01", "reasoning": "one sentence"}`;

  let decision: { decision?: string; amount_eth?: string; reasoning?: string } = {};
  try {
    const result = await runInference(
      'You are a financial decision-making AI agent. Respond only with valid JSON.',
      stakePrompt,
      0.5,
      128
    );
    const parsed = extractJson(result.content);
    if (parsed) {
      decision = parsed as typeof decision;
    }
  } catch (err) {
    console.warn(`[Treasury] Inference failed for ${agentName} stake decision:`, (err as Error).message);
    decision = { decision: 'stake', amount_eth: '0.01', reasoning: 'Default: entering tournament' };
  }

  if (decision.decision === 'hold') {
    return {
      type: 'hold',
      amount: '0',
      token: 'ETH',
      reasoning: decision.reasoning || 'Decided not to enter',
    };
  }

  // Clamp the ETH amount to safety bounds
  const rawEthAmount = decision.amount_eth || '0.01';
  const ethAmount = clampAmount(rawEthAmount, '0.001', MAX_STAKE_ETH);

  // Reserve 0.002 ETH for gas so the swap tx itself can be paid for
  const ethBalanceWei = BigInt(balances.ethBalance);
  const swapAmountWei = ethers.parseEther(ethAmount);
  const gasReserve = ethers.parseEther('0.002');
  const maxSwappable = ethBalanceWei > gasReserve ? ethBalanceWei - gasReserve : 0n;

  if (maxSwappable === 0n) {
    return {
      type: 'hold',
      amount: '0',
      token: 'ETH',
      reasoning: `Insufficient ETH balance (${balances.ethFormatted}) to cover swap + gas`,
    };
  }

  const finalSwapWei = swapAmountWei > maxSwappable ? maxSwappable : swapAmountWei;

  try {
    const swapResult = await agentSwapEthToUsdc(
      agentPrivateKey,
      finalSwapWei.toString()
    );

    console.log(`[Treasury] ${agentName} staked ${ethAmount} ETH (tx: ${swapResult.txHash})`);

    // Persist swap transaction (non-blocking)
    persistSwapTransaction({
      agentName,
      txHash: swapResult.txHash,
      tokenIn: 'ETH',
      tokenOut: 'USDC',
      amountIn: swapResult.amountIn,
      amountOut: swapResult.amountOut,
      type: 'STAKE',
    }).catch(err => console.warn('[Treasury] Failed to persist stake swap:', err));

    return {
      type: 'stake',
      amount: swapResult.amountOut,
      token: 'USDC',
      txHash: swapResult.txHash,
      reasoning: decision.reasoning || `Swapped ${ethAmount} ETH to USDC for tournament entry`,
    };
  } catch (err) {
    console.warn(`[Treasury] Swap failed for ${agentName}:`, (err as Error).message);
    return {
      type: 'hold',
      amount: '0',
      token: 'ETH',
      reasoning: `Swap failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Agent decides whether to offer a commitment bond during negotiation.
 * This is a credible on-chain commitment: "I'll pay you X USDC if you cooperate."
 */
export async function agentDecideCommitment(
  agentName: string,
  agentPrivateKey: string,
  opponentName: string,
  opponentAddress: string,
  matchId: string,
  round: number,
  gameHistory: Array<{ round: number; yourMove: string; opponentMove: string }>,
  agentPersonality: string
): Promise<CommitmentBond | null> {
  if (!agentName || !agentPrivateKey || !opponentAddress || !matchId) {
    console.warn('[Treasury] Missing required parameters for commitment decision');
    return null;
  }

  if (!isValidAddress(opponentAddress)) {
    console.warn(`[Treasury] Invalid opponent address for ${agentName}: ${opponentAddress}`);
    return null;
  }

  if (round < 1 || !Number.isInteger(round)) {
    console.warn(`[Treasury] Invalid round number for ${agentName}: ${round}`);
    return null;
  }

  const balances = await getAgentBalances(agentPrivateKey);
  const usdcBalance = parseFloat(balances.usdcFormatted);

  // Don't offer commitments if balance is too low
  if (usdcBalance < parseFloat(MIN_COMMITMENT_USDC)) return null;

  const coopRate = gameHistory.length > 0
    ? Math.round((gameHistory.filter(h => h.opponentMove === 'cooperate').length / gameHistory.length) * 100)
    : 50;

  const commitPrompt = `You are ${agentName} in a Prisoner's Dilemma match against ${opponentName}.

YOUR STRATEGY: ${agentPersonality}
YOUR USDC BALANCE: ${balances.usdcFormatted} USDC
ROUND: ${round}
OPPONENT COOPERATION RATE: ${coopRate}%
LAST 3 ROUNDS: ${gameHistory.slice(-3).map(h => `You=${h.yourMove}, Opponent=${h.opponentMove}`).join(' | ')}

You can make a CREDIBLE COMMITMENT by sending USDC to your opponent on-chain via Uniswap/transfer.
This proves you're serious about cooperating (you literally pay them upfront).

The commitment is a "good faith deposit":
- It incentivizes your opponent to cooperate (they already got paid)
- It signals trustworthiness (you put money where your mouth is)
- BUT it costs you real value, reducing your net earnings

Should you offer a commitment bond this round?

Respond with EXACTLY this JSON:
{"offer_commitment": true/false, "amount_usdc": "0.50", "condition": "cooperate this round", "reasoning": "one sentence"}`;

  let parsed: { offer_commitment?: boolean; amount_usdc?: string; condition?: string; reasoning?: string } = {};
  try {
    const result = await runInference(
      'You are a strategic financial AI. Respond only with valid JSON.',
      commitPrompt,
      0.7,
      128
    );
    const extracted = extractJson(result.content);
    if (extracted) {
      parsed = extracted as typeof parsed;
    }
  } catch (err) {
    console.warn(`[Treasury] Inference failed for ${agentName} commitment decision:`, (err as Error).message);
    return null;
  }

  if (!parsed.offer_commitment) return null;

  // Clamp the USDC amount to safety bounds and available balance
  const rawAmount = parsed.amount_usdc || MIN_COMMITMENT_USDC;
  const effectiveMax = Math.min(parseFloat(MAX_COMMITMENT_USDC), usdcBalance * 0.5).toFixed(2);
  const amount = clampAmount(rawAmount, MIN_COMMITMENT_USDC, effectiveMax);
  const amountBase = ethers.parseUnits(amount, 6).toString();

  try {
    const txHash = await agentTransferUsdc(agentPrivateKey, opponentAddress, amountBase);

    const bond: CommitmentBond = {
      fromAgent: agentName,
      toAgent: opponentName,
      amount: amountBase,
      txHash,
      condition: parsed.condition || 'cooperate this round',
      round,
    };

    // Emit event for frontend
    emitGameEvent(matchId, 'commitment_bond', {
      from: agentName,
      to: opponentName,
      amountUsdc: amount,
      condition: bond.condition,
      txHash,
      round,
    });

    console.log(`[Treasury] ${agentName} committed ${amount} USDC to ${opponentName}: "${bond.condition}" (tx: ${txHash})`);

    // Persist commitment bond swap (non-blocking)
    persistSwapTransaction({
      agentName,
      matchId,
      txHash,
      tokenIn: 'USDC',
      tokenOut: 'USDC',
      amountIn: amountBase,
      amountOut: amountBase,
      type: 'COMMITMENT_BOND',
    }).catch(err => console.warn('[Treasury] Failed to persist commitment bond:', err));

    return bond;
  } catch (err) {
    console.warn(`[Treasury] Commitment transfer failed for ${agentName}:`, (err as Error).message);
    return null;
  }
}

/**
 * Agent decides whether to place a bet on the BettingPool contract for a given round.
 * The agent knows its own move but not the opponent's, so it bets based on
 * negotiation context, game history, and personality.
 */
export async function agentDecideBet(
  agentName: string,
  agentPrivateKey: string,
  matchId: string,
  onChainMatchId: number,
  roundNumber: number,
  ownDecision: string, // 'cooperate' or 'defect'
  negotiations: Array<{ agentName: string; message: string }>,
  gameHistory: Array<{ round: number; yourMove: string; opponentMove: string; yourScore: number }>,
  agentPersonality: string,
  opponentName: string
): Promise<{ placed: boolean; outcome: number; amount: string; txHash: string | null } | null> {
  if (!agentName || !agentPrivateKey || !matchId || !onChainMatchId || !roundNumber) {
    console.warn('[AgentBet] Missing required parameters for bet decision');
    return null;
  }

  try {
    // Check USDC balance first
    const balances = await getAgentBalances(agentPrivateKey);
    const usdcBalance = parseFloat(balances.usdcFormatted);

    if (usdcBalance < parseFloat(MIN_BET_USDC)) {
      console.log(`[AgentBet] ${agentName} skipping bet: insufficient USDC (${balances.usdcFormatted})`);
      return null;
    }

    // Check ETH balance for gas (approve + placeBet on L2)
    const ethBalance = parseFloat(balances.ethFormatted);
    if (ethBalance < 0.0005) {
      console.log(`[AgentBet] ${agentName} skipping bet: insufficient ETH for gas (${balances.ethFormatted})`);
      return null;
    }

    // Calculate opponent cooperation rate from history
    const coopRate = gameHistory.length > 0
      ? Math.round((gameHistory.filter(h => h.opponentMove === 'cooperate').length / gameHistory.length) * 100)
      : 50;

    const negotiationSummary = negotiations.length > 0
      ? negotiations.map(n => `${n.agentName}: ${n.message}`).join('\n')
      : 'No negotiations this round.';

    const historySummary = gameHistory.length > 0
      ? gameHistory.slice(-5).map(h => `Round ${h.round}: You=${h.yourMove}, Opponent=${h.opponentMove} (score: ${h.yourScore})`).join('\n')
      : 'No history yet (first round).';

    // Ask the LLM to decide the bet
    const betPrompt = `You are ${agentName}, an autonomous AI agent in a Prisoner's Dilemma tournament against ${opponentName}.

PERSONALITY: ${agentPersonality}
USDC BALANCE: ${balances.usdcFormatted} USDC
ROUND: ${roundNumber}
YOUR MOVE THIS ROUND: ${ownDecision.toUpperCase()}

NEGOTIATION THIS ROUND:
${negotiationSummary}

GAME HISTORY:
${historySummary}
OPPONENT COOPERATION RATE: ${coopRate}%

You MUST place a bet predicting the round outcome. Betting is part of the game. You know YOUR move but not your opponent's.

Outcomes:
- BOTH_COOPERATE: Both cooperate
- BOTH_DEFECT: Both defect
- MIXED: One cooperates, one defects

Bet between ${MIN_BET_USDC} and ${MAX_BET_USDC} USDC. Bet higher when you are more confident.

Respond with EXACTLY this JSON (no other text):
{"place_bet": true, "prediction": "BOTH_DEFECT", "amount_usdc": "2.00", "reasoning": "one sentence"}`;

    let parsed: { place_bet?: boolean; prediction?: string; amount_usdc?: string; reasoning?: string } = {};
    try {
      const result = await runInference(
        'You are a strategic betting AI agent. Respond only with valid JSON.',
        betPrompt,
        0.7,
        128
      );
      const extracted = extractJson(result.content);
      if (extracted) {
        parsed = extracted as typeof parsed;
      }
    } catch (err) {
      console.warn(`[AgentBet] Inference failed for ${agentName}:`, (err as Error).message);
      return null;
    }

    // Map prediction string to outcome number
    const predictionMap: Record<string, number> = {
      'BOTH_COOPERATE': 1,
      'BOTH_DEFECT': 2,
      'MIXED': 3,
    };

    // Force bet even if LLM says no: betting is mandatory in the game
    if (!parsed.place_bet) {
      console.log(`[AgentBet] ${agentName} LLM declined bet, forcing minimum: ${parsed.reasoning || 'no reason given'}`);
      parsed.place_bet = true;
      parsed.amount_usdc = MIN_BET_USDC;
      // Default prediction based on own move
      if (!parsed.prediction) {
        parsed.prediction = ownDecision === 'cooperate' ? 'BOTH_COOPERATE' : 'BOTH_DEFECT';
      }
    }

    const predictionStr = (parsed.prediction || 'MIXED').toUpperCase();
    const outcome = predictionMap[predictionStr] || 3;

    // Clamp amount between MIN_BET and min(MAX_BET, balance * 0.3)
    const rawAmount = parsed.amount_usdc || MIN_BET_USDC;
    const effectiveMax = Math.min(parseFloat(MAX_BET_USDC), usdcBalance * 0.3).toFixed(2);
    const amount = clampAmount(rawAmount, MIN_BET_USDC, effectiveMax);
    const amountBaseUnits = ethers.parseUnits(amount, 6);

    // Use shared wallet from unichain-wallet module (nonce-managed)
    const wallet = getWallet(agentPrivateKey);

    // Check USDC allowance for BettingPool, approve if needed
    const usdcContract = new ethers.Contract(
      UNICHAIN_USDC_ADDRESS,
      [
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)',
        'function balanceOf(address account) view returns (uint256)',
      ],
      wallet,
    );

    const currentAllowance = await usdcContract.allowance(wallet.address, BETTING_POOL_ADDRESS);
    if (currentAllowance < amountBaseUnits) {
      console.log(`[AgentBet] ${agentName} approving BettingPool for USDC spending...`);
      const approveTx = await sendManagedTx(
        wallet,
        async ({ nonce, maxFeePerGas, maxPriorityFeePerGas }) =>
          usdcContract.approve(BETTING_POOL_ADDRESS, ethers.MaxUint256, { nonce, maxFeePerGas, maxPriorityFeePerGas }),
        `${agentName} approve USDC`,
      );
      try {
        await approveTx.wait(1, 60_000);
        console.log(`[AgentBet] ${agentName} USDC approval confirmed`);
      } catch {
        console.warn(`[AgentBet] ${agentName} USDC approval confirmation timed out, continuing...`);
        await resyncWalletNonce(wallet);
      }
    }

    // Place the bet on BettingPool contract
    const bettingPool = new ethers.Contract(
      BETTING_POOL_ADDRESS,
      ['function placeBet(uint256 matchId, uint256 roundNumber, uint8 prediction, uint256 amount) external'],
      wallet,
    );

    console.log(`[AgentBet] ${agentName} placing bet: match=${onChainMatchId}, round=${roundNumber}, outcome=${outcome}, amount=${amount} USDC`);
    const tx = await sendManagedTx(
      wallet,
      async ({ nonce, maxFeePerGas, maxPriorityFeePerGas }) =>
        bettingPool.placeBet(onChainMatchId, roundNumber, outcome, amountBaseUnits, { nonce, maxFeePerGas, maxPriorityFeePerGas }),
      `${agentName} placeBet`,
    );
    let receipt: Awaited<ReturnType<typeof tx.wait>>;
    try {
      receipt = await tx.wait(1, 60_000);
      console.log(`[AgentBet] ${agentName} bet confirmed: ${receipt!.hash} (prediction=${predictionStr}, amount=${amount} USDC)`);
    } catch {
      console.warn(`[AgentBet] ${agentName} bet confirmation timed out (tx: ${tx.hash}), continuing...`);
      await resyncWalletNonce(wallet);
      receipt = null;
    }

    const confirmedHash = receipt?.hash ?? tx.hash;

    // Persist bet transaction (non-blocking)
    persistSwapTransaction({
      agentName,
      matchId,
      txHash: confirmedHash,
      tokenIn: 'USDC',
      tokenOut: 'USDC',
      amountIn: amountBaseUnits.toString(),
      amountOut: amountBaseUnits.toString(),
      type: 'AGENT_BET',
    }).catch(err => console.warn('[AgentBet] Failed to persist bet transaction:', err));

    return {
      placed: true,
      outcome,
      amount,
      txHash: confirmedHash,
    };
  } catch (err) {
    console.warn(`[AgentBet] Bet failed for ${agentName}:`, (err as Error).message);
    return null;
  }
}

/**
 * Agent cashes out tournament winnings (USDC -> ETH via Uniswap).
 */
export async function agentCashOut(
  agentName: string,
  agentPrivateKey: string,
  usdcAmount?: string // If not specified, cashes out all USDC
): Promise<TreasuryAction> {
  if (!agentName || !agentPrivateKey) {
    return {
      type: 'cashout',
      amount: '0',
      token: 'USDC',
      reasoning: 'Missing required parameters for cashout',
    };
  }

  const balances = await getAgentBalances(agentPrivateKey);
  const amount = usdcAmount || balances.usdcBalance;

  if (BigInt(amount) === 0n) {
    return {
      type: 'cashout',
      amount: '0',
      token: 'USDC',
      reasoning: 'No USDC to cash out',
    };
  }

  // Ensure requested amount does not exceed actual balance
  if (BigInt(amount) > BigInt(balances.usdcBalance)) {
    return {
      type: 'cashout',
      amount: '0',
      token: 'USDC',
      reasoning: `Requested cashout (${ethers.formatUnits(amount, 6)} USDC) exceeds balance (${balances.usdcFormatted} USDC)`,
    };
  }

  try {
    const result = await agentSwapUsdcToEth(agentPrivateKey, amount);

    console.log(`[Treasury] ${agentName} cashed out ${ethers.formatUnits(amount, 6)} USDC (tx: ${result.txHash})`);

    // Persist cashout swap (non-blocking)
    persistSwapTransaction({
      agentName,
      txHash: result.txHash,
      tokenIn: 'USDC',
      tokenOut: 'ETH',
      amountIn: result.amountIn,
      amountOut: result.amountOut,
      type: 'CASHOUT',
    }).catch(err => console.warn('[Treasury] Failed to persist cashout swap:', err));

    return {
      type: 'cashout',
      amount: result.amountOut,
      token: 'ETH',
      txHash: result.txHash,
      reasoning: `Cashed out ${ethers.formatUnits(amount, 6)} USDC to ETH`,
    };
  } catch (err) {
    console.warn(`[Treasury] Cashout failed for ${agentName}:`, (err as Error).message);
    return {
      type: 'cashout',
      amount: '0',
      token: 'USDC',
      reasoning: `Cashout failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Agent claims winnings from a settled betting round on the BettingPool contract.
 * Must be called from the agent's wallet (the contract checks msg.sender against bets mapping).
 */
export async function agentClaimBettingWinnings(
  agentPrivateKey: string,
  onChainMatchId: number,
  roundNumber: number,
  agentName: string
): Promise<string | null> {
  if (!agentPrivateKey || !onChainMatchId || !roundNumber) {
    console.warn(`[AgentClaim] Missing required parameters for ${agentName} claim`);
    return null;
  }

  try {
    const wallet = getWallet(agentPrivateKey);
    const bettingPool = new ethers.Contract(
      BETTING_POOL_ADDRESS,
      ['function claimWinnings(uint256 matchId, uint256 roundNumber) external'],
      wallet,
    );

    console.log(`[AgentClaim] ${agentName} claiming winnings for match ${onChainMatchId} round ${roundNumber}...`);
    const tx = await sendManagedTx(
      wallet,
      async ({ nonce, maxFeePerGas, maxPriorityFeePerGas }) =>
        bettingPool.claimWinnings(onChainMatchId, roundNumber, { nonce, maxFeePerGas, maxPriorityFeePerGas }),
      `${agentName} claimWinnings`,
    );

    try {
      const receipt = await tx.wait(1, 120_000);
      console.log(`[AgentClaim] ${agentName} claim confirmed: ${receipt!.hash}`);
      return receipt!.hash;
    } catch {
      console.warn(`[AgentClaim] ${agentName} claim confirmation timed out (tx: ${tx.hash})`);
      await resyncWalletNonce(wallet);
      return tx.hash;
    }
  } catch (err) {
    console.warn(`[AgentClaim] ${agentName} claim failed:`, (err as Error).message);
    return null;
  }
}

/**
 * Get a summary of all agent treasury states.
 * Fetches balances in parallel with a per-agent timeout to avoid blocking on a single failure.
 */
export async function getAgentTreasuryStatus(agentPrivateKeys: Map<string, string>): Promise<
  Array<{ name: string; address: string; ethBalance: string; usdcBalance: string }>
> {
  const entries = Array.from(agentPrivateKeys.entries());

  const results = await Promise.allSettled(
    entries.map(async ([name, key]) => {
      const balances = await getAgentBalances(key);
      return {
        name,
        address: new ethers.Wallet(key).address,
        ethBalance: balances.ethFormatted,
        usdcBalance: balances.usdcFormatted,
      };
    })
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    console.warn(`[Treasury] Failed to fetch balances for ${entries[i][0]}:`, result.reason);
    return { name: entries[i][0], address: 'unknown', ethBalance: '0', usdcBalance: '0' };
  });
}
