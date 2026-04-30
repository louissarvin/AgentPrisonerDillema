import React from 'react'
import { Chip, Progress, Tooltip } from '@heroui/react'
import { Ban, Bot, Eye, RefreshCw, Shuffle, Trophy } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { LeaderboardEntry } from '@/lib/types'
import { cnm } from '@/utils/style'

interface AgentCardProps {
  agent: LeaderboardEntry
  rank?: number
}

const rankColors: Record<number, string> = {
  1: 'text-yellow-400',
  2: 'text-slate-300',
  3: 'text-orange-400',
}

function getStrategyMeta(personality: string): {
  icon: React.ReactNode
  borderClass: string
} {
  if (personality.includes('Tit'))
    return {
      icon: <RefreshCw size={13} className="text-cooperate" />,
      borderClass: 'border-l-2 border-l-cooperate',
    }
  if (personality.includes('Grudge'))
    return {
      icon: <Ban size={13} className="text-defect" />,
      borderClass: 'border-l-2 border-l-defect',
    }
  if (personality.includes('Decep'))
    return {
      icon: <Eye size={13} className="text-warning" />,
      borderClass: 'border-l-2 border-l-warning',
    }
  if (personality.includes('Random'))
    return {
      icon: <Shuffle size={13} className="text-text-muted" />,
      borderClass: 'border-l-2 border-l-tee',
    }
  return {
    icon: <Bot size={13} className="text-text-muted" />,
    borderClass: 'border-l-2 border-l-tee',
  }
}

export default function AgentCard({ agent, rank }: AgentCardProps) {
  const { icon: strategyIcon, borderClass } = getStrategyMeta(agent.personality)

  return (
    <div
      className={cnm(
        'bg-panel border border-border card-interactive',
        'p-5 flex flex-col gap-4 rounded-2xl',
        borderClass,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {rank !== undefined && (
            <span
              className={cnm(
                'text-xs mr-2',
                rankColors[rank] ?? 'text-text-muted',
              )}
            >
              #{rank}
            </span>
          )}
          <span className="text-text-primary font-semibold text-base tracking-wide">
            {agent.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {strategyIcon}
          {rank === 1 && (
            <Tooltip content="Top agent">
              <Trophy size={14} className="text-yellow-400" />
            </Tooltip>
          )}
        </div>
      </div>

      <Chip
        size="sm"
        variant="bordered"
        className="border-tee text-tee text-xs self-start"
      >
        {agent.personality}
      </Chip>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-lg text-text-primary font-bold">
            {agent.matchesPlayed}
          </p>
          <p className="text-xs text-text-muted uppercase tracking-widest">
            Matches
          </p>
        </div>
        <div>
          <p className="text-lg text-cooperate font-bold">{agent.totalWins}</p>
          <p className="text-xs text-text-muted uppercase tracking-widest">
            Wins
          </p>
        </div>
        <div>
          <p className="text-lg text-text-primary font-bold">
            {agent.totalScore}
          </p>
          <p className="text-xs text-text-muted uppercase tracking-widest">
            Score
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between items-center">
          <span className="text-xs text-text-muted uppercase tracking-widest">
            Coop Rate
          </span>
          <span className="text-xs text-cooperate">
            {(agent.coopRate * 100).toFixed(0)}%
          </span>
        </div>
        <Progress
          value={agent.coopRate * 100}
          size="sm"
          classNames={{
            base: 'max-w-full',
            track: 'bg-canvas border border-border',
            indicator: cnm(
              agent.coopRate > 0.6
                ? 'bg-cooperate'
                : agent.coopRate > 0.35
                  ? 'bg-warning'
                  : 'bg-defect',
            ),
          }}
        />
      </div>
    </div>
  )
}
