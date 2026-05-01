/**
 * MCP Negotiate Service for AXL.
 *
 * Registers each agent's negotiation capability as an MCP tool on the AXL router.
 * This lets agents discover and invoke each other's negotiation endpoints
 * through AXL's structured MCP protocol instead of raw send/recv.
 *
 * The service runs a lightweight HTTP server that speaks JSON-RPC and handles:
 *   - tools/list: enumerates available tools (negotiate, get_strategy)
 *   - tools/call: dispatches to the named tool handler
 *
 * On startup it registers itself with the MCP router. On shutdown it deregisters.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { AXLClient } from '../lib/axl-client.ts';
import { createMessage, MessageType, type NegotiateMessage } from '../lib/axl-protocol.ts';
import { axlManager } from './axl-manager.ts';
import { getPersona, type AgentPersona } from './agent-runner.ts';
import { emitGameEvent } from './game-engine.ts';
import { AXL_ROUTER_PORT, AXL_MCP_SERVICE_PORT } from '../config/main-config.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  id: number | string | null;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: McpToolDefinition[] = [
  {
    name: 'negotiate',
    description:
      'Send a negotiation message to an agent in the Prisoner\'s Dilemma game. ' +
      'The message is queued for delivery on the agent\'s AXL P2P channel.',
    inputSchema: {
      type: 'object',
      properties: {
        agentName: { type: 'string', description: 'Target agent name (e.g. Mirror, Dove, Scorpion)' },
        message: { type: 'string', description: 'Negotiation message content' },
        matchId: { type: 'string', description: 'Active match identifier' },
        round: { type: 'number', description: 'Current round number' },
      },
      required: ['agentName', 'message', 'matchId', 'round'],
    },
  },
  {
    name: 'get_strategy',
    description:
      'Get the public personality description and strategy of an agent. ' +
      'Does not reveal private decision logic.',
    inputSchema: {
      type: 'object',
      properties: {
        agentName: { type: 'string', description: 'Agent name to query (e.g. Mirror, Dove)' },
      },
      required: ['agentName'],
    },
  },
];

// ---------------------------------------------------------------------------
// Allowed agent names (prevent arbitrary input from reaching internals)
// ---------------------------------------------------------------------------

const ALLOWED_AGENT_NAMES = new Set(['Mirror', 'Dove', 'Scorpion', 'Phoenix', 'Viper']);

function isValidAgentName(name: unknown): name is string {
  return typeof name === 'string' && ALLOWED_AGENT_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleNegotiate(params: Record<string, unknown>): Promise<unknown> {
  const { agentName, message, matchId, round } = params;

  if (!isValidAgentName(agentName)) {
    return { error: `Unknown agent: ${String(agentName)}. Valid: ${[...ALLOWED_AGENT_NAMES].join(', ')}` };
  }
  if (typeof message !== 'string' || message.length === 0 || message.length > 2000) {
    return { error: 'message must be a non-empty string (max 2000 chars)' };
  }
  if (typeof matchId !== 'string' || matchId.length === 0 || matchId.length > 128) {
    return { error: 'matchId must be a non-empty string (max 128 chars)' };
  }
  if (typeof round !== 'number' || !Number.isInteger(round) || round < 0 || round > 1000) {
    return { error: 'round must be a non-negative integer (max 1000)' };
  }

  const node = axlManager.getAgentNode(agentName);
  if (!node || !node.peerId) {
    return { error: `Agent ${agentName} is not online or has no peer ID` };
  }

  // Build the negotiation message in the same format used by the existing system
  const negotiateMsg = createMessage<NegotiateMessage>(
    MessageType.NEGOTIATE,
    'mcp-service',
    matchId,
    {
      round: round as number,
      content: message,
      turn: -2, // -2 indicates an MCP-originated negotiation, distinct from autonomous (-1)
    },
  );

  try {
    await node.client.sendJSON(node.peerId, negotiateMsg);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[MCP-Service] Failed to send negotiate to ${agentName}: ${errMsg}`);
    return { error: `Failed to deliver message: ${errMsg}` };
  }

  emitGameEvent(matchId, 'mcp_negotiate_sent', {
    agent: agentName,
    round,
    messagePreview: message.slice(0, 80),
    transport: 'mcp',
  });

  console.log(`[MCP-Service] Negotiate sent to ${agentName} (match=${matchId}, round=${round})`);

  return { status: 'delivered', agent: agentName, matchId, round };
}

function handleGetStrategy(params: Record<string, unknown>): unknown {
  const { agentName } = params;

  if (!isValidAgentName(agentName)) {
    return { error: `Unknown agent: ${String(agentName)}. Valid: ${[...ALLOWED_AGENT_NAMES].join(', ')}` };
  }

  const persona: AgentPersona | undefined = getPersona(agentName);
  if (!persona) {
    return { error: `No persona found for ${agentName}` };
  }

  // Return public information only, not the full system prompt
  return {
    name: persona.name,
    strategy: persona.strategy,
    description: `Agent ${persona.name} uses the ${persona.strategy} strategy in the Prisoner's Dilemma tournament.`,
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatcher
// ---------------------------------------------------------------------------

function makeErrorResponse(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function dispatch(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { method, id, params } = req;

  switch (method) {
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

    case 'tools/call': {
      const toolName = (params as Record<string, unknown> | undefined)?.name;
      const toolArgs = ((params as Record<string, unknown> | undefined)?.arguments ?? {}) as Record<string, unknown>;

      if (toolName === 'negotiate') {
        const result = await handleNegotiate(toolArgs);
        return { jsonrpc: '2.0', id, result: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      if (toolName === 'get_strategy') {
        const result = handleGetStrategy(toolArgs);
        return { jsonrpc: '2.0', id, result: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      return makeErrorResponse(id, -32602, `Unknown tool: ${String(toolName)}`);
    }

    default:
      return makeErrorResponse(id, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const MAX_BODY_SIZE = 64 * 1024; // 64 KB

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function createMcpServer(port: number): Server {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Only accept POST to /
    if (req.method !== 'POST' || (req.url !== '/' && req.url !== '')) {
      // Health check on GET /health
      if (req.method === 'GET' && req.url === '/health') {
        sendJson(res, 200, { status: 'ok', service: 'axl-mcp-negotiate' });
        return;
      }
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch (err) {
      sendJson(res, 413, makeErrorResponse(null, -32700, 'Request body too large'));
      return;
    }

    let rpcReq: JsonRpcRequest;
    try {
      rpcReq = JSON.parse(body) as JsonRpcRequest;
    } catch {
      sendJson(res, 400, makeErrorResponse(null, -32700, 'Parse error'));
      return;
    }

    if (rpcReq.jsonrpc !== '2.0' || typeof rpcReq.method !== 'string') {
      sendJson(res, 400, makeErrorResponse(rpcReq.id ?? null, -32600, 'Invalid JSON-RPC request'));
      return;
    }

    try {
      const rpcRes = await dispatch(rpcReq);
      sendJson(res, 200, rpcRes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      console.error('[MCP-Service] Dispatch error:', err);
      sendJson(res, 500, makeErrorResponse(rpcReq.id ?? null, -32603, msg));
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// Lifecycle: start / stop
// ---------------------------------------------------------------------------

let serverInstance: Server | null = null;
let registeredServiceName: string | null = null;
let routerClient: AXLClient | null = null;

/**
 * Start the MCP negotiate service and register it with the MCP router.
 */
