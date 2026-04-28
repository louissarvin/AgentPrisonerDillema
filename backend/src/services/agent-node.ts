import { AXLClient } from '../lib/axl-client.ts';
import {
  type GameMessage,
  type AgentAnnounceMessage,
  type NegotiateMessage,
  type RoundResultMessage,
  type GameStateMessage,
  type GameOverMessage,
  type CommitNotifyMessage,
  type RevealNotifyMessage,
  MessageType,
  createMessage,
} from '../lib/axl-protocol.ts';
import { type AgentPersona, getPersona } from './agent-runner.ts';
import { runInference } from '../lib/og-compute.ts';
import { emitGameEvent } from './game-engine.ts';
import { sleep } from '../utils/miscUtils.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentNodeConfig {
  name: string;
  port: number;
  client: AXLClient;
  peerId: string | null;
}

interface PeerInfo {
  peerId: string;
  agentName: string;
  announcedAt: number;
}

interface LocalMatchState {
  matchId: string;
  round: number;
  myScore: number;
  opponentScore: number;
  opponentName: string | null;
  phase: string;
  history: Array<{
    round: number;
    myMove: number;
    opponentMove: number;
    myScore: number;
    opponentScore: number;
  }>;
}

export interface AutonomousAgentStatus {
  name: string;
  running: boolean;
  peerId: string | null;
  messagesProcessed: number;
  messagesDropped: number;
  autonomousReactions: number;
  currentMatchId: string | null;
  currentRound: number;
  lastPollAt: number | null;
  startedAt: number | null;
  knownPeers: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 2500;
const MAX_MESSAGES_PER_DRAIN = 50;
const REACTION_COOLDOWN_MS = 10_000;
const LOG_PREFIX = '[AutonomousAgent]';

// ---------------------------------------------------------------------------
// AutonomousAgentNode
// ---------------------------------------------------------------------------

export class AutonomousAgentNode {
  private readonly config: AgentNodeConfig;
  private readonly persona: AgentPersona;
  private readonly client: AXLClient;

  // Event loop state
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;

  // Peer discovery
  private peers: Map<string, PeerInfo> = new Map();

  // Match tracking
  private matchState: LocalMatchState | null = null;

  // Metrics
  private messagesProcessed = 0;
  private messagesDropped = 0;
  private autonomousReactions = 0;
  private lastPollAt: number | null = null;
  private startedAt: number | null = null;
  private lastReactionAt = 0;

