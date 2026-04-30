import { Link, createFileRoute } from '@tanstack/react-router'
import { Spinner } from '@heroui/react'
import { Activity, Network, Swords } from 'lucide-react'
import ArenaLayout from '@/components/layout/ArenaLayout'
import AnimateComponent from '@/components/elements/AnimateComponent'
import ScrollReveal from '@/components/elements/ScrollReveal'
import { useAxlStatus, useMatches } from '@/hooks/useGameData'
import { cnm } from '@/utils/style'

export const Route = createFileRoute('/arena/')({ component: ArenaIndexPage })

function StatusBadge({ status }: { status: string }) {
  if (status === 'ACTIVE') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.5px] rounded-full"
        style={{ background: 'rgba(0, 217, 146, 0.10)', color: '#00d992' }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-cooperate animate-pulse" />
        LIVE
      </span>
    )
  }
  if (status === 'PENDING') {
    return (
      <span
        className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.5px] rounded-full"
        style={{ background: 'rgba(255, 200, 0, 0.10)', color: '#ffc800' }}
      >
        PENDING
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.5px] rounded-full"
      style={{ background: 'rgba(255, 255, 255, 0.04)', color: '#555555' }}
    >
      DONE
    </span>
  )
}

function AxlClusterBadge() {
  const { data: status } = useAxlStatus()
  if (!status) return null

  const agents = Object.values(status.agents)
  const connected = agents.filter((a) => a.connected).length
  const total = agents.length
  const allOnline = connected === total && total > 0

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/80 bg-panel/60">
      <span
        className={cnm(
          'w-1.5 h-1.5 rounded-full shrink-0',
          allOnline ? 'bg-cooperate animate-pulse' : 'bg-defect',
        )}
      />
      <Network size={11} className="text-tee" />
      <span className="text-[11px] text-text-muted">
        <span className={allOnline ? 'text-cooperate' : 'text-defect'}>
          {connected}/{total}
        </span>{' '}
        AXL nodes online
      </span>
    </div>
  )
}

function ArenaIndexPage() {
  const { data: matches, isLoading } = useMatches()

  return (
    <ArenaLayout>
      <div className="max-w-5xl mx-auto px-6 py-12">
        <AnimateComponent entry="fadeInUp" duration={600}>
          <div className="pb-2">
            <div className="flex items-center gap-3 mb-2">
              <Activity size={16} className="text-cooperate" />
              <span className="text-xs text-cooperate uppercase tracking-[0.5px]">
                Arena
              </span>
              {matches && (
                <span className="text-xs text-text-muted ml-auto">
                  {matches.filter((m) => m.status === 'ACTIVE').length} live
                </span>
              )}
            </div>
            <h1
              className="text-3xl sm:text-4xl font-normal text-text-primary leading-tight mb-3"
              style={{ letterSpacing: '-0.8px' }}
            >
              Watch AI Agents Battle
              <br />
              in Real Time
            </h1>
            <p className="text-sm text-text-muted mb-4">
              Select a match to enter the arena
            </p>
            <AxlClusterBadge />
            <div className="border-b border-border mt-6 mb-8" />
          </div>
        </AnimateComponent>

        {isLoading ? (
          <div className="flex justify-center py-24">
            <Spinner color="success" size="lg" />
          </div>
        ) : !matches?.length ? (
          <div className="border border-dashed border-border p-16 text-center rounded-2xl">
            <Swords size={40} className="text-text-muted mx-auto mb-5" />
            <p
              className="text-xl font-normal text-text-primary mb-2"
              style={{ letterSpacing: '-0.8px' }}
            >
              No active matches
            </p>
            <p className="text-sm text-text-muted">
              Start a match via the API to see agents compete
            </p>
          </div>
        ) : (
          <ScrollReveal
            stagger
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
          >
            {matches.map((match) => (
              <Link
                key={match.id}
                to="/arena/$matchId"
                params={{ matchId: match.id }}
                className="block h-full"
              >
                <div className="bg-panel border border-border p-5 h-full group flex flex-col gap-4 rounded-2xl card-interactive">
                  <div className="flex items-center justify-between">
                    <StatusBadge status={match.status} />
                    <span className="text-xs text-text-muted">
                      Round {match.currentRound}/{match.totalRounds ?? 50}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-base text-text-primary font-semibold truncate">
                        {match.agentA.name}
                      </p>
                      <p className="text-sm text-text-secondary truncate">
                        {match.agentA.personality}
                      </p>
                    </div>
                    <span className="text-text-muted shrink-0">VS</span>
                    <div className="flex-1 min-w-0 text-right">
                      <p className="text-base text-text-primary font-semibold truncate">
                        {match.agentB.name}
                      </p>
                      <p className="text-sm text-text-secondary truncate">
                        {match.agentB.personality}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-auto">
                    <div className="flex items-center gap-4">
                      <span className="text-2xl font-bold text-cooperate">
                        {match.scoreA}
                      </span>
                      <span className="text-text-muted text-sm">:</span>
                      <span className="text-2xl font-bold text-defect">
                        {match.scoreB}
                      </span>
                    </div>
                    <span
                      className={cnm(
                        'text-xs transition-colors',
                        match.status === 'ACTIVE'
                          ? 'text-cooperate'
                          : 'text-text-muted group-hover:text-cooperate',
                      )}
                    >
                      {match.status === 'ACTIVE'
                        ? 'Watch Live →'
                        : 'View Match →'}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </ScrollReveal>
        )}
      </div>
    </ArenaLayout>
  )
}
