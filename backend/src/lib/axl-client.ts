export interface TopologyResponse {
  our_ipv6: string;
  our_public_key: string;
  peers: Array<{ uri: string; up: boolean; public_key: string; port: number }>;
  tree: Array<{ public_key: string; parent: string; sequence: number }>;
}

export class AXLClient {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(apiPort: number = 9002, host = '127.0.0.1', timeoutMs = 5000) {
    this.baseUrl = `http://${host}:${apiPort}`;
    this.timeout = timeoutMs;
  }

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
}
