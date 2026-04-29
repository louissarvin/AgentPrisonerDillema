import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';
import { ZG_PRIVATE_KEY, ZG_RPC_URL } from '../config/main-config.ts';
import { sleep } from '../utils/miscUtils.ts';

export interface InferenceResult {
  content: string;
  chatId: string;
  teeVerified: boolean | null;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

let brokerInstance: Awaited<ReturnType<typeof createZGComputeNetworkBroker>> | null = null;
let providerAddress: string | null = null;

const MODEL = 'qwen/qwen-2.5-7b-instruct';

async function getBroker() {
  if (brokerInstance) return brokerInstance;

  const provider = new ethers.JsonRpcProvider(ZG_RPC_URL);
  const wallet = new ethers.Wallet(ZG_PRIVATE_KEY, provider);
  brokerInstance = await createZGComputeNetworkBroker(wallet);
  return brokerInstance;
}

async function getProviderAddress(): Promise<string> {
  if (providerAddress) return providerAddress;

  const broker = await getBroker();
  const services = await broker.inference.listService();
  const service = services.find((s: any) => s.model === MODEL);

  if (!service) {
    throw new Error(`Model ${MODEL} not found on 0G testnet. Available: ${services.map((s: any) => s.model).join(', ')}`);
  }

  providerAddress = service.provider;
  return providerAddress;
}

export async function initializeCompute(): Promise<void> {
  const broker = await getBroker();
  const addr = await getProviderAddress();

  // Ensure provider is acknowledged
  const isAcked = await broker.inference.acknowledged(addr);
  if (!isAcked) {
    console.log('[0G Compute] Acknowledging provider signer...');
    await broker.inference.acknowledgeProviderSigner(addr);
    console.log('[0G Compute] Provider acknowledged');
  }

  console.log(`[0G Compute] Initialized with model: ${MODEL}, provider: ${addr}`);
}

// ---------------------------------------------------------------------------
// Rate limiter queue for 0G Compute testnet (10 req/min limit)
// Serializes all inference requests and enforces a minimum gap between calls.
// ---------------------------------------------------------------------------
const REQUEST_GAP_MS = 7_000;   // 7s between requests (~8.5 req/min max)
const MAX_RETRIES = 3;          // retry count on 429
const BASE_BACKOFF_MS = 10_000; // initial backoff for 429 retries

let inferenceQueue: Promise<void> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  // Chain onto the module-level promise so only one request runs at a time.
  // Each request waits for the previous one to finish + the inter-request gap.
  const task = inferenceQueue.then(async () => {
    const result = await fn();
    await sleep(REQUEST_GAP_MS);
    return result;
  });

  // Update the tail of the queue. Swallow rejections on the chain itself so
  // a single failure does not permanently break the queue for later callers.
  inferenceQueue = task.then(() => {}, () => {});

  return task;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries: number = MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, init);

    if (response.status === 429 && attempt < retries) {
      // Parse Retry-After header if present, otherwise use exponential backoff
      const retryAfterHeader = response.headers.get('Retry-After');
      let waitMs: number;

      if (retryAfterHeader && !Number.isNaN(Number(retryAfterHeader))) {
        waitMs = Number(retryAfterHeader) * 1000;
      } else {
        waitMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
      }

      console.warn(
        `[0G Compute] Rate limited (429). Attempt ${attempt + 1}/${retries}. ` +
        `Retrying in ${(waitMs / 1000).toFixed(1)}s...`
      );
      await sleep(waitMs);
      continue;
    }

    return response;
  }

  // Unreachable, but satisfies TypeScript
  throw new Error('[0G Compute] fetchWithRetry: exhausted retries');
}

export async function runInference(
  systemPrompt: string,
  userMessage: string,
  temperature: number = 0.7,
  maxTokens: number = 512
): Promise<InferenceResult> {
  return enqueue(async () => {
    const broker = await getBroker();
    const addr = await getProviderAddress();

    const { endpoint, model } = await broker.inference.getServiceMetadata(addr);
    const headers = await broker.inference.getRequestHeaders(addr);

    const response = await fetchWithRetry(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`0G inference failed (${response.status}): ${errText}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';

    // Extract chatID for TEE verification
    const chatId = response.headers.get('ZG-Res-Key')
      || response.headers.get('zg-res-key')
      || data.id
      || '';

    // Verify TEE response
    let teeVerified: boolean | null = null;
    if (chatId) {
      try {
        teeVerified = await broker.inference.processResponse(
          addr,
          chatId,
          data.usage ? JSON.stringify(data.usage) : undefined
        );
      } catch (err) {
        console.warn('[0G Compute] TEE verification failed:', err);
        teeVerified = null;
      }
    }

    return {
      content,
      chatId,
      teeVerified,
      model,
      usage: data.usage,
    };
  });
}

export async function fundLedger(amountOG: number = 3): Promise<void> {
  const broker = await getBroker();

  try {
    await broker.ledger.getLedger();
    console.log('[0G Compute] Ledger exists, depositing funds...');
    await broker.ledger.depositFund(amountOG);
  } catch {
    console.log('[0G Compute] Creating new ledger...');
    await broker.ledger.addLedger(amountOG);
  }
}

export async function transferToProvider(amountOG: number = 1): Promise<void> {
  const broker = await getBroker();
  const addr = await getProviderAddress();

  await broker.ledger.transferFund(
    addr,
    'inference',
    ethers.parseEther(amountOG.toString())
  );
  console.log(`[0G Compute] Transferred ${amountOG} 0G to provider ${addr}`);
}
