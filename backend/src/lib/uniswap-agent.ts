import { ethers } from 'ethers';
import { UNISWAP_API_KEY, UNICHAIN_USDC_ADDRESS } from '../config/main-config.ts';
import { getWallet, getProvider, sendManagedTx } from './unichain-wallet.ts';

const UNISWAP_API = 'https://trade-api.gateway.uniswap.org/v1';
const CHAIN_ID = 1301; // Unichain Sepolia
const ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-api-key': UNISWAP_API_KEY,
  'x-universal-router-version': '2.0',
};

export interface SwapResult {
  txHash: string;
  status: 'success' | 'failed';
  amountIn: string;
  amountOut: string;
  tokenIn: string;
  tokenOut: string;
}

export interface QuoteResult {
  amountIn: string;
  amountOut: string;
  gasFee: string;
  priceImpact: number;
  route: string;
}

/**
 * Check if a token is approved for Permit2 spending
 */
export async function checkApproval(
  walletAddress: string,
  token: string,
  amount: string
): Promise<{ needsApproval: boolean; approvalTx: any | null }> {
  const response = await fetch(`${UNISWAP_API}/check_approval`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      walletAddress,
      token,
      amount,
      chainId: CHAIN_ID,
    }),
  });

  if (!response.ok) {
    const errData = await response.json() as any;
    throw new Error(`Uniswap check_approval failed: ${errData.errorCode || response.status}`);
  }

  const data = await response.json() as any;
  return {
    needsApproval: data.approval !== null && data.approval !== undefined,
    approvalTx: data.approval || null,
  };
}

/**
 * Approve token for Permit2 (one-time per token per agent)
 */
export async function approveForPermit2(
  agentPrivateKey: string,
  tokenAddress: string,
): Promise<string> {
  const wallet = getWallet(agentPrivateKey);
  const erc20 = new ethers.Contract(
    tokenAddress,
    ['function approve(address spender, uint256 amount) returns (bool)'],
    wallet,
  );

  const tx = await sendManagedTx(
    wallet,
    async ({ nonce, maxFeePerGas, maxPriorityFeePerGas }) =>
      erc20.approve(PERMIT2_ADDRESS, ethers.MaxUint256, { nonce, maxFeePerGas, maxPriorityFeePerGas }),
    `Permit2 approve ${tokenAddress.slice(0, 10)}`,
  );
  const receipt = await tx.wait();
  console.log(`[Uniswap] Permit2 approval confirmed: ${receipt!.hash}`);
  return receipt!.hash;
}

/**
 * Get a swap quote from Uniswap Trading API
 */
export async function getQuote(
  swapperAddress: string,
  tokenIn: string,
  tokenOut: string,
  amount: string,
  type: 'EXACT_INPUT' | 'EXACT_OUTPUT' = 'EXACT_INPUT'
): Promise<{ quote: any; permitData: any | null }> {
  const response = await fetch(`${UNISWAP_API}/quote`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      type,
      amount,
      tokenIn,
      tokenOut,
      tokenInChainId: CHAIN_ID,
      tokenOutChainId: CHAIN_ID,
      swapper: swapperAddress,
      slippageTolerance: 1.0,
    }),
  });

  if (!response.ok) {
    const errData = await response.json() as any;
    throw new Error(`Uniswap quote failed: ${errData.errorCode || response.status}`);
  }

  const data = await response.json() as any;
  return {
    quote: data.quote || data,
    permitData: data.permitData || null,
  };
}

/**
 * Execute a full swap autonomously (agent signs everything server-side)
 */
export async function executeAgentSwap(
  agentPrivateKey: string,
  tokenIn: string,
  tokenOut: string,
  amount: string,
  type: 'EXACT_INPUT' | 'EXACT_OUTPUT' = 'EXACT_INPUT',
): Promise<SwapResult> {
  const wallet = getWallet(agentPrivateKey);
  const swapperAddress = wallet.address;

  console.log(`[Uniswap] Agent ${swapperAddress.slice(0, 10)}... swapping ${amount} ${tokenIn === ETH_ADDRESS ? 'ETH' : 'USDC'}`);

  // Step 1: Check and handle approval (only for ERC20 tokens, not native ETH)
  if (tokenIn !== ETH_ADDRESS) {
    const { needsApproval, approvalTx } = await checkApproval(swapperAddress, tokenIn, amount);

    if (needsApproval && approvalTx) {
      console.log('[Uniswap] Sending approval transaction...');
      const approveTx = await sendManagedTx(
        wallet,
        async ({ nonce, maxFeePerGas, maxPriorityFeePerGas }) =>
          wallet.sendTransaction({
            to: approvalTx.to,
            data: approvalTx.data,
            value: approvalTx.value || '0',
            gasLimit: approvalTx.gasLimit,
            nonce,
            maxFeePerGas,
            maxPriorityFeePerGas,
          }),
        'Uniswap approval',
      );
      await approveTx.wait();
      console.log(`[Uniswap] Approval confirmed: ${approveTx.hash}`);
    }
  }

  // Step 2: Get quote
  const { quote, permitData } = await getQuote(swapperAddress, tokenIn, tokenOut, amount, type);

  // Step 3: Sign Permit2 data if present
  let signature: string | undefined;
  if (permitData) {
    // Remove EIP712Domain from types (ethers handles it automatically)
    const { EIP712Domain, ...types } = permitData.types;
    signature = await wallet.signTypedData(
      permitData.domain,
      types,
      permitData.values,
    );
  }

  // Step 4: Build swap request body per Uniswap API spec
  const swapBody: Record<string, any> = { quote };
  if (signature) {
    swapBody.signature = signature;
  }
  if (permitData) {
    swapBody.permitData = permitData;
  }

  const swapResponse = await fetch(`${UNISWAP_API}/swap`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(swapBody),
  });

  if (!swapResponse.ok) {
    const errData = await swapResponse.json() as any;
    throw new Error(`Uniswap swap failed: ${JSON.stringify(errData)}`);
  }

  const swapData = await swapResponse.json() as any;
  const swapTx = swapData.swap;

  // Step 5: Sign and broadcast the swap transaction (nonce-managed)
  const txResponse = await sendManagedTx(
    wallet,
    async ({ nonce, maxFeePerGas, maxPriorityFeePerGas }) =>
      wallet.sendTransaction({
        to: swapTx.to,
        data: swapTx.data,
        value: swapTx.value || '0',
        gasLimit: swapTx.gasLimit || undefined,
        nonce,
        maxFeePerGas,
        maxPriorityFeePerGas,
      }),
    'Uniswap swap',
  );

  const receipt = await txResponse.wait();
  const success = receipt?.status === 1;

  console.log(`[Uniswap] Swap ${success ? 'SUCCESS' : 'FAILED'}: ${txResponse.hash}`);

  return {
    txHash: txResponse.hash,
    status: success ? 'success' : 'failed',
    amountIn: amount,
    amountOut: quote.output?.amount || quote.quote?.amountOut || '0',
    tokenIn,
    tokenOut,
  };
}

