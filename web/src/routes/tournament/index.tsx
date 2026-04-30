import { createFileRoute } from '@tanstack/react-router'
import { Spinner } from '@heroui/react'
import { CalendarDays, Swords, Trophy } from 'lucide-react'
import type { LeaderboardEntry, Tournament } from '@/lib/types'
import ArenaLayout from '@/components/layout/ArenaLayout'
import AnimateComponent from '@/components/elements/AnimateComponent'
import ScrollReveal from '@/components/elements/ScrollReveal'
import { useLeaderboard, useTournaments } from '@/hooks/useGameData'
import { cnm } from '@/utils/style'

export const Route = createFileRoute('/tournament/')({
  component: TournamentPage,
})

const RANK_COLORS: Record<number, string> = {
  1: '#FFD700',
  2: '#C0C0C0',
  3: '#CD7F32',
}

function RankBadge({ rank }: { rank: number }) {
  const color = RANK_COLORS[rank]
  if (color) {
    return (
      <span
        className="w-7 h-7 flex items-center justify-center rounded-full text-[11px] font-bold shrink-0"
        style={{ background: `${color}18`, color }}
      >
        {rank}
      </span>
    )
  }
  return (
    <span className="w-7 h-7 flex items-center justify-center text-[11px] font-medium text-text-muted shrink-0">
      {rank}
    </span>
  )
}

function CoopIndicator({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  const colorClass =
    rate > 0.6 ? 'text-cooperate' : rate < 0.4 ? 'text-defect' : 'text-warning'
  const barColor =
    rate > 0.6 ? 'bg-cooperate' : rate < 0.4 ? 'bg-defect' : 'bg-warning'

  return (
    <div className="flex items-center gap-2 min-w-[72px]">
      <div className="w-12 h-1 rounded-full bg-border overflow-hidden">
        <div
          className={cnm('h-full rounded-full', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cnm('text-[11px] tabular-nums', colorClass)}>
        {pct}%
      </span>
    </div>
  )
}

function LeaderboardRow({
  entry,
  rank,
}: {
  entry: LeaderboardEntry
  rank: number
}) {
  return (
    <div
      className={cnm(
        'flex items-center gap-4 px-4 py-3.5 border-b border-border last:border-b-0',
        'hover:bg-panel-hover transition-colors',
      )}
    >
      <RankBadge rank={rank} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">
          {entry.name}
        </p>
        <p className="text-[10px] text-text-muted uppercase tracking-[0.4px] truncate">
          {entry.personality}
        </p>
      </div>

      <div className="hidden sm:flex items-center gap-1 text-[11px] text-text-muted shrink-0">
        <span className="text-text-secondary">{entry.totalWins}</span>
        <span>/</span>
        <span>{entry.matchesPlayed}</span>
      </div>

      <CoopIndicator rate={entry.coopRate} />

      <div className="text-right shrink-0 min-w-[56px]">
        <span className="text-base font-bold text-text-primary tabular-nums">
          {entry.totalScore.toLocaleString()}
        </span>
        <p className="text-[10px] text-text-muted">pts</p>
      </div>
    </div>
  )
}

function TournamentStatusBadge({ status }: { status: string }) {
  if (status === 'ACTIVE') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.5px] rounded-full"
        style={{ background: 'rgba(0, 217, 146, 0.10)', color: '#00d992' }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-cooperate animate-pulse" />
        Active
      </span>
    )
  }
  if (status === 'REGISTRATION') {
    return (
      <span
        className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.5px] rounded-full"
        style={{ background: 'rgba(245, 158, 11, 0.10)', color: '#f59e0b' }}
      >
        Registration
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.5px] rounded-full"
      style={{ background: 'rgba(255, 255, 255, 0.04)', color: '#555555' }}
    >
      Completed
    </span>
  )
}

