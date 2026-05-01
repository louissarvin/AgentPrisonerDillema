export interface TopologyResponse {
  our_ipv6: string;
  our_public_key: string;
  peers: Array<{ uri: string; up: boolean; public_key: string; port: number }>;
  tree: Array<{ public_key: string; parent: string; sequence: number }>;
}

export interface McpServiceInfo {
  endpoint: string;
  registered_at: string;
  healthy: boolean;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  id: number;
  params: Record<string, unknown>;
}

export class AXLClient {
  private readonly baseUrl: string;
  private readonly routerUrl: string;
  private readonly timeout: number;

  constructor(apiPort: number = 9002, host = '127.0.0.1', timeoutMs = 5000, routerPort: number = 9003) {
    this.baseUrl = `http://${host}:${apiPort}`;
    this.routerUrl = `http://${host}:${routerPort}`;
    this.timeout = timeoutMs;
  }

  // ---------------------------------------------------------------------------
  // Topology / peer discovery
  // ---------------------------------------------------------------------------

  async getTopology(): Promise<TopologyResponse> {
    const resp = await fetch(`${this.baseUrl}/topology`, {
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!resp.ok) throw new Error(`AXL topology failed: ${resp.status}`);
    return resp.json() as Promise<TopologyResponse>;
  }

  async getPeerId(): Promise<string> {
    const topo = await this.getTopology();
    return topo.our_public_key;
  }

  async getRemotePeerIds(): Promise<string[]> {
    const topo = await this.getTopology();
    return topo.tree
      .map(e => e.public_key)
      .filter(k => k !== topo.our_public_key);
  }

  // ---------------------------------------------------------------------------
  // Raw send / recv (existing functionality)
  // ---------------------------------------------------------------------------

  async send(destinationPeerId: string, data: Buffer | string): Promise<number> {
    const body = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    const resp = await fetch(`${this.baseUrl}/send`, {
      method: 'POST',
      headers: {
        'X-Destination-Peer-Id': destinationPeerId,
        'Content-Type': 'application/octet-stream',
      },
      body,
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!resp.ok) throw new Error(`AXL send failed: ${resp.status}`);
    return parseInt(resp.headers.get('X-Sent-Bytes') ?? '0', 10);
  }

  async sendJSON(peerId: string, payload: unknown): Promise<number> {
    return this.send(peerId, JSON.stringify(payload));
  }

  async recv(): Promise<{ fromPeerId: string; data: Buffer } | null> {
    const resp = await fetch(`${this.baseUrl}/recv`, {
      signal: AbortSignal.timeout(this.timeout),
    });
    if (resp.status === 204) return null;
    if (!resp.ok) throw new Error(`AXL recv failed: ${resp.status}`);
    return {
      fromPeerId: resp.headers.get('X-From-Peer-Id') ?? '',
      data: Buffer.from(await resp.arrayBuffer()),
    };
  }

  async recvJSON<T = unknown>(): Promise<{ fromPeerId: string; data: T } | null> {
    const msg = await this.recv();
    if (!msg) return null;
    return { fromPeerId: msg.fromPeerId, data: JSON.parse(msg.data.toString('utf-8')) };
  }

  async drainAll<T = unknown>(): Promise<Array<{ fromPeerId: string; data: T }>> {
    const messages: Array<{ fromPeerId: string; data: T }> = [];
    while (true) {
      const msg = await this.recvJSON<T>();
      if (!msg) break;
      messages.push(msg);
    }
    return messages;
  }

  async broadcast(payload: unknown, exclude: string[] = []): Promise<void> {
    const peers = await this.getRemotePeerIds();
    const excludeSet = new Set(exclude);
    await Promise.all(
      peers.filter(id => !excludeSet.has(id))
        .map(id => this.sendJSON(id, payload).catch(() => {}))
    );
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.getTopology();
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // MCP Router methods
  // ---------------------------------------------------------------------------

  /**
   * List all services registered on the MCP router.
   */
  async listMcpServices(): Promise<Record<string, McpServiceInfo>> {
    const resp = await fetch(`${this.routerUrl}/services`, {
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!resp.ok) throw new Error(`MCP list services failed: ${resp.status}`);
    return resp.json() as Promise<Record<string, McpServiceInfo>>;
  }

  /**
   * Register a local MCP service with the router.
   */
  async registerMcpService(serviceName: string, endpoint: string): Promise<void> {
    if (!serviceName || !endpoint) {
      throw new Error('serviceName and endpoint are required');
    }

    const resp = await fetch(`${this.routerUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: serviceName, endpoint }),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`MCP register failed (${resp.status}): ${body}`);
    }
  }

  /**
   * Deregister an MCP service from the router.
   */
  async deregisterMcpService(serviceName: string): Promise<void> {
    if (!serviceName) {
      throw new Error('serviceName is required');
    }

    const encoded = encodeURIComponent(serviceName);
    const resp = await fetch(`${this.routerUrl}/register/${encoded}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(this.timeout),
    });
    // 404 is acceptable: the service may already have been removed
    if (!resp.ok && resp.status !== 404) {
      throw new Error(`MCP deregister failed: ${resp.status}`);
    }
  }

  /**
   * Call a tool on a remote peer's MCP service through the AXL bridge.
   */
  async callMcpTool(
    peerId: string,
    serviceName: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (!peerId || !serviceName || !method) {
      throw new Error('peerId, serviceName, and method are required');
    }

    const encodedPeer = encodeURIComponent(peerId);
    const encodedService = encodeURIComponent(serviceName);
    const rpcBody: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      id: 1,
      params,
    };

    const resp = await fetch(`${this.baseUrl}/mcp/${encodedPeer}/${encodedService}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rpcBody),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`MCP tool call failed (${resp.status}): ${body}`);
    }
    return resp.json();
  }

  /**
   * List tools available on a remote peer's MCP service.
   */
  async listMcpTools(peerId: string, serviceName: string): Promise<unknown> {
    return this.callMcpTool(peerId, serviceName, 'tools/list');
  }

  // ---------------------------------------------------------------------------
  // A2A methods
  // ---------------------------------------------------------------------------

  /**
   * Get a remote peer's A2A agent card.
   */
  async getAgentCard(peerId: string): Promise<unknown> {
    if (!peerId) {
      throw new Error('peerId is required');
    }

    const encoded = encodeURIComponent(peerId);
    const resp = await fetch(`${this.baseUrl}/a2a/${encoded}`, {
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`A2A agent card fetch failed (${resp.status}): ${body}`);
    }
    return resp.json();
  }

  /**
   * Send an A2A message to a remote peer.
   * Uses JSON-RPC envelope with A2A message/send method.
   */
  async sendA2AMessage(
    peerId: string,
    serviceName: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (!peerId || !serviceName) {
      throw new Error('peerId and serviceName are required');
    }

    const encoded = encodeURIComponent(peerId);
    const rpcBody = {
      jsonrpc: '2.0' as const,
      method: 'message/send',
      id: 1,
      params: {
        message: {
          role: 'user',
          parts: [
            {
              type: 'text',
              text: JSON.stringify({
                service: serviceName,
                request: {
                  jsonrpc: '2.0',
                  method,
                  id: 1,
                  params,
                },
              }),
            },
          ],
        },
      },
    };

    const resp = await fetch(`${this.baseUrl}/a2a/${encoded}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rpcBody),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`A2A message send failed (${resp.status}): ${body}`);
    }
    return resp.json();
  }
}
