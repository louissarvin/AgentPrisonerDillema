import { AXLClient } from '../lib/axl-client.ts';
import { type GameMessage, MessageType } from '../lib/axl-protocol.ts';
import { AXL_HUB_PORT, AXL_AGENT_PORTS } from '../config/main-config.ts';
import { AutonomousAgentNode, type AutonomousAgentStatus } from './agent-node.ts';

export interface AgentNode {
  name: string;
  port: number;
  client: AXLClient;
  peerId: string | null;
}

class AXLManager {
  private hubClient: AXLClient;
  private agentNodes: Map<string, AgentNode> = new Map();
  private messageHandlers: Array<(msg: GameMessage, fromPeerId: string) => void> = [];
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private autonomousNodes: Map<string, AutonomousAgentNode> = new Map();

  constructor() {
    this.hubClient = new AXLClient(AXL_HUB_PORT);
  }

  async initialize(agents: Array<{ name: string; port: number }>): Promise<void> {
    for (const agent of agents) {
      const client = new AXLClient(agent.port);
      let peerId: string | null = null;

      try {
        peerId = await client.getPeerId();
        console.log(`[AXL] Agent ${agent.name} connected: peer ${peerId?.slice(0, 16)}...`);
      } catch (err) {
        console.warn(`[AXL] Agent ${agent.name} not available on port ${agent.port}`);
      }

      this.agentNodes.set(agent.name, {
        name: agent.name,
        port: agent.port,
        client,
        peerId,
      });
    }
  }

  getAgentNode(name: string): AgentNode | undefined {
    return this.agentNodes.get(name);
  }

  getAgentByPeerId(peerId: string): AgentNode | undefined {
    for (const node of this.agentNodes.values()) {
      if (node.peerId === peerId) return node;
    }
    return undefined;
  }

  async sendToAgent(fromAgentName: string, toAgentName: string, message: GameMessage): Promise<void> {
    const fromNode = this.agentNodes.get(fromAgentName);
    const toNode = this.agentNodes.get(toAgentName);

    if (!fromNode || !toNode || !toNode.peerId) {
      console.warn(`[AXL] Cannot send: ${fromAgentName} -> ${toAgentName} (node not found)`);
      return;
    }

    try {
      await fromNode.client.sendJSON(toNode.peerId, message);
    } catch (err) {
      console.warn(`[AXL] Send failed ${fromAgentName} -> ${toAgentName}:`, err);
    }
  }

  async broadcastFromHub(message: GameMessage): Promise<void> {
    try {
      await this.hubClient.broadcast(message);
    } catch (err) {
      console.warn('[AXL] Hub broadcast failed:', err);
    }
  }

  onMessage(handler: (msg: GameMessage, fromPeerId: string) => void): void {
    this.messageHandlers.push(handler);
  }

  startPolling(intervalMs: number = 200): void {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(async () => {
      // Poll hub node for any incoming messages
      try {
        const messages = await this.hubClient.drainAll<GameMessage>();
        for (const { fromPeerId, data } of messages) {
          for (const handler of this.messageHandlers) {
            handler(data, fromPeerId);
          }
        }
      } catch {
        // Ignore polling errors
      }

      // Poll each agent node
      for (const node of this.agentNodes.values()) {
        try {
          const messages = await node.client.drainAll<GameMessage>();
          for (const { fromPeerId, data } of messages) {
            for (const handler of this.messageHandlers) {
              handler(data, fromPeerId);
            }
          }
        } catch {
          // Ignore per-node polling errors
        }
      }
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  async getClusterStatus(): Promise<{
    hubHealthy: boolean;
    agents: Array<{ name: string; port: number; healthy: boolean; peerId: string | null }>;
  }> {
    const hubHealthy = await this.hubClient.isHealthy();
    const agents: Array<{ name: string; port: number; healthy: boolean; peerId: string | null }> = [];

    for (const node of this.agentNodes.values()) {
      const healthy = await node.client.isHealthy();
      agents.push({
        name: node.name,
        port: node.port,
        healthy,
        peerId: node.peerId,
      });
    }

    return { hubHealthy, agents };
  }

  // -------------------------------------------------------------------------
  // Autonomous agent loop management
  // -------------------------------------------------------------------------

  /**
   * Create and start an AutonomousAgentNode for each registered agent.
   * Each node runs its own independent drain-then-act event loop.
   */
  async startAutonomousAgents(): Promise<void> {
    if (this.autonomousNodes.size > 0) {
      console.warn('[AXL] Autonomous agents already running');
      return;
    }

    for (const agentNode of this.agentNodes.values()) {
      try {
        const autonomous = new AutonomousAgentNode({
          name: agentNode.name,
          port: agentNode.port,
          client: agentNode.client,
          peerId: agentNode.peerId,
        });

        autonomous.start();
        this.autonomousNodes.set(agentNode.name, autonomous);
      } catch (err) {
        console.warn(`[AXL] Failed to start autonomous node for ${agentNode.name}:`, err);
      }
    }

    console.log(`[AXL] Started ${this.autonomousNodes.size} autonomous agent loops`);
  }

  /**
   * Stop all autonomous agent loops gracefully.
   */
  async stopAutonomousAgents(): Promise<void> {
    if (this.autonomousNodes.size === 0) return;

    const stopPromises: Promise<void>[] = [];
    for (const node of this.autonomousNodes.values()) {
      stopPromises.push(node.stop());
    }

    await Promise.allSettled(stopPromises);
    this.autonomousNodes.clear();
    console.log('[AXL] All autonomous agent loops stopped');
  }

  /**
   * Return the status of all autonomous agent loops.
   */
  getAutonomousStatus(): AutonomousAgentStatus[] {
    const statuses: AutonomousAgentStatus[] = [];
    for (const node of this.autonomousNodes.values()) {
      statuses.push(node.getStatus());
    }
    return statuses;
  }

  /**
   * Return the AutonomousAgentNode for a given agent name, if running.
   */
  getAutonomousNode(name: string): AutonomousAgentNode | undefined {
    return this.autonomousNodes.get(name);
  }

  /**
   * Broadcast presence for all autonomous agents in a match.
   */
  async broadcastAutonomousPresence(matchId: string): Promise<void> {
    for (const node of this.autonomousNodes.values()) {
      await node.broadcastPresence(matchId).catch(() => {});
    }
  }
}

export const axlManager = new AXLManager();
