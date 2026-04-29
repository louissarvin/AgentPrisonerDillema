import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { gameEventBus } from '../services/game-engine.ts';

export const sseRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  // SSE endpoint for live match events
  app.get<{ Params: { matchId: string } }>(
    '/matches/:matchId/live',
    async (request: FastifyRequest<{ Params: { matchId: string } }>, reply: FastifyReply) => {
      const { matchId } = request.params;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // Send initial connection event
      reply.raw.write(`event: connected\ndata: ${JSON.stringify({ matchId, connected: true })}\n\n`);

      // Listen for game events
      const handler = (event: { type: string; payload: Record<string, unknown> }) => {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
      };

      gameEventBus.on(`match:${matchId}`, handler);

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        reply.raw.write(`:heartbeat\n\n`);
      }, 30000);

      // Cleanup on disconnect
      request.raw.on('close', () => {
        gameEventBus.off(`match:${matchId}`, handler);
        clearInterval(heartbeat);
      });
    }
  );

  // SSE endpoint for all game activity (global feed)
  app.get('/live', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ global: true })}\n\n`);

    const handler = (event: { type: string; payload: Record<string, unknown> }) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    };

    gameEventBus.on('global', handler);

    const heartbeat = setInterval(() => {
      reply.raw.write(`:heartbeat\n\n`);
    }, 30000);

    request.raw.on('close', () => {
      gameEventBus.off('global', handler);
      clearInterval(heartbeat);
    });
  });

  done();
};

