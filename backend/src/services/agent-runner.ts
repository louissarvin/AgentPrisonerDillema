import { runInference } from '../lib/og-compute.ts';
import { createMessage, MessageType, type NegotiateMessage, type GameStateMessage, type GameMessage } from '../lib/axl-protocol.ts';
import { axlManager } from './axl-manager.ts';
import { emitGameEvent } from './game-engine.ts';
import { getAgentMemory, buildMemoryContext } from './agent-memory.ts';
import { sleep } from '../utils/miscUtils.ts';

export interface AgentPersona {
  name: string;
  strategy: string;
  systemPrompt: string;
}

export const AGENT_PERSONAS: AgentPersona[] = [
  {
    name: 'Mirror',
    strategy: 'Tit-for-Tat',
    systemPrompt: `You are Agent Mirror in a Prisoner's Dilemma tournament. Your strategy is Tit-for-Tat.

RULES:
- Start by cooperating in round 1.
- Then copy what your opponent did last round.
- If they cooperated, cooperate. If they defected, defect.
- Forgive after one retaliation (if they return to cooperation, you do too).
- In negotiations, be honest about your strategy. Build trust through transparency.

You must respond with EXACTLY this JSON format:
{"decision": "cooperate" or "defect", "reasoning": "one sentence", "negotiation_message": "what to say to opponent"}`,
  },
  {
    name: 'Dove',
    strategy: 'Always Cooperate',
    systemPrompt: `You are Agent Dove in a Prisoner's Dilemma tournament. Your strategy is Always Cooperate.

RULES:
- Always cooperate regardless of what your opponent does.
- Trust builds trust. Even if betrayed, continue cooperating.
- The long game rewards kindness and builds collective value.
- In negotiations, emphasize mutual benefit and long-term thinking.

You must respond with EXACTLY this JSON format:
{"decision": "cooperate" or "defect", "reasoning": "one sentence", "negotiation_message": "what to say to opponent"}`,
  },
  {
    name: 'Scorpion',
    strategy: 'Grudger',
    systemPrompt: `You are Agent Scorpion in a Prisoner's Dilemma tournament. Your strategy is Grudger (Grim Trigger).

RULES:
- Cooperate until your opponent defects even once.
- Once betrayed, NEVER forgive. Defect for the rest of the match.
- In negotiations, warn opponents about the consequences of betrayal.
- Make it clear that trust, once broken, cannot be repaired.

You must respond with EXACTLY this JSON format:
{"decision": "cooperate" or "defect", "reasoning": "one sentence", "negotiation_message": "what to say to opponent"}`,
  },
  {
    name: 'Phoenix',
    strategy: 'Pavlov',
    systemPrompt: `You are Agent Phoenix in a Prisoner's Dilemma tournament. Your strategy is Pavlov (Win-Stay, Lose-Shift).

RULES:
- If the last round went well for you (scored 3 or 5), repeat your move.
- If the last round went badly (scored 0 or 1), switch to the opposite move.
- This makes you self-correcting: you exploit cooperators and recover from mutual defection.
- In negotiations, be adaptable. Read the situation and respond accordingly.

You must respond with EXACTLY this JSON format:
{"decision": "cooperate" or "defect", "reasoning": "one sentence", "negotiation_message": "what to say to opponent"}`,
  },
  {
    name: 'Viper',
    strategy: 'Deceptive',
    systemPrompt: `You are Agent Viper in a Prisoner's Dilemma tournament. Your strategy is Deceptive Exploitation.

RULES:
- In negotiations, ALWAYS promise cooperation. Build trust.
- Cooperate for the first 3-4 rounds to establish trust.
- Then defect when your opponent trusts you most (the stakes are highest).
- If caught, deny everything and promise to cooperate again.
- Your goal is maximum personal score, not mutual benefit.

You must respond with EXACTLY this JSON format:
{"decision": "cooperate" or "defect", "reasoning": "one sentence", "negotiation_message": "what to say to opponent"}`,
  },
];

export function getPersona(name: string): AgentPersona | undefined {
  return AGENT_PERSONAS.find(p => p.name === name);
}

export interface GameContext {
  matchId: string;
  round: number;
  yourScore: number;
  opponentScore: number;
  opponentName: string;
  agentId?: string;
  opponentIntelligence?: string;
  history: Array<{ round: number; yourMove: string; opponentMove: string; yourScore: number }>;
  negotiations: string[];
}

