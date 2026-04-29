/**
 * Shared Unichain Sepolia provider + per-wallet nonce manager.
 * All Unichain transactions MUST go through this module to avoid nonce collisions.
 *
 * Why: Unichain Sepolia (OP Stack L2, chain 1301) has slow/delayed RPC nonce
 * updates. Multiple services sending txs from the same wallet will get duplicate
 * nonces unless we track them locally and serialize per-wallet.
 */

import { ethers } from 'ethers';
import { UNICHAIN_RPC_URL } from '../config/main-config.ts';

// ---------------------------------------------------------------------------
// Single shared provider (one connection pool for all Unichain reads/writes)
// ---------------------------------------------------------------------------
const provider = new ethers.JsonRpcProvider(UNICHAIN_RPC_URL);

// ---------------------------------------------------------------------------
// Per-wallet nonce tracking
// ---------------------------------------------------------------------------
const nonceMap = new Map<string, number>();

// ---------------------------------------------------------------------------
// Per-wallet mutex: serialize txs from the same address across all callers
// ---------------------------------------------------------------------------
const mutexMap = new Map<string, Promise<unknown>>();

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Returns the singleton Unichain Sepolia provider. */
export function getProvider(): ethers.JsonRpcProvider {
  return provider;
}

/** Returns a wallet connected to the shared provider. */
export function getWallet(privateKey: string): ethers.Wallet {
  return new ethers.Wallet(privateKey, provider);
}

// ---------------------------------------------------------------------------
// Nonce management (internal)
// ---------------------------------------------------------------------------

/** Get (or initialize) the locally tracked nonce for an address.
 *  Always validates against the pending on-chain nonce to detect dropped txs.
 *  Since sendManagedTx is mutex-serialized per wallet, the extra RPC call is safe. */
async function getLocalNonce(address: string): Promise<number> {
  const onChainPending = await provider.getTransactionCount(address, 'pending');
  const local = nonceMap.get(address);

  // If we have a local tracking and it's reasonable (at or slightly above chain), use it.
  // If local is way ahead of chain (dropped txs) or uninitialized, use chain value.
  if (local !== undefined && local >= onChainPending && local <= onChainPending + 1) {
    return local;
  }

  // Resync: either first call, or local drifted from chain
  nonceMap.set(address, onChainPending);
  return onChainPending;
}

/** Force re-sync the local nonce from the chain. */
async function resyncNonce(address: string): Promise<number> {
  const onChainNonce = await provider.getTransactionCount(address, 'latest');
  nonceMap.set(address, onChainNonce);
  return onChainNonce;
}

/** Public wrapper: resync the nonce tracker for a given wallet after a dropped tx. */
export async function resyncWalletNonce(wallet: ethers.Wallet): Promise<void> {
  const address = wallet.address.toLowerCase();
  const nonce = await resyncNonce(address);
  console.log(`[UniWallet] Resynced nonce for ${address.slice(0, 10)}...: ${nonce}`);
}

// ---------------------------------------------------------------------------
// Fee helpers
// ---------------------------------------------------------------------------

/**
 * Fetch current fee data and apply a configurable multiplier.
 * Default multiplier is 3x to handle OP Stack base-fee spikes.
 */
export async function getFeeOverrides(gasBumpMultiplier: bigint = 3n): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}> {
  const feeData = await provider.getFeeData();
  return {
    maxFeePerGas: (feeData.maxFeePerGas ?? 2_000_000n) * gasBumpMultiplier,
    maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas ?? 1_000_000n) * gasBumpMultiplier,
  };
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function isNonceUsedError(err: unknown): boolean {
  const msg = String((err as any)?.message || '').toLowerCase();
  return msg.includes('nonce has already been used') || msg.includes('nonce too low');
}

function isReplacementFeeError(err: unknown): boolean {
  const msg = String((err as any)?.message || '').toLowerCase();
  return (
    msg.includes('replacement fee too low') ||
    msg.includes('replacement transaction underpriced')
  );
}

// ---------------------------------------------------------------------------
// Managed transaction sender
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;

/**
 * Send a transaction with local nonce management.
 *
 * - Serializes all txs from the same wallet address via a per-wallet mutex.
 * - Assigns the locally tracked nonce.
 * - On "nonce already used": re-syncs from RPC and retries.
 * - On "replacement fee too low": bumps gas 2x and retries (up to MAX_RETRIES).
 * - Returns the TransactionResponse so the caller can `await tx.wait()`.
 *
 * @param wallet   The ethers Wallet (must be connected to the shared provider).
 * @param buildTx  A callback that receives { nonce, maxFeePerGas, maxPriorityFeePerGas }
 *                 and must return the submitted TransactionResponse.
 * @param label    Human-readable label for log lines.
 */
export async function sendManagedTx(
  wallet: ethers.Wallet,
  buildTx: (overrides: {
    nonce: number;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }) => Promise<ethers.TransactionResponse>,
  label: string = 'tx',
): Promise<ethers.TransactionResponse> {
  const address = wallet.address.toLowerCase();

  // Per-wallet serialization: chain off the previous promise for this address
  const prev = mutexMap.get(address) || Promise.resolve();
  const current = prev
    .then(() => _sendManaged(wallet, buildTx, label))
    .catch((err) => {
      // Re-throw so the caller gets the error, but don't break the chain
      throw err;
    });

  // Update mutex; swallow rejections so subsequent txs can still proceed
  mutexMap.set(address, current.catch(() => {}));
  return current;
}

/** Internal: the actual send-with-retry logic. */
async function _sendManaged(
  wallet: ethers.Wallet,
  buildTx: (overrides: {
    nonce: number;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }) => Promise<ethers.TransactionResponse>,
  label: string,
): Promise<ethers.TransactionResponse> {
  const address = wallet.address.toLowerCase();
  let gasBump = 10n; // 10x on L2 where gas is cheap; prevents mempool drops

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const nonce = await getLocalNonce(address);
    const fees = await getFeeOverrides(gasBump);

    try {
      const tx = await buildTx({ nonce, ...fees });

      // Success: increment local nonce for next tx
      nonceMap.set(address, nonce + 1);
      console.log(
        `[UniWallet] ${label} submitted: ${tx.hash} (nonce=${nonce}, gasBump=${gasBump}x)`,
      );
      return tx;
    } catch (err) {
      if (isNonceUsedError(err)) {
        console.warn(
          `[UniWallet] ${label} nonce ${nonce} already used, re-syncing...`,
        );
        await resyncNonce(address);
        continue;
      }

      if (isReplacementFeeError(err) && attempt < MAX_RETRIES) {
        gasBump *= 2n;
        console.warn(
          `[UniWallet] ${label} replacement fee too low, bumping gas to ${gasBump}x ` +
            `(attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        // Also resync nonce in case it drifted
        await resyncNonce(address);
        continue;
      }

      // Unrecoverable error or exhausted retries
      throw err;
    }
  }

  throw new Error(`[UniWallet] ${label} failed after ${MAX_RETRIES} retries`);
}

