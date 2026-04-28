import { nanoid } from 'nanoid';

export const PROTO_VERSION = 1;

export enum MessageType {
  AGENT_ANNOUNCE = 'agent_announce',
  NEGOTIATE = 'negotiate',
  COMMIT_NOTIFY = 'commit_notify',
  REVEAL_NOTIFY = 'reveal_notify',
  ROUND_RESULT = 'round_result',
  GAME_STATE = 'game_state',
  GAME_OVER = 'game_over',
}

export interface BaseMessage {
  proto: number;
  type: MessageType;
  msgId: string;
  senderId: string;
  matchId: string;
  timestamp: number;
}

export interface AgentAnnounceMessage extends BaseMessage {
  type: MessageType.AGENT_ANNOUNCE;
  agentName: string;
  peerId: string;
}

export interface NegotiateMessage extends BaseMessage {
  type: MessageType.NEGOTIATE;
  round: number;
  content: string;
  turn: number;
}

export interface CommitNotifyMessage extends BaseMessage {
  type: MessageType.COMMIT_NOTIFY;
  round: number;
  commitHash: string;
}

export interface RevealNotifyMessage extends BaseMessage {
  type: MessageType.REVEAL_NOTIFY;
  round: number;
  decision: 'cooperate' | 'defect';
  secret: string;
}

export interface RoundResultMessage extends BaseMessage {
  type: MessageType.ROUND_RESULT;
  round: number;
  moveA: number;
  moveB: number;
  scoreA: number;
  scoreB: number;
  totalScoreA: number;
  totalScoreB: number;
}

export interface GameStateMessage extends BaseMessage {
  type: MessageType.GAME_STATE;
  phase: string;
  round: number;
  data?: Record<string, unknown>;
}

export interface GameOverMessage extends BaseMessage {
  type: MessageType.GAME_OVER;
  reason: string;
  finalScoreA: number;
  finalScoreB: number;
  winner: string | null;
}

export type GameMessage =
  | AgentAnnounceMessage
  | NegotiateMessage
  | CommitNotifyMessage
  | RevealNotifyMessage
  | RoundResultMessage
  | GameStateMessage
  | GameOverMessage;

export function createMessage<T extends GameMessage>(
  type: T['type'],
  senderId: string,
  matchId: string,
  data: Omit<T, 'proto' | 'type' | 'msgId' | 'senderId' | 'matchId' | 'timestamp'>
): T {
  return {
    proto: PROTO_VERSION,
    type,
    msgId: nanoid(),
    senderId,
    matchId,
    timestamp: Date.now(),
    ...data,
  } as T;
}