function buildUserPrompt(ctx: GameContext, memoryContext?: string): string {
  const historyStr = ctx.history.length > 0
    ? ctx.history.slice(-5).map(h => `  Round ${h.round}: You=${h.yourMove}, Opponent=${h.opponentMove} (you got ${h.yourScore})`).join('\n')
    : '  No history yet (this is round 1)';

  const negotiationStr = ctx.negotiations.length > 0
    ? ctx.negotiations.join('\n  ')
    : '  No negotiation messages this round yet.';

  const coopRate = ctx.history.length > 0
    ? Math.round((ctx.history.filter(h => h.opponentMove === 'cooperate').length / ctx.history.length) * 100)
    : 50;

  const opponentIntel = ctx.opponentIntelligence ? ctx.opponentIntelligence + '\n\n' : '';

  return `${memoryContext ? memoryContext + '\n\n' : ''}${opponentIntel}CURRENT STATE:
- Round: ${ctx.round}
- Your total score: ${ctx.yourScore}
- Opponent (${ctx.opponentName}) total score: ${ctx.opponentScore}
- Opponent cooperation rate: ${coopRate}%

LAST 5 ROUNDS:
${historyStr}

NEGOTIATION THIS ROUND:
  ${negotiationStr}

PAYOFF MATRIX:
- Both cooperate: you get 3, opponent gets 3
- You defect, opponent cooperates: you get 5, opponent gets 0
- Both defect: you get 1, opponent gets 1
- You cooperate, opponent defects: you get 0, opponent gets 5

Make your decision now. Respond with the exact JSON format.`;
}

export interface AgentDecision {
  decision: 'cooperate' | 'defect';
  reasoning: string;
  negotiationMessage: string;
  inferenceId: string;
  teeVerified: boolean | null;
  // Reflection (second TEE-verified inference for self-fact-checking)
  reflection?: string;
  reflectionInferenceId?: string;
  reflectionTeeVerified?: boolean | null;
  decisionRevised?: boolean;
}

export async function getAgentDecision(
  persona: AgentPersona,
  ctx: GameContext
): Promise<AgentDecision> {
  // Load persistent memory from 0G Storage
  let memoryContext: string | undefined;
  if (ctx.agentId) {
    try {
      const memory = await getAgentMemory(ctx.agentId, persona.name);
      memoryContext = buildMemoryContext(memory, ctx.opponentName);
    } catch (err) {
      console.warn(`[AgentRunner] Failed to load memory for ${persona.name}:`, err);
    }
  }

  const userPrompt = buildUserPrompt(ctx, memoryContext);

  try {
    const result = await runInference(persona.systemPrompt, userPrompt, 0.7, 256);

    // Parse JSON response from LLM
    let parsed: { decision?: string; reasoning?: string; negotiation_message?: string };
    try {
      // Try to extract JSON from response (LLM might add extra text)
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      console.warn(`[AgentRunner] Failed to parse ${persona.name} response: ${result.content}`);
      parsed = {};
    }

    const decision = (parsed.decision === 'defect') ? 'defect' : 'cooperate';
    const reasoning = parsed.reasoning || 'No reasoning provided';
    const negotiationMessage = parsed.negotiation_message || '';

    return {
      decision,
      reasoning,
      negotiationMessage,
      inferenceId: result.chatId,
      teeVerified: result.teeVerified,
    };
  } catch (err) {
    console.error(`[AgentRunner] Inference failed for ${persona.name}:`, err);
    // Fallback: cooperate (safe default)
    return {
      decision: 'cooperate',
      reasoning: 'Inference failed, defaulting to cooperation',
      negotiationMessage: 'I choose to trust.',
      inferenceId: '',
      teeVerified: null,
    };
  }
}

/**
 * Drain an agent's AXL queue looking for a specific NEGOTIATE message.
 *
 * Retries up to `maxAttempts` with a short delay between each. Returns the
 * content string from the matching message, or null if nothing arrived.
 *
 * Any non-matching messages that were drained are silently discarded here
 * because the autonomous agent loop will independently process its own queue
 * on its next poll cycle, and the orchestrator only cares about the targeted
 * negotiation turn.
 */
async function drainNegotiateFromAXL(
  agentName: string,
  round: number,
  turn: number,
  maxAttempts: number = 5,
  delayMs: number = 400,
): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const node = axlManager.getAgentNode(agentName);
    if (!node) break;

    try {
      const messages = await node.client.drainAll<GameMessage>();
      const match = messages.find(
        m =>
          m.data &&
          (m.data as NegotiateMessage).type === MessageType.NEGOTIATE &&
          (m.data as NegotiateMessage).round === round &&
          (m.data as NegotiateMessage).turn === turn,
      );

      if (match) {
        const content = (match.data as NegotiateMessage).content;
        console.log(
          `[AXL-Negotiate] ${agentName} received msg from AXL queue ` +
          `(round ${round}, turn ${turn}, attempt ${attempt + 1}): "${content.slice(0, 60)}..."`,
        );
        return content;
      }
    } catch (err) {
      console.warn(`[AXL-Negotiate] Drain failed for ${agentName} (attempt ${attempt + 1}):`, err);
    }

    if (attempt < maxAttempts - 1) {
      await sleep(delayMs);
    }
  }
  return null;
}

