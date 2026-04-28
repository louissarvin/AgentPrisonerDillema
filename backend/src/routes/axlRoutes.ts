import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { axlManager } from '../services/axl-manager.ts';

export const axlRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  // Get AXL cluster status
  app.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const status = await axlManager.getClusterStatus();
    return reply.code(200).send({ success: true, error: null, data: status });
  });

  // Get specific agent node info
  app.get<{ Params: { name: string } }>('/agents/:name', async (request, reply) => {
    const node = axlManager.getAgentNode(request.params.name);
    if (!node) {
      return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Agent node not found' }, data: null });
    }
    return reply.code(200).send({
      success: true,
      error: null,
      data: { name: node.name, port: node.port, peerId: node.peerId, healthy: await new (await import('../lib/axl-client.ts')).AXLClient(node.port).isHealthy() },
    });
  });

  // -----------------------------------------------------------------------
  // Autonomous agent loop endpoints
  // -----------------------------------------------------------------------

  // Start all autonomous agent loops
  app.post('/autonomous/start', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      await axlManager.startAutonomousAgents();
      const statuses = axlManager.getAutonomousStatus();
      return reply.code(200).send({
        success: true,
        error: null,
        data: { message: 'Autonomous agent loops started', agents: statuses },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start autonomous agents';
      return reply.code(500).send({
        success: false,
        error: { code: 'AUTONOMOUS_START_FAILED', message },
        data: null,
      });
    }
  });

  // Stop all autonomous agent loops
  app.post('/autonomous/stop', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      await axlManager.stopAutonomousAgents();
      return reply.code(200).send({
        success: true,
        error: null,
        data: { message: 'Autonomous agent loops stopped' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop autonomous agents';
      return reply.code(500).send({
        success: false,
        error: { code: 'AUTONOMOUS_STOP_FAILED', message },
        data: null,
      });
    }
  });

  // Get status of all autonomous agent loops
  app.get('/autonomous/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const statuses = axlManager.getAutonomousStatus();
    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        totalAgents: statuses.length,
        running: statuses.filter(s => s.running).length,
        agents: statuses,
      },
    });
  });

  done();
};
