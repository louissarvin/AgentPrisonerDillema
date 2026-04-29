import { ethers } from 'ethers';
import { UNICHAIN_OPERATOR_KEY, BETTING_POOL_ADDRESS } from '../config/main-config.ts';
import { getProvider, getWallet, sendManagedTx, resyncWalletNonce } from '../lib/unichain-wallet.ts';

const BETTING_POOL_ABI = [
  'function openBettingRound(uint256 matchId, uint256 roundNumber, uint256 deadline) external',
  'function settleBettingRound(uint256 matchId, uint256 roundNumber, uint8 outcome) external',
  'function cancelBettingRound(uint256 matchId, uint256 roundNumber) external',
  'function getRound(uint256 matchId, uint256 roundNumber) external view returns (tuple(uint256 matchId, uint256 roundNumber, uint256 poolCooperate, uint256 poolDefect, uint256 poolMixed, uint8 result, bool settled, bool cancelled, uint256 bettingDeadline))',
  'function getTotalPool(uint256 matchId, uint256 roundNumber) external view returns (uint256)',
];

// Outcome enum matches contract: NONE=0, BOTH_COOPERATE=1, BOTH_DEFECT=2, MIXED=3
const COOPERATE = 0;
const DEFECT = 1;

// Operator wallet: created once at module level, connected to the shared provider
const operatorWallet = getWallet(UNICHAIN_OPERATOR_KEY);

function getBettingContract(): ethers.Contract {
  return new ethers.Contract(BETTING_POOL_ADDRESS, BETTING_POOL_ABI, operatorWallet);
}

// Check if a betting round exists on-chain (bettingDeadline > 0 means it was opened)
async function isRoundOpen(matchId: number, roundNumber: number): Promise<boolean> {
  try {
    const contract = getBettingContract();
    const round = await contract.getRound(matchId, roundNumber);
    return round.bettingDeadline > 0n;
  } catch {
    return false;
  }
}

// Convert game moves to betting outcome
function movesToOutcome(moveA: number, moveB: number): number {
  if (moveA === COOPERATE && moveB === COOPERATE) return 1; // BOTH_COOPERATE
  if (moveA === DEFECT && moveB === DEFECT) return 2;       // BOTH_DEFECT
  return 3;                                                   // MIXED
}

export async function openBettingForRound(onChainMatchId: number, roundNumber: number, deadlineSeconds: number = 120): Promise<string | null> {
  try {
    // Skip if already opened (idempotent)
    if (await isRoundOpen(onChainMatchId, roundNumber)) {
      console.log(`[Betting] Round ${onChainMatchId}/${roundNumber} already open, skipping`);
      return null;
    }

    console.log(`[Betting] Opening betting for match ${onChainMatchId} round ${roundNumber}...`);
    const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;
    const contract = getBettingContract();

    const tx = await sendManagedTx(
      operatorWallet,
      async ({ nonce, maxFeePerGas, maxPriorityFeePerGas }) => {
        return contract.openBettingRound(onChainMatchId, roundNumber, deadline, {
          nonce,
          maxFeePerGas,
          maxPriorityFeePerGas,
        });
      },
      `Open ${onChainMatchId}/R${roundNumber}`,
    );

    try {
      const receipt = await tx.wait(1, 120_000);
      console.log(`[Betting] Open ${onChainMatchId}/R${roundNumber} confirmed: ${receipt!.hash}`);
      return receipt!.hash;
    } catch {
      console.warn(`[Betting] Open ${onChainMatchId}/R${roundNumber} confirmation timed out (tx: ${tx.hash})`);
      await resyncWalletNonce(operatorWallet);
      return tx.hash;
    }
  } catch (err) {
    console.warn('[Betting] Failed to open betting round:', (err as Error).message);
    return null;
  }
}

export async function settleBettingForRound(onChainMatchId: number, roundNumber: number, moveA: number, moveB: number): Promise<string | null> {
  try {
    // Check if round exists on-chain before trying to settle
    if (!(await isRoundOpen(onChainMatchId, roundNumber))) {
      console.log(`[Betting] Round ${onChainMatchId}/${roundNumber} not open on-chain, skipping settle`);
      return null;
    }

    const outcome = movesToOutcome(moveA, moveB);
    console.log(`[Betting] Settling match ${onChainMatchId} round ${roundNumber}, outcome=${outcome}...`);
    const contract = getBettingContract();

    const tx = await sendManagedTx(
      operatorWallet,
      async ({ nonce, maxFeePerGas, maxPriorityFeePerGas }) => {
        return contract.settleBettingRound(onChainMatchId, roundNumber, outcome, {
          nonce,
          maxFeePerGas,
          maxPriorityFeePerGas,
        });
      },
      `Settle ${onChainMatchId}/R${roundNumber}`,
    );

    try {
      const receipt = await tx.wait(1, 120_000);
      console.log(`[Betting] Settle ${onChainMatchId}/R${roundNumber} confirmed: ${receipt!.hash}`);
      return receipt!.hash;
    } catch {
      console.warn(`[Betting] Settle ${onChainMatchId}/R${roundNumber} confirmation timed out (tx: ${tx.hash})`);
      await resyncWalletNonce(operatorWallet);
      return tx.hash;
    }
  } catch (err) {
    console.warn('[Betting] Failed to settle betting round:', (err as Error).message);
    return null;
  }
}

export async function cancelBettingForRound(onChainMatchId: number, roundNumber: number): Promise<string | null> {
  try {
    if (!(await isRoundOpen(onChainMatchId, roundNumber))) {
      console.log(`[Betting] Round ${onChainMatchId}/${roundNumber} not open, skipping cancel`);
      return null;
    }

    console.log(`[Betting] Cancelling match ${onChainMatchId} round ${roundNumber}...`);
    const contract = getBettingContract();

    const tx = await sendManagedTx(
      operatorWallet,
      async ({ nonce, maxFeePerGas, maxPriorityFeePerGas }) => {
        return contract.cancelBettingRound(onChainMatchId, roundNumber, {
          nonce,
          maxFeePerGas,
          maxPriorityFeePerGas,
        });
      },
      `Cancel ${onChainMatchId}/R${roundNumber}`,
    );

    try {
      const receipt = await tx.wait(1, 120_000);
      console.log(`[Betting] Cancel ${onChainMatchId}/R${roundNumber} confirmed: ${receipt!.hash}`);
      return receipt!.hash;
    } catch {
      console.warn(`[Betting] Cancel ${onChainMatchId}/R${roundNumber} confirmation timed out (tx: ${tx.hash})`);
      await resyncWalletNonce(operatorWallet);
      return tx.hash;
    }
  } catch (err) {
    console.warn('[Betting] Failed to cancel betting round:', (err as Error).message);
    return null;
  }
}

export { movesToOutcome };