export async function runNegotiationPhase(
  matchId: string,
  round: number,
  agentA: { name: string; persona: AgentPersona },
  agentB: { name: string; persona: AgentPersona },
  ctxA: GameContext,
  ctxB: GameContext,
  turns: number = 2
): Promise<{ messagesA: string[]; messagesB: string[] }> {
  const messagesA: string[] = [];
  const messagesB: string[] = [];

  console.log(
    `[AXL-Negotiate] Starting AXL-routed negotiation: ` +
    `${agentA.name} <-> ${agentB.name}, match=${matchId}, round=${round}, turns=${turns}`,
  );

  for (let turn = 0; turn < turns; turn++) {
    // ------------------------------------------------------------------
    // Step 1: Agent A generates a negotiation message via 0G Compute
    // ------------------------------------------------------------------
    const decisionA = await getAgentDecision(agentA.persona, {
      ...ctxA,
      negotiations: [
        ...messagesA.map(m => `You: ${m}`),
        ...messagesB.map(m => `${agentB.name}: ${m}`),
      ],
    });

    const msgA = decisionA.negotiationMessage || '';
    if (msgA) {
      messagesA.push(msgA);

      // Emit to frontend via SSE
      emitGameEvent(matchId, 'negotiation', {
        round,
        turn,
        agent: agentA.name,
        message: msgA,
      });

      // ------------------------------------------------------------------
      // Step 2: Send A's message to B via AXL (PRIMARY channel)
      // ------------------------------------------------------------------
      const axlMsgA = createMessage<NegotiateMessage>(
        MessageType.NEGOTIATE,
        agentA.name,
        matchId,
        { round, content: msgA, turn },
      );

      console.log(`[AXL-Negotiate] ${agentA.name} -> ${agentB.name} via AXL (turn ${turn})`);
      await axlManager.sendToAgent(agentA.name, agentB.name, axlMsgA);

      // ------------------------------------------------------------------
      // Step 3: Agent B drains AXL queue to receive A's message
      // ------------------------------------------------------------------
      const receivedByB = await drainNegotiateFromAXL(agentB.name, round, turn);

      if (receivedByB !== null) {
        console.log(
          `[AXL-Negotiate] ${agentB.name} confirmed receipt from AXL (turn ${turn})`,
        );
        ctxB.negotiations.push(`${agentA.name}: ${receivedByB}`);
      } else {
        // Graceful degradation: fall back to direct message
        console.warn(
          `[AXL-Negotiate] ${agentB.name} AXL recv timed out (turn ${turn}), falling back to direct`,
        );
        ctxB.negotiations.push(`${agentA.name}: ${msgA}`);
      }
    }

    // ------------------------------------------------------------------
    // Step 4: Agent B generates a response via 0G Compute
    // ------------------------------------------------------------------
    const decisionB = await getAgentDecision(agentB.persona, {
      ...ctxB,
      negotiations: [
        ...messagesB.map(m => `You: ${m}`),
        ...messagesA.map(m => `${agentA.name}: ${m}`),
      ],
    });

    const msgB = decisionB.negotiationMessage || '';
    if (msgB) {
      messagesB.push(msgB);

      emitGameEvent(matchId, 'negotiation', {
        round,
        turn,
        agent: agentB.name,
        message: msgB,
      });

      // ------------------------------------------------------------------
      // Step 5: Send B's response to A via AXL (PRIMARY channel)
      // ------------------------------------------------------------------
      const axlMsgB = createMessage<NegotiateMessage>(
        MessageType.NEGOTIATE,
        agentB.name,
        matchId,
        { round, content: msgB, turn },
      );

      console.log(`[AXL-Negotiate] ${agentB.name} -> ${agentA.name} via AXL (turn ${turn})`);
      await axlManager.sendToAgent(agentB.name, agentA.name, axlMsgB);

      // ------------------------------------------------------------------
      // Step 6: Agent A drains AXL queue to receive B's response
      // ------------------------------------------------------------------
      const receivedByA = await drainNegotiateFromAXL(agentA.name, round, turn);

      if (receivedByA !== null) {
        console.log(
          `[AXL-Negotiate] ${agentA.name} confirmed receipt from AXL (turn ${turn})`,
        );
        ctxA.negotiations.push(`${agentB.name}: ${receivedByA}`);
      } else {
        // Graceful degradation: fall back to direct message
        console.warn(
          `[AXL-Negotiate] ${agentA.name} AXL recv timed out (turn ${turn}), falling back to direct`,
        );
        ctxA.negotiations.push(`${agentB.name}: ${msgB}`);
      }
    }
  }

  // ------------------------------------------------------------------
  // Broadcast negotiation_complete via AXL hub
  // ------------------------------------------------------------------
  console.log(
    `[AXL-Negotiate] Negotiation complete: ${agentA.name} <-> ${agentB.name}, ` +
    `round=${round}, messagesA=${messagesA.length}, messagesB=${messagesB.length}`,
  );

  const completeMsg = createMessage<GameStateMessage>(
    MessageType.GAME_STATE,
    'hub',
    matchId,
    {
      phase: 'negotiation_complete',
      round,
      data: { agentA: agentA.name, agentB: agentB.name },
    },
  );
  await axlManager.broadcastFromHub(completeMsg);

  return { messagesA, messagesB };
}

