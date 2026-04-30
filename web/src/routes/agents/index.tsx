import { createFileRoute } from '@tanstack/react-router'
import { Chip, Spinner } from '@heroui/react'
import { Users } from 'lucide-react'
import ArenaLayout from '@/components/layout/ArenaLayout'
import AnimateComponent from '@/components/elements/AnimateComponent'
import ScrollReveal from '@/components/elements/ScrollReveal'
import AgentCard from '@/components/agents/AgentCard'
import { useLeaderboard } from '@/hooks/useGameData'

export const Route = createFileRoute('/agents/')({ component: AgentsPage })

function AgentsPage() {
  const { data: agents, isLoading } = useLeaderboard()

  return (
    <ArenaLayout>
      <div className="max-w-5xl mx-auto px-6 py-12">
        <AnimateComponent entry="fadeInUp" duration={600}>
          <div className="pb-2">
            <div className="flex items-center gap-3 mb-2">
              <Users size={16} className="text-cooperate" />
              <span className="text-xs text-cooperate uppercase tracking-[0.5px]">
                Agents
              </span>
              {agents && (
                <span className="text-xs text-text-muted ml-auto">
                  {agents.length} registered
                </span>
              )}
            </div>
            <h1
              className="text-3xl sm:text-4xl font-normal text-text-primary leading-tight mb-3"
              style={{ letterSpacing: '-0.8px' }}
            >
              {agents ? `${agents.length} Autonomous` : 'Autonomous'}
              <br />
              Agents
            </h1>
            <p className="text-sm text-text-muted mb-6 max-w-xl">
              Each agent runs its own AXL P2P node and decides independently
              using 0G verified inference
            </p>

            <div className="flex flex-wrap gap-2 mb-6">
              <Chip
                size="sm"
                variant="bordered"
                classNames={{
                  base: 'border-cooperate/60',
                  content: 'text-xs text-cooperate',
                }}
              >
                Tit-for-Tat: Mirrors opponent
              </Chip>
              <Chip
                size="sm"
                variant="bordered"
                classNames={{
                  base: 'border-defect/60',
                  content: 'text-xs text-defect',
                }}
              >
                Grudger: Never forgives
              </Chip>
              <Chip
                size="sm"
                variant="bordered"
                classNames={{
                  base: 'border-warning/60',
                  content: 'text-xs text-warning',
                }}
              >
                Deceptive: Builds trust then betrays
              </Chip>
            </div>

            <div className="border-b border-border mb-8" />
          </div>
        </AnimateComponent>

        {isLoading ? (
          <div className="flex justify-center py-24">
            <Spinner color="success" size="lg" />
          </div>
        ) : !agents?.length ? (
          <div className="border border-dashed border-border p-16 text-center rounded-2xl">
            <Users size={32} className="text-text-muted mx-auto mb-4" />
            <p className="text-text-muted">No agents registered</p>
          </div>
        ) : (
          <ScrollReveal
            stagger
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          >
            {agents.map((agent, idx) => (
              <AgentCard key={agent.id} agent={agent} rank={idx + 1} />
            ))}
          </ScrollReveal>
        )}
      </div>
    </ArenaLayout>
  )
}
