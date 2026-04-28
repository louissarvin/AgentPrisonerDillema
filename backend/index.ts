import './dotenv.ts';

import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import FastifyCors from '@fastify/cors';
import { APP_PORT, AXL_AGENT_PORTS } from './src/config/main-config.ts';

// Routes
import { gameRoutes } from './src/routes/gameRoutes.ts';
import { sseRoutes } from './src/routes/sseRoutes.ts';
import { uniswapRoutes } from './src/routes/uniswapRoutes.ts';
import { axlRoutes } from './src/routes/axlRoutes.ts';
import { treasuryRoutes } from './src/routes/treasuryRoutes.ts';

// Workers
import { startErrorLogCleanupWorker } from './src/workers/errorLogCleanup.ts';

// Services
import { axlManager } from './src/services/axl-manager.ts';

console.log(
  '======================\n======================\nAGENT PRISONER DILEMMA BACKEND\n======================\n======================\n'
);

const fastify = Fastify({
  logger: false,
});

fastify.register(FastifyCors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'token'],
});

// Health check endpoint
fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
  return reply.status(200).send({
    success: true,
    message: 'Agent Prisoner Dilemma Backend',
    error: null,
    data: {
      version: '1.0.0',
      services: ['game-engine', '0g-compute', '0g-storage', 'axl-mesh', 'uniswap-proxy'],
    },
  });
});

// Register routes
fastify.register(gameRoutes, { prefix: '/game' });
fastify.register(sseRoutes, { prefix: '/sse' });
fastify.register(uniswapRoutes, { prefix: '/uniswap' });
fastify.register(axlRoutes, { prefix: '/axl' });
fastify.register(treasuryRoutes, { prefix: '/treasury' });

const start = async (): Promise<void> => {
  try {
    // Start workers
    startErrorLogCleanupWorker();

    // Initialize AXL manager with agent nodes
    const agentNames = ['Mirror', 'Scorpion', 'Viper', 'Dove', 'Phoenix'];
    const agentConfigs = agentNames.map((name, i) => ({
      name,
      port: AXL_AGENT_PORTS[i] || 9012 + i * 10,
    }));

    await axlManager.initialize(agentConfigs).catch(err => {
      console.warn('[Init] AXL cluster not available (run axl-cluster.sh first):', err.message);
    });

    // Start autonomous agent loops (demonstrates AXL P2P without central broker)
    await axlManager.startAutonomousAgents().catch(err => {
      console.warn('[Init] Autonomous agents not started:', err instanceof Error ? err.message : err);
    });

    await fastify.listen({
      port: APP_PORT,
      host: '0.0.0.0',
    });

    const address = fastify.server.address();
    const port = typeof address === 'object' && address ? address.port : APP_PORT;

    console.log(`Server started on port ${port}`);
    console.log(`http://localhost:${port}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /           Health check`);
    console.log(`  GET  /game/agents         Agent personas`);
    console.log(`  POST /game/seed-agents    Seed agents to DB`);
    console.log(`  POST /game/tournaments    Create tournament`);
    console.log(`  POST /game/matches/start  Start a match`);
    console.log(`  GET  /game/matches/:id    Match details`);
    console.log(`  GET  /game/leaderboard    Leaderboard`);
    console.log(`  GET  /sse/matches/:id/live  SSE live events`);
    console.log(`  GET  /sse/live            Global SSE feed`);
    console.log(`  POST /uniswap/:endpoint   Uniswap API proxy`);
    console.log(`  GET  /axl/status          AXL cluster status`);
    console.log(`  POST /axl/autonomous/start   Start autonomous agent loops`);
    console.log(`  POST /axl/autonomous/stop    Stop autonomous agent loops`);
    console.log(`  GET  /axl/autonomous/status  Autonomous agent status`);
    console.log(`  POST /treasury/stake      Agent auto-stake (Uniswap ETH->USDC)`);
    console.log(`  POST /treasury/cashout    Agent cashout (Uniswap USDC->ETH)`);
    console.log(`  POST /treasury/balances   Agent wallet balances`);
    console.log(`  GET  /game/swaps          Swap transaction history`);
  } catch (error) {
    console.log('Error starting server: ', error);
    process.exit(1);
  }
};

start();