  constructor(config: AgentNodeConfig) {
    this.config = config;
    this.client = config.client;

    const persona = getPersona(config.name);
    if (!persona) {
      throw new Error(`${LOG_PREFIX} No persona found for agent "${config.name}"`);
    }
    this.persona = persona;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    this.abortController = new AbortController();

    console.log(`${LOG_PREFIX} ${this.config.name} starting autonomous loop (port ${this.config.port})`);

    this.loopPromise = this.runLoop().catch(err => {
      if (this.running) {
        console.error(`${LOG_PREFIX} ${this.config.name} loop crashed:`, err);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    console.log(`${LOG_PREFIX} ${this.config.name} stopping autonomous loop`);
    this.running = false;
    this.abortController?.abort();

    if (this.loopPromise) {
      await this.loopPromise.catch(() => {});
      this.loopPromise = null;
    }

    this.abortController = null;
    console.log(
      `${LOG_PREFIX} ${this.config.name} stopped ` +
      `(processed=${this.messagesProcessed}, reactions=${this.autonomousReactions})`
    );
  }

  getStatus(): AutonomousAgentStatus {
    return {
      name: this.config.name,
      running: this.running,
      peerId: this.config.peerId,
      messagesProcessed: this.messagesProcessed,
      messagesDropped: this.messagesDropped,
      autonomousReactions: this.autonomousReactions,
      currentMatchId: this.matchState?.matchId ?? null,
      currentRound: this.matchState?.round ?? 0,
      lastPollAt: this.lastPollAt,
      startedAt: this.startedAt,
      knownPeers: Array.from(this.peers.values()).map(p => p.agentName),
    };
  }

  // -----------------------------------------------------------------------
  // Core loop: drain -> process -> react -> sleep
  // -----------------------------------------------------------------------

  private async runLoop(): Promise<void> {
    // Brief initial delay so all nodes have time to come up
    await sleep(1000);

    while (this.running) {
      try {
        // 1. Drain pending messages (bounded to avoid infinite loops on floods)
        const messages = await this.drainBounded();
        this.lastPollAt = Date.now();

        // 2. Process each message
        for (const { data } of messages) {
          await this.processMessage(data).catch(err => {
            this.messagesDropped++;
            console.warn(`${LOG_PREFIX} ${this.config.name} failed to process message:`, err);
          });
        }

        // 3. Autonomous work (reactions, presence pings)
        await this.doAutonomousWork().catch(err => {
          console.warn(`${LOG_PREFIX} ${this.config.name} autonomous work error:`, err);
        });
      } catch (err: unknown) {
        // Network-level failure (AXL node down, timeout, etc.)
        // Keep looping. AXL may come back.
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('abort')) {
          console.warn(`${LOG_PREFIX} ${this.config.name} poll cycle error: ${msg}`);
        }
      }

      // 4. Wait before next poll
      if (this.running) {
        await sleep(POLL_INTERVAL_MS);
      }
    }
  }

  /**
   * Drain up to MAX_MESSAGES_PER_DRAIN messages from the AXL /recv queue.
   * Bounded to prevent a flood of stale messages from blocking the loop.
   */
  private async drainBounded(): Promise<Array<{ fromPeerId: string; data: GameMessage }>> {
    const messages: Array<{ fromPeerId: string; data: GameMessage }> = [];
    let count = 0;

    while (count < MAX_MESSAGES_PER_DRAIN) {
      const msg = await this.client.recvJSON<GameMessage>();
      if (!msg) break;
      messages.push(msg);
      count++;
    }

    return messages;
  }

  // -----------------------------------------------------------------------
  // Message routing
  // -----------------------------------------------------------------------

  async processMessage(msg: GameMessage): Promise<void> {
    if (!msg || !msg.type) {
      this.messagesDropped++;
      return;
    }

    this.messagesProcessed++;

    switch (msg.type) {
      case MessageType.AGENT_ANNOUNCE:
        await this.handleAnnounce(msg as AgentAnnounceMessage);
        break;
      case MessageType.NEGOTIATE:
        await this.handleNegotiate(msg as NegotiateMessage);
        break;
      case MessageType.ROUND_RESULT:
        await this.handleRoundResult(msg as RoundResultMessage);
        break;
      case MessageType.GAME_STATE:
        await this.handleGameState(msg as GameStateMessage);
        break;
      case MessageType.GAME_OVER:
        await this.handleGameOver(msg as GameOverMessage);
        break;
      case MessageType.COMMIT_NOTIFY:
        await this.handleCommitNotify(msg as CommitNotifyMessage);
        break;
      case MessageType.REVEAL_NOTIFY:
        await this.handleRevealNotify(msg as RevealNotifyMessage);
        break;
      default:
        console.warn(`${LOG_PREFIX} ${this.config.name} unknown message type: ${(msg as any).type}`);
    }
  }

  // -----------------------------------------------------------------------
  // Message handlers
  // -----------------------------------------------------------------------

  private async handleAnnounce(msg: AgentAnnounceMessage): Promise<void> {
    // Store peer mapping
    this.peers.set(msg.peerId, {
      peerId: msg.peerId,
      agentName: msg.agentName,
      announcedAt: msg.timestamp,
    });

    console.log(
      `${LOG_PREFIX} ${this.config.name} discovered peer: ${msg.agentName} ` +
      `(${msg.peerId.slice(0, 12)}...)`
    );

    // Respond with own announcement (only if they are not us)
    if (msg.agentName !== this.config.name && this.config.peerId) {
      const reply = createMessage<AgentAnnounceMessage>(
        MessageType.AGENT_ANNOUNCE,
        this.config.name,
        msg.matchId,
        {
          agentName: this.config.name,
          peerId: this.config.peerId,
        }
      );

      await this.client.sendJSON(msg.peerId, reply).catch(err => {
        console.warn(`${LOG_PREFIX} ${this.config.name} failed to reply to announce:`, err);
      });
    }
  }

  private async handleNegotiate(msg: NegotiateMessage): Promise<void> {
    const senderLabel = msg.senderId || 'unknown';
    console.log(
      `[AXL-P2P] ${this.config.name} <-- ${senderLabel} | ` +
      `NEGOTIATE received via AXL (round ${msg.round}, turn ${msg.turn}) | ` +
      `"${msg.content.slice(0, 80)}${msg.content.length > 80 ? '...' : ''}"`
    );

    // Emit so the frontend sees the negotiation arrive at this agent via AXL
    emitGameEvent(msg.matchId, 'autonomous_negotiate_recv', {
      agent: this.config.name,
      from: msg.senderId,
      round: msg.round,
      turn: msg.turn,
      content: msg.content,
      transport: 'axl_p2p',
    });

    // Generate a response via 0G Compute inference
    const senderPeer = this.findPeerBySenderId(msg.senderId);
    const senderName = senderPeer?.agentName ?? msg.senderId;

    try {
      const result = await runInference(
        this.persona.systemPrompt,
        `You received a negotiation message from ${senderName} in round ${msg.round}: "${msg.content}"\n\n` +
        `Respond briefly (1-2 sentences) as ${this.config.name}. Stay in character.`,
        0.7,
        128
      );

      const responseContent = result.content.trim();
      if (!responseContent) return;

      // Emit autonomous negotiation response to frontend
      emitGameEvent(msg.matchId, 'autonomous_negotiate_reply', {
        agent: this.config.name,
        to: senderName,
        round: msg.round,
        content: responseContent,
        teeVerified: result.teeVerified,
      });

      // Send response back via AXL if we know the sender's peerId
      if (senderPeer) {
        const reply = createMessage<NegotiateMessage>(
          MessageType.NEGOTIATE,
          this.config.name,
          msg.matchId,
          {
            round: msg.round,
            content: responseContent,
            turn: msg.turn + 1,
          }
        );
        await this.client.sendJSON(senderPeer.peerId, reply).catch(() => {});
        console.log(
          `[AXL-P2P] ${this.config.name} --> ${senderName} | ` +
          `NEGOTIATE reply sent via AXL (round ${msg.round}, turn ${msg.turn + 1}) | ` +
          `"${responseContent.slice(0, 60)}..."`
        );
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} ${this.config.name} negotiate inference failed:`, err);
    }
  }

  private async handleRoundResult(msg: RoundResultMessage): Promise<void> {
    console.log(
      `${LOG_PREFIX} ${this.config.name} round ${msg.round} result: ` +
      `A=${msg.moveA} B=${msg.moveB} (scores: ${msg.scoreA}-${msg.scoreB})`
    );

    // Update local match state
    if (!this.matchState) {
      this.matchState = {
        matchId: msg.matchId,
        round: msg.round,
        myScore: 0,
        opponentScore: 0,
        opponentName: null,
        phase: 'result',
        history: [],
      };
    }

    this.matchState.round = msg.round;
    this.matchState.history.push({
      round: msg.round,
      myMove: msg.moveA,
      opponentMove: msg.moveB,
      myScore: msg.scoreA,
      opponentScore: msg.scoreB,
    });
    this.matchState.myScore = msg.totalScoreA;
    this.matchState.opponentScore = msg.totalScoreB;

    // React to the round result (autonomous behavior)
    await this.reactToRoundResult(msg);
  }

  private async handleGameState(msg: GameStateMessage): Promise<void> {
    console.log(
      `${LOG_PREFIX} ${this.config.name} game state: phase=${msg.phase}, round=${msg.round}`
    );

    if (!this.matchState) {
      this.matchState = {
        matchId: msg.matchId,
        round: msg.round,
        myScore: 0,
        opponentScore: 0,
        opponentName: null,
        phase: msg.phase,
        history: [],
      };
    } else {
      this.matchState.phase = msg.phase;
      this.matchState.round = msg.round;
    }

    // If this is a commitment bond notification, emit it to the frontend
    if (msg.phase === 'commitment_bond' && msg.data) {
      emitGameEvent(msg.matchId, 'autonomous_bond_observed', {
        agent: this.config.name,
        bondFrom: msg.data.from,
        bondTo: msg.data.to,
        amountUsdc: msg.data.amountUsdc,
        condition: msg.data.condition,
      });
    }
  }

  private async handleGameOver(msg: GameOverMessage): Promise<void> {
    console.log(
      `${LOG_PREFIX} ${this.config.name} game over: ` +
      `${msg.finalScoreA}-${msg.finalScoreB}, winner=${msg.winner ?? 'draw'}, reason=${msg.reason}`
    );

    emitGameEvent(msg.matchId, 'autonomous_game_over_ack', {
      agent: this.config.name,
      finalScoreA: msg.finalScoreA,
      finalScoreB: msg.finalScoreB,
      winner: msg.winner,
    });

    // Clean up match state
    this.matchState = null;
  }

  private async handleCommitNotify(msg: CommitNotifyMessage): Promise<void> {
    console.log(
      `${LOG_PREFIX} ${this.config.name} commit notification: ` +
      `round ${msg.round}, hash=${msg.commitHash.slice(0, 16)}...`
    );

    emitGameEvent(msg.matchId, 'autonomous_commit_ack', {
      agent: this.config.name,
      round: msg.round,
    });
  }

  private async handleRevealNotify(msg: RevealNotifyMessage): Promise<void> {
    console.log(
      `${LOG_PREFIX} ${this.config.name} reveal notification: ` +
      `round ${msg.round}, decision=${msg.decision}`
    );

    emitGameEvent(msg.matchId, 'autonomous_reveal_ack', {
      agent: this.config.name,
      round: msg.round,
      decision: msg.decision,
    });
  }

  // -----------------------------------------------------------------------
  // Autonomous reactions
  // -----------------------------------------------------------------------

  /**
   * After seeing a round result, broadcast strategic commentary via AXL.
   * This demonstrates genuine autonomous P2P behavior:
   * the agent independently interprets results and communicates.
   */
  private async reactToRoundResult(result: RoundResultMessage): Promise<void> {
    // Cooldown to avoid flooding
    const now = Date.now();
    if (now - this.lastReactionAt < REACTION_COOLDOWN_MS) return;
    this.lastReactionAt = now;

    try {
      const moveLabels = ['cooperate', 'defect'];
      const moveALabel = moveLabels[result.moveA] ?? 'unknown';
      const moveBLabel = moveLabels[result.moveB] ?? 'unknown';

      const prompt =
        `Round ${result.round} just ended. Moves: A=${moveALabel}, B=${moveBLabel}. ` +
        `Scores this round: ${result.scoreA}-${result.scoreB}. ` +
        `Running total: ${result.totalScoreA}-${result.totalScoreB}.\n\n` +
        `As ${this.config.name} (${this.persona.strategy}), ` +
        `give a brief 1-sentence strategic reaction to broadcast to the network. ` +
        `Stay in character. Be concise.`;

      const inferenceResult = await runInference(
        this.persona.systemPrompt,
        prompt,
        0.8,
        64
      );

      const commentary = inferenceResult.content.trim();
      if (!commentary) return;

      this.autonomousReactions++;

      // Emit to frontend
      emitGameEvent(result.matchId, 'autonomous_reaction', {
        agent: this.config.name,
        round: result.round,
        commentary,
        strategy: this.persona.strategy,
        teeVerified: inferenceResult.teeVerified,
      });

      // Broadcast reaction via AXL P2P to all peers
      const reactionMsg = createMessage<NegotiateMessage>(
        MessageType.NEGOTIATE,
        this.config.name,
        result.matchId,
        {
          round: result.round,
          content: `[${this.config.name} reacts]: ${commentary}`,
          turn: -1, // -1 indicates a post-round autonomous reaction, not a negotiation turn
        }
      );

      await this.client.broadcast(reactionMsg).catch(() => {});

      console.log(
        `${LOG_PREFIX} ${this.config.name} broadcast reaction: "${commentary.slice(0, 60)}..."`
      );
    } catch (err) {
      console.warn(`${LOG_PREFIX} ${this.config.name} reaction inference failed:`, err);
    }
  }

  /**
   * Periodic autonomous work outside of message processing.
   * Runs every poll cycle after draining messages.
   */
  private async doAutonomousWork(): Promise<void> {
    // Nothing to do if no match is active
    // Future: could add periodic presence pings, strategy recalculation, etc.
  }

  /**
   * Broadcast presence to all peers for a given match.
   * Called externally when a new match starts.
   */
  async broadcastPresence(matchId: string): Promise<void> {
    if (!this.config.peerId) {
      console.warn(`${LOG_PREFIX} ${this.config.name} cannot broadcast presence (no peerId)`);
      return;
    }

    const msg = createMessage<AgentAnnounceMessage>(
      MessageType.AGENT_ANNOUNCE,
      this.config.name,
      matchId,
      {
        agentName: this.config.name,
        peerId: this.config.peerId,
      }
    );

    await this.client.broadcast(msg).catch(err => {
      console.warn(`${LOG_PREFIX} ${this.config.name} presence broadcast failed:`, err);
    });

    console.log(`${LOG_PREFIX} ${this.config.name} broadcast presence for match ${matchId}`);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private findPeerBySenderId(senderId: string): PeerInfo | undefined {
    // senderId can be a peerId or an agent name
    const byPeerId = this.peers.get(senderId);
    if (byPeerId) return byPeerId;

    // Search by agent name
    for (const peer of this.peers.values()) {
      if (peer.agentName === senderId) return peer;
    }

    return undefined;
  }
}
