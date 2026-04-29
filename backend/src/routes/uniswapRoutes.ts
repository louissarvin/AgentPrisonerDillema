import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { UNISWAP_API_KEY } from '../config/main-config.ts';
import { handleError } from '../utils/errorHandler.ts';

const UNISWAP_API = 'https://trade-api.gateway.uniswap.org/v1';
const ALLOWED_ENDPOINTS = ['check_approval', 'quote', 'swap', 'order'] as const;
type AllowedEndpoint = typeof ALLOWED_ENDPOINTS[number];

export const uniswapRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  // Proxy all Uniswap Trading API endpoints
  app.post<{ Params: { endpoint: string } }>(
    '/:endpoint',
    async (request: FastifyRequest<{ Params: { endpoint: string } }>, reply: FastifyReply) => {
      const { endpoint } = request.params;

      if (!ALLOWED_ENDPOINTS.includes(endpoint as AllowedEndpoint)) {
        return handleError(reply, 400, `Invalid endpoint: ${endpoint}`, 'INVALID_ENDPOINT');
      }

      if (!UNISWAP_API_KEY) {
        return handleError(reply, 503, 'Uniswap API key not configured', 'UNISWAP_NOT_CONFIGURED');
      }

      try {
        const response = await fetch(`${UNISWAP_API}/${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': UNISWAP_API_KEY,
            'x-universal-router-version': '2.0',
          },
          body: JSON.stringify(request.body),
        });

        const data = await response.json() as any;

        if (!response.ok) {
          return reply.code(response.status).send({
            success: false,
            error: { code: 'UNISWAP_ERROR', message: data.errorCode || 'Uniswap API error', details: data },
            data: null,
          });
        }

        return reply.code(200).send({ success: true, error: null, data });
      } catch (err) {
        return handleError(reply, 502, 'Failed to reach Uniswap API', 'UNISWAP_UPSTREAM_ERROR', err as Error);
      }
    }
  );

  // Get supported tokens for swapping
  app.get('/tokens', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        chainId: 1301,
        tokens: [
          {
            symbol: 'ETH',
            name: 'Ether',
            address: '0x0000000000000000000000000000000000000000',
            decimals: 18,
          },
          {
            symbol: 'USDC',
            name: 'USD Coin',
            address: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
            decimals: 6,
          },
        ],
      },
    });
  });

  done();
};