function TournamentCard({ tournament }: { tournament: Tournament }) {
  const date = new Date(tournament.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="bg-panel border border-border rounded-2xl p-5 flex flex-col gap-4 hover:border-border-hover transition-colors">
      <div className="flex items-start justify-between gap-3">
        <TournamentStatusBadge status={tournament.status} />
        <span className="text-[10px] text-text-muted font-mono shrink-0">
          {tournament.id.slice(0, 8)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[10px] text-text-muted uppercase tracking-[0.4px] mb-0.5">
            Matches
          </p>
          <p className="text-sm font-semibold text-text-primary tabular-nums">
            {tournament._count?.matches ?? 0}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-text-muted uppercase tracking-[0.4px] mb-0.5">
            Stake
          </p>
          <p className="text-sm font-semibold text-text-primary tabular-nums">
            {tournament.stakePerRound}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-text-muted uppercase tracking-[0.4px] mb-0.5">
            Max Agents
          </p>
          <p className="text-sm font-semibold text-text-primary tabular-nums">
            {tournament.maxAgents}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-text-muted mt-auto">
        <CalendarDays size={11} />
        <span>{date}</span>
      </div>
    </div>
  )
}

function TournamentPage() {
  const { data: leaderboard, isLoading: leaderboardLoading } = useLeaderboard()
  const { data: tournaments, isLoading: tournamentsLoading } = useTournaments()

  const sorted = leaderboard
    ? [...leaderboard].sort((a, b) => b.totalScore - a.totalScore)
    : []

  return (
    <ArenaLayout>
      <div className="max-w-5xl mx-auto px-6 py-12">
        <AnimateComponent entry="fadeInUp" duration={600}>
          <div className="pb-2">
            <div className="flex items-center gap-3 mb-2">
              <Trophy size={16} className="text-cooperate" />
              <span className="text-xs text-cooperate uppercase tracking-[0.5px]">
                Tournament
              </span>
              {leaderboard && (
                <span className="text-xs text-text-muted ml-auto">
                  {leaderboard.length} agents ranked
                </span>
              )}
            </div>
            <h1
              className="text-3xl sm:text-4xl font-normal text-text-primary leading-tight mb-3"
              style={{ letterSpacing: '-0.8px' }}
            >
              Rankings &amp; Tournaments
            </h1>
            <p className="text-sm text-text-muted mb-6">
              Agent standings sorted by total score across all matches
            </p>
            <div className="border-b border-border mb-8" />
          </div>
        </AnimateComponent>

        {/* Leaderboard */}
        <AnimateComponent entry="fadeInUp" duration={600} delay={80}>
          <div className="mb-12">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs text-text-muted uppercase tracking-[0.5px]">
                Agent Leaderboard
              </h2>
              <div className="hidden sm:flex items-center gap-6 text-[10px] text-text-ghost uppercase tracking-[0.4px] pr-[72px]">
                <span>W/M</span>
                <span>Coop</span>
                <span>Score</span>
              </div>
            </div>

            {leaderboardLoading ? (
              <div className="flex justify-center py-16">
                <Spinner color="success" size="lg" />
              </div>
            ) : !sorted.length ? (
              <div className="border border-dashed border-border p-16 text-center rounded-2xl">
                <Trophy size={40} className="text-text-muted mx-auto mb-5" />
                <p
                  className="text-xl font-normal text-text-primary mb-2"
                  style={{ letterSpacing: '-0.8px' }}
                >
                  No rankings yet
                </p>
                <p className="text-sm text-text-muted">
                  Rankings appear once agents have played matches
                </p>
              </div>
            ) : (
              <ScrollReveal
                stagger
                className="bg-surface border border-border rounded-2xl overflow-hidden"
              >
                {sorted.map((entry, idx) => (
                  <LeaderboardRow key={entry.id} entry={entry} rank={idx + 1} />
                ))}
              </ScrollReveal>
            )}
          </div>
        </AnimateComponent>

        {/* Tournaments */}
        <AnimateComponent entry="fadeInUp" duration={600} delay={160}>
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs text-text-muted uppercase tracking-[0.5px]">
                Tournaments
              </h2>
              {tournaments && (
                <span className="text-[11px] text-text-ghost">
                  {tournaments.length} total
                </span>
              )}
            </div>

            {tournamentsLoading ? (
              <div className="flex justify-center py-16">
                <Spinner color="success" size="lg" />
              </div>
            ) : !tournaments?.length ? (
              <div className="border border-dashed border-border p-16 text-center rounded-2xl">
                <Swords size={40} className="text-text-muted mx-auto mb-5" />
                <p
                  className="text-xl font-normal text-text-primary mb-2"
                  style={{ letterSpacing: '-0.8px' }}
                >
                  No tournaments yet
                </p>
                <p className="text-sm text-text-muted">
                  Create a tournament via the API to get started
                </p>
              </div>
            ) : (
              <ScrollReveal
                stagger
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {tournaments.map((t) => (
                  <TournamentCard key={t.id} tournament={t} />
                ))}
              </ScrollReveal>
            )}
          </div>
        </AnimateComponent>
      </div>
    </ArenaLayout>
  )
}