export async function startMcpService(
  servicePort: number = AXL_MCP_SERVICE_PORT,
  routerPort: number = AXL_ROUTER_PORT,
): Promise<void> {
  if (serverInstance) {
    console.warn('[MCP-Service] Already running');
    return;
  }

  const server = createMcpServer(servicePort);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(servicePort, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  serverInstance = server;
  console.log(`[MCP-Service] Negotiate service listening on http://127.0.0.1:${servicePort}`);

  // Register with the MCP router
  const serviceName = 'negotiate';
  const endpoint = `http://127.0.0.1:${servicePort}/`;
  routerClient = new AXLClient(9002, '127.0.0.1', 5000, routerPort);

  try {
    await routerClient.registerMcpService(serviceName, endpoint);
    registeredServiceName = serviceName;
    console.log(`[MCP-Service] Registered '${serviceName}' with MCP router at port ${routerPort}`);
  } catch (err) {
    // Non-fatal: the router may not be running yet. The service still works
    // for direct JSON-RPC calls.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[MCP-Service] Could not register with MCP router (will retry on next restart): ${msg}`);
  }
}

/**
 * Stop the MCP negotiate service and deregister from the router.
 */
export async function stopMcpService(): Promise<void> {
  // Deregister from router first
  if (registeredServiceName && routerClient) {
    try {
      await routerClient.deregisterMcpService(registeredServiceName);
      console.log(`[MCP-Service] Deregistered '${registeredServiceName}' from MCP router`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[MCP-Service] Deregister warning: ${msg}`);
    }
    registeredServiceName = null;
    routerClient = null;
  }

  if (serverInstance) {
    await new Promise<void>((resolve) => {
      serverInstance!.close(() => resolve());
    });
    serverInstance = null;
    console.log('[MCP-Service] Negotiate service stopped');
  }
}

/**
 * Check if the MCP service is currently running.
 */
export function isMcpServiceRunning(): boolean {
  return serverInstance !== null && serverInstance.listening;
}
