import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { orchestrateMatch } from '../services/match-orchestrator.ts';
import { AGENT_PERSONAS } from '../services/agent-runner.ts';
import { handleError, handleNotFoundError } from '../utils/errorHandler.ts';
import { fundLedger, initializeCompute, transferToProvider } from '../lib/og-compute.ts';
import { encryptPrivateKey, decryptPrivateKey } from '../lib/crypto.ts';
import { AGENT_ENCRYPTION_KEY, UNICHAIN_FUNDER_PRIVATE_KEY, UNICHAIN_RPC_URL, UNICHAIN_OPERATOR_KEY, UNICHAIN_USDC_ADDRESS } from '../config/main-config.ts';
import { getWallet, sendManagedTx } from '../lib/unichain-wallet.ts';
import type { TransactionResponse } from 'ethers';

export const gameRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  // Initialize 0G Compute ledger (must be called once before inference works)
  // Steps: 1) create/fund ledger, 2) transfer to provider sub-account, 3) acknowledge signer
  app.post('/setup-compute', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as { skipLedger?: boolean; depositAmount?: number; transferAmount?: number };
    try {
      if (!body.skipLedger) {
        const deposit = body.depositAmount || 0.5;
        console.log(`[Setup] Step 1: Funding 0G Compute ledger (${deposit} OG)...`);
        await fundLedger(deposit);
      } else {
        console.log('[Setup] Step 1: Skipped ledger funding');
      }
      const transfer = body.transferAmount || 0.3;
      console.log(`[Setup] Step 2: Transferring ${transfer} OG to provider...`);
      await transferToProvider(transfer);
      console.log('[Setup] Step 3: Initializing provider acknowledgement...');
      await initializeCompute();
      return reply.code(200).send({ success: true, error: null, data: { message: '0G Compute ready' } });
    } catch (err) {
      return handleError(reply, 500, 'Failed to setup 0G Compute', 'COMPUTE_SETUP_ERROR', err as Error);
    }
  });

  // Get all agent personas
  app.get('/agents', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      success: true,
      error: null,
      data: AGENT_PERSONAS.map(p => ({ name: p.name, strategy: p.strategy })),
    });
  });

  // Get all tournaments
  app.get('/tournaments', async (_request: FastifyRequest, reply: FastifyReply) => {
    const tournaments = await prismaQuery.tournament.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { matches: true } } },
    });
    return reply.code(200).send({ success: true, error: null, data: tournaments });
  });

  // Get tournament by ID
  app.get<{ Params: { id: string } }>('/tournaments/:id', async (request, reply) => {
    const tournament = await prismaQuery.tournament.findUnique({
      where: { id: request.params.id },
      include: { matches: { include: { agentA: true, agentB: true } } },
    });
    if (!tournament) return handleNotFoundError(reply, 'Tournament');
    return reply.code(200).send({ success: true, error: null, data: tournament });
  });

  // Create a tournament
  app.post('/tournaments', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { maxAgents?: number; stakePerRound?: number };
    const tournament = await prismaQuery.tournament.create({
      data: {
        maxAgents: body.maxAgents || 4,
        stakePerRound: body.stakePerRound || 1,
        status: 'REGISTRATION',
      },
    });
    return reply.code(201).send({ success: true, error: null, data: tournament });
  });

  // Get all matches
  app.get('/matches', async (_request: FastifyRequest, reply: FastifyReply) => {
    const matches = await prismaQuery.match.findMany({
      orderBy: { createdAt: 'desc' },
      include: { agentA: true, agentB: true },
      take: 50,
    });
    return reply.code(200).send({ success: true, error: null, data: matches });
  });

  // Get match by ID with rounds
  app.get<{ Params: { id: string } }>('/matches/:id', async (request, reply) => {
    const match = await prismaQuery.match.findUnique({
      where: { id: request.params.id },
      include: {
        agentA: true,
        agentB: true,
        rounds: {
          orderBy: { roundNumber: 'asc' },
          include: { negotiations: { orderBy: { turn: 'asc' } } },
        },
      },
    });
    if (!match) return handleNotFoundError(reply, 'Match');
    return reply.code(200).send({ success: true, error: null, data: match });
  });

  // Start a match between two agents (triggers full orchestration)
  app.post('/matches/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      tournamentId: string;
      agentAName: string;
      agentBName: string;
    };

    if (!body.tournamentId || !body.agentAName || !body.agentBName) {
      return handleError(reply, 400, 'Missing tournamentId, agentAName, or agentBName', 'VALIDATION_ERROR');
    }

    // Find or create agents
    const agentA = await prismaQuery.agent.findFirst({ where: { name: body.agentAName } });
    const agentB = await prismaQuery.agent.findFirst({ where: { name: body.agentBName } });

    if (!agentA || !agentB) {
      return handleError(reply, 404, 'Agent not found. Seed agents first via POST /game/seed-agents', 'AGENT_NOT_FOUND');
    }

    // Decrypt agent private keys for Uniswap treasury operations
    const agentAPrivateKey = agentA.encryptedPrivateKey
      ? decryptPrivateKey(agentA.encryptedPrivateKey, AGENT_ENCRYPTION_KEY)
      : undefined;
    const agentBPrivateKey = agentB.encryptedPrivateKey
      ? decryptPrivateKey(agentB.encryptedPrivateKey, AGENT_ENCRYPTION_KEY)
      : undefined;

    // Start match in background (don't await, it takes minutes)
    orchestrateMatch({
      tournamentId: body.tournamentId,
      agentAId: agentA.id,
      agentBId: agentB.id,
      agentAName: body.agentAName,
      agentBName: body.agentBName,
      agentAAddress: agentA.walletAddress,
      agentBAddress: agentB.walletAddress,
      agentAPrivateKey,
      agentBPrivateKey,
    }).catch(err => console.error('[GameRoutes] Match orchestration failed:', err));

    return reply.code(202).send({
      success: true,
      error: null,
      data: { message: 'Match started', agentA: body.agentAName, agentB: body.agentBName },
    });
  });

  // Seed agent personas into DB
  app.post('/seed-agents', async (_request: FastifyRequest, reply: FastifyReply) => {
    const agents = [];
    for (const persona of AGENT_PERSONAS) {
      const existing = await prismaQuery.agent.findFirst({ where: { name: persona.name } });
      if (existing) {
        // If agent exists but has no encrypted key, generate one and update
        if (!existing.encryptedPrivateKey) {
          const { ethers } = await import('ethers');
          const wallet = ethers.Wallet.createRandom();
          const updated = await prismaQuery.agent.update({
            where: { id: existing.id },
            data: {
              walletAddress: wallet.address,
              encryptedPrivateKey: encryptPrivateKey(wallet.privateKey, AGENT_ENCRYPTION_KEY),
            },
          });
          agents.push(updated);
        } else {
          agents.push(existing);
        }
        continue;
      }
      // Generate a wallet for each agent and store encrypted private key
      const { ethers } = await import('ethers');
      const wallet = ethers.Wallet.createRandom();
      const agent = await prismaQuery.agent.create({
        data: {
          name: persona.name,
          personality: persona.strategy,
          systemPrompt: persona.systemPrompt,
          walletAddress: wallet.address,
          encryptedPrivateKey: encryptPrivateKey(wallet.privateKey, AGENT_ENCRYPTION_KEY),
        },
      });
      agents.push(agent);
    }
    return reply.code(200).send({ success: true, error: null, data: agents });
  });

  // Fund all agents with ETH on Unichain Sepolia from funder wallet
  app.post('/fund-agents', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!UNICHAIN_FUNDER_PRIVATE_KEY) {
      return handleError(reply, 400, 'UNICHAIN_FUNDER_PRIVATE_KEY not configured', 'FUNDER_KEY_MISSING');
    }

    try {
      const { ethers } = await import('ethers');
      const provider = new ethers.JsonRpcProvider(UNICHAIN_RPC_URL);
      const funderWallet = new ethers.Wallet(UNICHAIN_FUNDER_PRIVATE_KEY, provider);

      const agents = await prismaQuery.agent.findMany({
        select: { id: true, name: true, walletAddress: true },
      });

      if (agents.length === 0) {
        return handleError(reply, 404, 'No agents found. Seed agents first via POST /game/seed-agents', 'NO_AGENTS');
      }

      const fundAmount = ethers.parseEther('0.02');
      const results: Array<{ agentName: string; walletAddress: string; txHash: string }> = [];

      // Get the current nonce and fee data
      let nonce = await provider.getTransactionCount(funderWallet.address, 'pending');
      const feeData = await provider.getFeeData();

      for (const agent of agents) {
        const tx = await funderWallet.sendTransaction({
          to: agent.walletAddress,
          value: fundAmount,
          nonce: nonce++,
          maxFeePerGas: (feeData.maxFeePerGas ?? 2000000n) * 2n,
          maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas ?? 1000000n) * 2n,
        });
        await tx.wait();
        results.push({
          agentName: agent.name,
          walletAddress: agent.walletAddress,
          txHash: tx.hash,
        });
        console.log(`[FundAgents] Sent 0.02 ETH to ${agent.name} (${agent.walletAddress}) tx: ${tx.hash}`);
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: { funded: results.length, agents: results },
      });
    } catch (err) {
      return handleError(reply, 500, 'Failed to fund agents', 'FUND_AGENTS_ERROR', err as Error);
    }
  });

  // Fund all agents with USDC on Unichain Sepolia from operator wallet
  app.post('/fund-agents-usdc', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!UNICHAIN_OPERATOR_KEY) {
      return handleError(reply, 400, 'UNICHAIN_OPERATOR_KEY not configured', 'OPERATOR_KEY_MISSING');
    }

    try {
      const { ethers } = await import('ethers');
      const body = (request.body || {}) as { amountPerAgent?: string };
      const amountPerAgent = body.amountPerAgent || '10.00';
      const parsedAmount = ethers.parseUnits(amountPerAgent, 6);

      const operatorWallet = getWallet(UNICHAIN_OPERATOR_KEY);

      const agents = await prismaQuery.agent.findMany({
        select: { id: true, name: true, walletAddress: true },
      });

      if (agents.length === 0) {
        return handleError(reply, 404, 'No agents found. Seed agents first via POST /game/seed-agents', 'NO_AGENTS');
      }

      const usdcAbi = ['function transfer(address to, uint256 amount) returns (bool)'];
      const usdcContract = new ethers.Contract(UNICHAIN_USDC_ADDRESS, usdcAbi, operatorWallet);

      const results: Array<{ agentName: string; walletAddress: string; txHash: string }> = [];

      for (const agent of agents) {
        const tx = await sendManagedTx(
          operatorWallet,
          async (overrides) => {
            return usdcContract.transfer(agent.walletAddress, parsedAmount, {
              nonce: overrides.nonce,
              maxFeePerGas: overrides.maxFeePerGas,
              maxPriorityFeePerGas: overrides.maxPriorityFeePerGas,
            }) as Promise<TransactionResponse>;
          },
          `USDC-fund-${agent.name}`,
        );
        await tx.wait(1, 60_000);
        results.push({
          agentName: agent.name,
          walletAddress: agent.walletAddress,
          txHash: tx.hash,
        });
        console.log(`[FundAgentsUSDC] Sent ${amountPerAgent} USDC to ${agent.name} (${agent.walletAddress}) tx: ${tx.hash}`);
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: { funded: results.length, amountPerAgent, agents: results },
      });
    } catch (err) {
      return handleError(reply, 500, 'Failed to fund agents with USDC', 'FUND_AGENTS_USDC_ERROR', err as Error);
    }
  });

  // Get leaderboard
  app.get('/leaderboard', async (_request: FastifyRequest, reply: FastifyReply) => {
    const agents = await prismaQuery.agent.findMany({
      orderBy: { totalScore: 'desc' },
      select: {
        id: true,
        name: true,
        personality: true,
        totalScore: true,
        totalWins: true,
        matchesPlayed: true,
        coopRate: true,
      },
    });
    return reply.code(200).send({ success: true, error: null, data: agents });
  });

  // Get TEE verification proofs for a match (for 0G judges)
  // The GET /matches/:id endpoint already returns all Round scalar fields including
  // teeVerifiedA, teeVerifiedB, inferenceIdA, inferenceIdB by default via Prisma.
  // This dedicated endpoint provides a clean summary for TEE attestation verification.
  app.get<{ Params: { matchId: string } }>('/matches/:matchId/tee-proofs', async (request, reply) => {
    const rounds = await prismaQuery.round.findMany({
      where: { matchId: request.params.matchId },
      orderBy: { roundNumber: 'asc' },
      select: {
        roundNumber: true,
        inferenceIdA: true,
        inferenceIdB: true,
        teeVerifiedA: true,
        teeVerifiedB: true,
      },
    });

    const summary = {
      totalRounds: rounds.length,
      teeVerifiedCount: rounds.filter(r => r.teeVerifiedA && r.teeVerifiedB).length,
      rounds: rounds.map(r => ({
        round: r.roundNumber,
        agentA: { inferenceId: r.inferenceIdA, teeVerified: r.teeVerifiedA },
        agentB: { inferenceId: r.inferenceIdB, teeVerified: r.teeVerifiedB },
      })),
    };

    return reply.code(200).send({ success: true, error: null, data: summary });
  });

  // Get game events for a match
  app.get<{ Params: { matchId: string } }>('/matches/:matchId/events', async (request, reply) => {
    const events = await prismaQuery.gameEvent.findMany({
      where: { matchId: request.params.matchId },
      orderBy: { createdAt: 'asc' },
    });
    return reply.code(200).send({ success: true, error: null, data: events });
  });

  // Get swap transaction history (Uniswap staking, cashouts, commitment bonds)
  app.get('/swaps', async (_request: FastifyRequest, reply: FastifyReply) => {
    const swaps = await prismaQuery.swapTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      include: { agent: { select: { name: true } } },
      take: 50,
    });
    // Flatten agent.name to agentName for frontend consumption
    const flat = swaps.map(s => ({
      id: s.id,
      agentName: s.agent.name,
      type: s.type,
      amountIn: s.amountIn,
      amountOut: s.amountOut,
      tokenIn: s.tokenIn,
      tokenOut: s.tokenOut,
      txHash: s.txHash,
      matchId: s.matchId,
      createdAt: s.createdAt,
    }));
    return reply.code(200).send({ success: true, error: null, data: flat });
  });

  done();
};
