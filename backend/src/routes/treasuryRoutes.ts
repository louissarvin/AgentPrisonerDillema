import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { agentDecideStake, agentCashOut, getAgentTreasuryStatus } from '../services/agent-treasury.ts';
import { getAgentBalances } from '../lib/uniswap-agent.ts';
import { handleError } from '../utils/errorHandler.ts';
import { ethers } from 'ethers';

export const treasuryRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  // Get agent treasury balances (ETH + USDC on Unichain Sepolia)
  app.post('/balances', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { privateKey?: string };
    if (!body.privateKey) {
      return handleError(reply, 400, 'Missing privateKey', 'VALIDATION_ERROR');
    }

    try {
      const balances = await getAgentBalances(body.privateKey);
      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          address: new ethers.Wallet(body.privateKey).address,
          ...balances,
        },
      });
    } catch (err) {
      return handleError(reply, 500, 'Failed to fetch balances', 'BALANCE_ERROR', err as Error);
    }
  });

  // Agent autonomously decides whether to stake in a tournament (Option A)
  app.post('/stake', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      agentName: string;
      agentPrivateKey: string;
      tournamentEntryFee: string;
      opponents: string[];
      personality: string;
    };

    if (!body.agentName || !body.agentPrivateKey) {
      return handleError(reply, 400, 'Missing agentName or agentPrivateKey', 'VALIDATION_ERROR');
    }

    try {
      const action = await agentDecideStake(
        body.agentName,
        body.agentPrivateKey,
        body.tournamentEntryFee || '1000000', // 1 USDC default
        body.opponents || [],
        body.personality || 'balanced'
      );

      return reply.code(200).send({ success: true, error: null, data: action });
    } catch (err) {
      return handleError(reply, 500, 'Staking decision failed', 'STAKE_ERROR', err as Error);
    }
  });

  // Agent cashes out winnings (USDC -> ETH via Uniswap) (Option A)
  app.post('/cashout', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      agentName: string;
      agentPrivateKey: string;
      usdcAmount?: string;
    };

    if (!body.agentName || !body.agentPrivateKey) {
      return handleError(reply, 400, 'Missing agentName or agentPrivateKey', 'VALIDATION_ERROR');
    }

    try {
      const action = await agentCashOut(
        body.agentName,
        body.agentPrivateKey,
        body.usdcAmount
      );

      return reply.code(200).send({ success: true, error: null, data: action });
    } catch (err) {
      return handleError(reply, 500, 'Cashout failed', 'CASHOUT_ERROR', err as Error);
    }
  });

  // Get all agent treasury statuses
  app.post('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { agents: Array<{ name: string; privateKey: string }> };

    if (!body.agents || !Array.isArray(body.agents)) {
      return handleError(reply, 400, 'Missing agents array', 'VALIDATION_ERROR');
    }

    const keyMap = new Map<string, string>();
    for (const a of body.agents) {
      keyMap.set(a.name, a.privateKey);
    }

    try {
      const statuses = await getAgentTreasuryStatus(keyMap);
      return reply.code(200).send({ success: true, error: null, data: statuses });
    } catch (err) {
      return handleError(reply, 500, 'Status fetch failed', 'STATUS_ERROR', err as Error);
    }
  });

  done();
};
