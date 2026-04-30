import { useEffect, useRef } from 'react'
import type { Round } from '@/lib/types'
import { cnm } from '@/utils/style'

function normalizeMove(
  move: string | number | null | undefined,
): 'COOPERATE' | 'DEFECT' | null {
  if (move === null || move === undefined) return null
  if (move === 0 || move === 'COOPERATE') return 'COOPERATE'
  if (move === 1 || move === 'DEFECT') return 'DEFECT'
  return null
}

interface RoundTimelineProps {
  rounds: Array<Round>
  currentRound: number
  totalRounds: number
}

export default function RoundTimeline({
  rounds,
  currentRound,
  totalRounds,
}: RoundTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    })
  }, [currentRound])

  const placeholders = Array.from(
    { length: Math.max(0, totalRounds - rounds.length) },
    (_, i) => i,
  )

  return (
    <div
      ref={containerRef}
      className="flex items-center gap-1 overflow-x-auto px-1"
      style={{ scrollbarWidth: 'none', height: '32px' }}
    >
      {rounds.map((round) => {
        const isCurrent = round.roundNumber === currentRound
        const moveA = normalizeMove(round.moveA)
        const moveB = normalizeMove(round.moveB)
        const bothRevealed = moveA !== null && moveB !== null

        return (
          <div
            key={round.id}
            ref={isCurrent ? activeRef : undefined}
            className="flex items-center gap-0.5 shrink-0"
            title={`R${round.roundNumber}${bothRevealed ? `: A=${moveA} B=${moveB}` : ''}`}
          >
            {/* Agent A dot */}
            <span
              className={cnm(
                'w-2 h-2 rounded-full transition-all duration-200',
                isCurrent
                  ? 'w-2.5 h-2.5 bg-cooperate shadow-[0_0_6px_rgba(0,217,146,0.8)] animate-pulse'
                  : moveA === 'COOPERATE'
                    ? 'bg-cooperate'
                    : moveA === 'DEFECT'
                      ? 'bg-defect'
                      : 'bg-text-muted/20',
              )}
            />
            {/* Agent B dot */}
            <span
              className={cnm(
                'w-2 h-2 rounded-full transition-all duration-200',
                isCurrent
                  ? 'w-2.5 h-2.5 bg-cooperate shadow-[0_0_6px_rgba(0,217,146,0.8)] animate-pulse'
                  : moveB === 'COOPERATE'
                    ? 'bg-cooperate'
                    : moveB === 'DEFECT'
                      ? 'bg-defect'
                      : 'bg-text-muted/20',
              )}
            />
          </div>
        )
      })}

      {/* Separator between past and future */}
      {placeholders.length > 0 && rounds.length > 0 && (
        <span className="w-px h-3 bg-border/60 shrink-0 mx-0.5" />
      )}

      {placeholders.map((i) => (
        <div key={`ph-${i}`} className="flex items-center gap-0.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-text-muted/10 border border-dashed border-text-muted/20" />
          <span className="w-2 h-2 rounded-full bg-text-muted/10 border border-dashed border-text-muted/20" />
        </div>
      ))}
    </div>
  )
}