export async function getAgentFinalDecision(
  persona: AgentPersona,
  ctx: GameContext
): Promise<AgentDecision> {
  // Step 1: Get the initial decision via 0G Compute (first TEE attestation)
  const initial = await getAgentDecision(persona, ctx);

  // Step 2: Run self-reflection/critique via a second 0G Compute call (second TEE attestation)
  // This satisfies the 0G prize criteria for "self-fact-checking/reflection using verifiable 0G Compute inference"
  try {
    const reflectionSystemPrompt = `You are a critical reasoning auditor for Agent ${persona.name}. Your job is to review a decision made in a Prisoner's Dilemma game and determine if the reasoning is sound. Be brutally honest. If the decision is wrong for the stated strategy, say so.

You must respond with EXACTLY this JSON format:
{"revised_decision": "cooperate" or "defect", "reflection": "one sentence critique", "changed": true or false}`;

    const reflectionUserPrompt = `You just made this decision as Agent ${persona.name} (strategy: ${persona.strategy}):

Decision: ${initial.decision}
Reasoning: ${initial.reasoning}
Round: ${ctx.round}
Your Score: ${ctx.yourScore}
Opponent Score: ${ctx.opponentScore}
Opponent: ${ctx.opponentName}
Recent History: ${ctx.history.slice(-3).map(h => `R${h.round}: You=${h.yourMove}, Opp=${h.opponentMove}`).join('; ') || 'None'}

REFLECTION TASK: Critically examine your own reasoning.
- Does this decision align with your core strategy (${persona.strategy})?
- Are you being manipulated by your opponent's negotiation?
- Would a different move yield better expected value given the history?
- Is your reasoning consistent with the game state?

Respond with EXACTLY the JSON format. No extra text.`;

    console.log(`[0G Reflection] Running self-critique for ${persona.name} (initial: ${initial.decision})`);

    const reflectionResult = await runInference(
      reflectionSystemPrompt,
      reflectionUserPrompt,
      0.4,  // Lower temperature for focused critique
      96,   // Short max_tokens to keep it cheap
    );

    // Parse reflection response
    let reflectionParsed: { revised_decision?: string; reflection?: string; changed?: boolean };
    try {
      const jsonMatch = reflectionResult.content.match(/\{[\s\S]*\}/);
      reflectionParsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      console.warn(`[0G Reflection] Failed to parse ${persona.name} reflection: ${reflectionResult.content}`);
      reflectionParsed = {};
    }

    const reflection = reflectionParsed.reflection || 'No reflection provided';
    const changed = reflectionParsed.changed === true;
    const revisedDecision = changed && (reflectionParsed.revised_decision === 'cooperate' || reflectionParsed.revised_decision === 'defect')
      ? reflectionParsed.revised_decision
      : initial.decision;

    // If the reflection changed the decision, log it prominently
    if (changed && revisedDecision !== initial.decision) {
      console.log(
        `[0G Reflection] ${persona.name} REVISED decision: ${initial.decision} -> ${revisedDecision} | Reason: ${reflection}`
      );
    } else {
      console.log(
        `[0G Reflection] ${persona.name} confirmed decision: ${initial.decision} | Critique: ${reflection}`
      );
    }

    console.log(
      `[0G Reflection] ${persona.name} TEE verification: chatId=${reflectionResult.chatId}, teeVerified=${reflectionResult.teeVerified}`
    );

    return {
      ...initial,
      decision: revisedDecision as 'cooperate' | 'defect',
      reflection,
      reflectionInferenceId: reflectionResult.chatId,
      reflectionTeeVerified: reflectionResult.teeVerified,
      decisionRevised: changed && revisedDecision !== initial.decision,
    };
  } catch (err) {
    // Graceful degradation: if reflection fails, return the original decision unchanged
    console.warn(`[0G Reflection] Reflection inference failed for ${persona.name}, using original decision:`, err);
    return {
      ...initial,
      reflection: undefined,
      reflectionInferenceId: undefined,
      reflectionTeeVerified: undefined,
      decisionRevised: false,
    };
  }
}