/**
 * Agent swaps ETH to USDC (for tournament staking)
 */
export async function agentSwapEthToUsdc(
  agentPrivateKey: string,
  ethAmountWei: string
): Promise<SwapResult> {
  return executeAgentSwap(
    agentPrivateKey,
    ETH_ADDRESS,
    UNICHAIN_USDC_ADDRESS,
    ethAmountWei,
    'EXACT_INPUT'
  );
}

/**
 * Agent swaps USDC to ETH (cashing out winnings)
 */
export async function agentSwapUsdcToEth(
  agentPrivateKey: string,
  usdcAmount: string // in base units (6 decimals)
): Promise<SwapResult> {
  return executeAgentSwap(
    agentPrivateKey,
    UNICHAIN_USDC_ADDRESS,
    ETH_ADDRESS,
    usdcAmount,
    'EXACT_INPUT'
  );
}

/**
 * Agent transfers USDC directly to another address (for commitment bonds)
 */
export async function agentTransferUsdc(
  agentPrivateKey: string,
  toAddress: string,
  usdcAmount: string, // in base units (6 decimals)
): Promise<string> {
  const wallet = getWallet(agentPrivateKey);
  const usdc = new ethers.Contract(
    UNICHAIN_USDC_ADDRESS,
    ['function transfer(address to, uint256 amount) returns (bool)'],
    wallet,
  );

  const tx = await sendManagedTx(
    wallet,
    async ({ nonce, maxFeePerGas, maxPriorityFeePerGas }) =>
      usdc.transfer(toAddress, usdcAmount, { nonce, maxFeePerGas, maxPriorityFeePerGas }),
    `USDC transfer to ${toAddress.slice(0, 10)}`,
  );

  try {
    const receipt = await tx.wait(1, 60_000);
    console.log(`[Uniswap] USDC transfer confirmed: ${receipt!.hash} (${usdcAmount} -> ${toAddress.slice(0, 10)}...)`);
    return receipt!.hash;
  } catch {
    console.warn(`[Uniswap] USDC transfer confirmation timed out (tx: ${tx.hash})`);
    return tx.hash;
  }
}

/**
 * Get agent's ETH and USDC balances on Unichain Sepolia
 */
export async function getAgentBalances(agentPrivateKey: string): Promise<{
  ethBalance: string;
  usdcBalance: string;
  ethFormatted: string;
  usdcFormatted: string;
}> {
  const wallet = getWallet(agentPrivateKey);
  const sharedProvider = getProvider();

  const [ethBalance, usdcBalance] = await Promise.all([
    sharedProvider.getBalance(wallet.address),
    new ethers.Contract(
      UNICHAIN_USDC_ADDRESS,
      ['function balanceOf(address) view returns (uint256)'],
      sharedProvider,
    ).balanceOf(wallet.address),
  ]);

  return {
    ethBalance: ethBalance.toString(),
    usdcBalance: usdcBalance.toString(),
    ethFormatted: ethers.formatEther(ethBalance),
    usdcFormatted: ethers.formatUnits(usdcBalance, 6),
  };
}

/**
 * Get a price quote without executing (for agent decision-making)
 */
export async function getSwapQuote(
  agentAddress: string,
  tokenIn: string,
  tokenOut: string,
  amount: string
): Promise<QuoteResult> {
  const { quote } = await getQuote(agentAddress, tokenIn, tokenOut, amount);

  return {
    amountIn: quote.input?.amount || amount,
    amountOut: quote.output?.amount || '0',
    gasFee: quote.gasFee || '0',
    priceImpact: quote.priceImpact || 0,
    route: quote.routeString || 'CLASSIC',
  };
}
