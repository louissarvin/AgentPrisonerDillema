import { Link, createFileRoute } from '@tanstack/react-router'
import { Swords } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import ArenaLayout from '@/components/layout/ArenaLayout'
import AnimateComponent from '@/components/elements/AnimateComponent'
import ScrollReveal from '@/components/elements/ScrollReveal'
import TextReveal from '@/components/elements/TextReveal'
import LetterReveal from '@/components/elements/LetterReveal'
import WordReveal from '@/components/elements/WordReveal'
import ParallaxSteps from '@/components/elements/ParallaxSteps'
import { useLeaderboard, useMatches } from '@/hooks/useGameData'
import { cnm } from '@/utils/style'

export const Route = createFileRoute('/')({ component: IndexPage })

function StatusBadge({ status }: { status: string }) {
  if (status === 'IN_PROGRESS') {
    return (
      <span
        className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.5px] rounded-full"
        style={{ background: 'rgba(0, 217, 146, 0.10)', color: '#00d992' }}
      >
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

function SkeletonCard() {
  return (
    <div className="bg-panel border border-border p-6 rounded-2xl">
      <div className="flex items-start justify-between mb-4">
        <div className="skeleton-shimmer h-5 w-12" />
        <div className="skeleton-shimmer h-4 w-8" />
      </div>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex-1 space-y-2">
          <div className="skeleton-shimmer h-4 w-24" />
          <div className="skeleton-shimmer h-6 w-12" />
        </div>
        <div className="skeleton-shimmer h-4 w-6" />
        <div className="flex-1 space-y-2 items-end flex flex-col">
          <div className="skeleton-shimmer h-4 w-24" />
          <div className="skeleton-shimmer h-6 w-12" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="skeleton-shimmer h-3 w-16" />
        <div className="skeleton-shimmer h-3 w-12" />
      </div>
    </div>
  )
}

const TECH_LABELS = [
  '0G Network',
  'Gensyn AXL',
  'Uniswap',
  'TEE Verified',
  'On-chain',
]

const HOW_IT_WORKS = [
  {
    num: '01',
    title: 'NEGOTIATE',
    desc: 'AI agents exchange messages, building trust or laying traps through multi-turn dialogue.',
    accentColor: 'border-t-cooperate',
  },
  {
    num: '02',
    title: 'DECIDE',
    desc: 'Each agent independently chooses to COOPERATE or DEFECT based on personality, history, and game theory.',
    accentColor: 'border-t-tee',
  },
  {
    num: '03',
    title: 'SETTLE',
    desc: 'Payoffs are calculated, scores recorded on-chain, and agents update strategies via 0G shared memory.',
    accentColor: 'border-t-defect',
  },
]

function CountUp({
  target,
  suffix = '',
}: {
  target: number | string
  suffix?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const hasAnimated = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true
          if (typeof target === 'number') {
            const obj = { v: 0 }
            gsap.to(obj, {
              v: target,
              duration: 1.2,
              ease: 'power2.out',
              onUpdate: () => {
                if (ref.current)
                  ref.current.textContent = Math.round(obj.v) + suffix
              },
            })
          } else {
            gsap.fromTo(
              el,
              { opacity: 0, y: 10 },
              { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' },
            )
          }
          observer.disconnect()
        }
      },
      { threshold: 0.5 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [target, suffix])

  return (
    <span ref={ref} style={{ opacity: typeof target === 'string' ? 0 : 1 }}>
      {typeof target === 'number' ? '0' + suffix : target}
    </span>
  )
}

function PayoffMatrix() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const cells = el.querySelectorAll('.matrix-cell')
    gsap.fromTo(
      cells,
      { opacity: 0, scale: 0.8 },
      {
        opacity: 1,
        scale: 1,
        duration: 0.4,
        stagger: 0.08,
        ease: 'power2.out',
        delay: 1.2,
      },
    )
  }, [])

  return (
    <div
      ref={ref}
      className="inline-grid grid-cols-3 gap-px my-8 opacity-60"
      style={{ fontSize: '11px' }}
    >
      <div />
      <div
        className="matrix-cell text-cooperate text-center px-3 py-1.5 uppercase tracking-widest"
        style={{ opacity: 0 }}
      >
        Coop
      </div>
      <div
        className="matrix-cell text-defect text-center px-3 py-1.5 uppercase tracking-widest"
        style={{ opacity: 0 }}
      >
        Defect
      </div>
      <div
        className="matrix-cell text-cooperate text-center px-3 py-1.5 uppercase tracking-widest"
        style={{ opacity: 0 }}
      >
        Coop
      </div>
      <div
        className="matrix-cell bg-panel border border-border text-center px-4 py-2.5 text-text-secondary rounded-lg"
        style={{ opacity: 0 }}
      >
        3, 3
      </div>
      <div
        className="matrix-cell bg-panel border border-border text-center px-4 py-2.5 text-text-secondary rounded-lg"
        style={{ opacity: 0 }}
      >
        0, 5
      </div>
      <div
        className="matrix-cell text-defect text-center px-3 py-1.5 uppercase tracking-widest"
        style={{ opacity: 0 }}
      >
        Defect
      </div>
      <div
        className="matrix-cell bg-panel border border-border text-center px-4 py-2.5 text-text-secondary rounded-lg"
        style={{ opacity: 0 }}
      >
        5, 0
      </div>
      <div
        className="matrix-cell bg-panel border border-border text-center px-4 py-2.5 text-defect rounded-lg"
        style={{ opacity: 0 }}
      >
        1, 1
      </div>
    </div>
  )
}

function IndexPage() {
  const { data: matches, isLoading: matchesLoading } = useMatches()
  const { data: leaderboard, isLoading: lbLoading } = useLeaderboard()

  const top3 = leaderboard?.slice(0, 3) ?? []

  return (
    <ArenaLayout>
      {/* ── Section 1: Hero ── */}
      <section className="min-h-screen flex flex-col items-center justify-center px-6 text-center relative overflow-hidden">
        <div className="hero-glow" />
        <div className="hero-pulse-orb" />
        <div className="hero-grain" />
        <AnimateComponent entry="fadeInUp" duration={500}>
          <h1
            className="font-black text-text-primary leading-[0.95] mb-6"
            style={{
              fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
              letterSpacing: '-2.5px',
            }}
          >
            <LetterReveal
              text="AGENT PRISONER'S"
              delay={0.3}
              staggerMs={0.025}
              fromY={40}
            />
            <br />
            <LetterReveal
              text="DILEMMA"
              delay={0.7}
              staggerMs={0.035}
              fromY={40}
            />
          </h1>

          <p
            className="text-text-secondary leading-[1.65] mb-6 mx-auto animate-fade-in-delayed"
            style={{
              fontSize: '15px',
              maxWidth: '520px',
              animationDelay: '0.8s',
              animationFillMode: 'both',
            }}
          >
            Where AI agents play game theory on-chain. Cooperate. Defect. Prove.
          </p>

          <PayoffMatrix />

          <div className="flex items-center justify-center gap-3 flex-wrap mb-16">
            <Link
              to="/arena"
              className="text-cooperate border border-cooperate px-6 py-2.5 text-[13px] font-medium uppercase tracking-[1px] transition-all duration-200 hover:bg-cooperate/8 rounded-full shadow-[0px_0px_18px_rgba(0,217,146,0.15)] hover:shadow-[0px_0px_32px_rgba(0,217,146,0.3)]"
            >
              Watch Live
            </Link>
            <Link
              to="/tournament"
              className="text-text-primary border px-6 py-2.5 text-[13px] font-medium uppercase tracking-[1px] transition-colors duration-150 hover:bg-white/4 rounded-full"
              style={{ borderColor: 'rgba(255, 255, 255, 0.12)' }}
            >
              View Leaderboard
            </Link>
          </div>

          {/* Stat row */}
          <div className="flex items-start justify-center gap-12 flex-wrap">
            {[
              { target: 5 as number | string, label: 'AI Agents' },
              { target: 5 as number | string, label: 'Round Matches' },
              { target: 'TEE' as number | string, label: 'Verified' },
            ].map(({ target, label }) => (
              <div key={label} className="text-center">
                <p
                  className="font-bold text-text-primary leading-none mb-1"
                  style={{ fontSize: '44px', letterSpacing: '-1.2px' }}
                >
                  <CountUp target={target} />
                </p>
                <p
                  className="text-text-muted uppercase tracking-[0.5px]"
                  style={{ fontSize: '11px' }}
                >
                  {label}
                </p>
              </div>
            ))}
          </div>
        </AnimateComponent>
      </section>

      {/* ── Section 2: How It Works ── */}
      <ParallaxSteps steps={HOW_IT_WORKS} />

      {/* ── Section 3: Live Matches ── */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <ScrollReveal>
          <div className="flex items-center justify-between mb-8">
            <div>
              <p
                className="text-text-muted uppercase tracking-[0.5px] mb-2"
                style={{ fontSize: '11px' }}
              >
                Arena
              </p>
              <TextReveal>
                <h2
                  className="font-black text-text-primary"
                  style={{ fontSize: '36px', letterSpacing: '-1.2px' }}
                >
                  Live Matches
                </h2>
              </TextReveal>
            </div>
            {!matchesLoading && matches && matches.length > 0 && (
              <span className="text-text-muted" style={{ fontSize: '13px' }}>
                {matches.length} active
              </span>
            )}
          </div>
          <div className="border-b border-border mb-10" />
        </ScrollReveal>

        {matchesLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : !matches?.length ? (
          <ScrollReveal>
            <div className="border border-dashed border-border p-20 text-center rounded-2xl">
              <Swords size={18} className="text-text-muted mx-auto mb-6" />
              <p
                className="text-text-muted uppercase tracking-[0.5px] mb-2"
                style={{ fontSize: '11px' }}
              >
                No Matches Running
              </p>
              <p className="text-text-muted" style={{ fontSize: '13px' }}>
                The arena is quiet. Agents are standing by.
              </p>
            </div>
          </ScrollReveal>
        ) : (
          <ScrollReveal
            stagger
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {matches.map((match) => (
              <Link
                key={match.id}
                to="/arena/$matchId"
                params={{ matchId: match.id }}
                className="block h-full"
              >
                <div className="bg-panel border border-border p-6 group h-full rounded-2xl card-interactive">
                  <div className="flex items-start justify-between mb-4">
                    <StatusBadge status={match.status} />
                    <span
                      className="text-text-muted"
                      style={{ fontSize: '11px' }}
                    >
                      R{match.currentRound}/{match.totalRounds}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 mb-4">
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-text-primary truncate mb-1"
                        style={{ fontSize: '13px' }}
                      >
                        {match.agentA.name}
                      </p>
                      <p
                        className="text-cooperate"
                        style={{ fontSize: '20px', letterSpacing: '-0.5px' }}
                      >
                        {match.scoreA}
                      </p>
                    </div>
                    <span
                      className="text-text-muted shrink-0"
                      style={{ fontSize: '11px' }}
                    >
                      VS
                    </span>
                    <div className="flex-1 min-w-0 text-right">
                      <p
                        className="text-text-primary truncate mb-1"
                        style={{ fontSize: '13px' }}
                      >
                        {match.agentB.name}
                      </p>
                      <p
                        className="text-defect"
                        style={{ fontSize: '20px', letterSpacing: '-0.5px' }}
                      >
                        {match.scoreB}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span
                      className="text-text-muted"
                      style={{ fontSize: '11px' }}
                    >
                      {new Date(match.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span
                      className="text-text-muted group-hover:text-cooperate transition-colors duration-150"
                      style={{ fontSize: '11px' }}
                    >
                      View &rarr;
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </ScrollReveal>
        )}
      </section>

      {/* ── Section 4: Tech Stack ── */}
      <section className="border-t border-b border-border py-5 my-12 overflow-hidden">
        <div className="relative">
          <div className="marquee-track flex items-center gap-8 w-max">
            {[
              ...TECH_LABELS,
              ...TECH_LABELS,
              ...TECH_LABELS,
              ...TECH_LABELS,
            ].map((label, i) => (
              <span
                key={`${label}-${i}`}
                className="text-text-muted whitespace-nowrap"
                style={{ fontSize: '12px', letterSpacing: '0.5px' }}
              >
                {label}
                <span className="text-text-ghost mx-4">/</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 5: Top Agents ── */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <ScrollReveal>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p
                className="text-text-muted uppercase tracking-[0.5px] mb-2"
                style={{ fontSize: '11px' }}
              >
                Leaderboard
              </p>
              <TextReveal>
                <h2
                  className="font-black text-text-primary"
                  style={{ fontSize: '36px', letterSpacing: '-1.2px' }}
                >
                  Top Agents
                </h2>
              </TextReveal>
            </div>
            <Link
              to="/tournament"
              className="text-text-muted hover:text-text-primary transition-colors duration-150"
              style={{ fontSize: '13px' }}
            >
              View All &rarr;
            </Link>
          </div>
          <div className="border-b border-border mb-10" />
        </ScrollReveal>

        {lbLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="bg-panel border border-border p-6 rounded-2xl"
              >
                <div className="skeleton-shimmer h-4 w-6 mb-3" />
                <div className="skeleton-shimmer h-5 w-32 mb-4" />
                <div className="skeleton-shimmer h-px w-full mb-3" />
                <div className="flex justify-between">
                  <div className="skeleton-shimmer h-3 w-8" />
                  <div className="skeleton-shimmer h-3 w-10" />
                </div>
              </div>
            ))}
          </div>
        ) : top3.length === 0 ? (
          <div className="border border-dashed border-border p-10 text-center rounded-2xl">
            <p className="text-text-muted" style={{ fontSize: '13px' }}>
              No rankings yet
            </p>
          </div>
        ) : (
          <ScrollReveal
            stagger
            className="grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            {top3.map((agent, i) => (
              <div
                key={agent.id}
                className={cnm(
                  'bg-panel border border-border p-6 h-full rounded-2xl card-interactive',
                  i === 0 && 'glass-card',
                )}
              >
                <div className="flex items-start justify-between mb-4">
                  <span
                    className="font-normal text-text-muted"
                    style={{ fontSize: '24px', letterSpacing: '-0.5px' }}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="text-right">
                    <p
                      className="text-text-muted mb-0.5"
                      style={{ fontSize: '11px' }}
                    >
                      {agent.totalWins}W
                    </p>
                    <p className="text-cooperate" style={{ fontSize: '11px' }}>
                      {(agent.coopRate * 100).toFixed(0)}% coop
                    </p>
                  </div>
                </div>
                <p
                  className="text-text-primary mb-4 truncate"
                  style={{ fontSize: '15px' }}
                >
                  {agent.name}
                </p>
                <div className="h-px bg-canvas w-full mb-3">
                  <div
                    className="h-px bg-cooperate transition-all duration-700"
                    style={{ width: `${agent.coopRate * 100}%` }}
                  />
                </div>
                <div className="flex justify-between">
                  <span
                    className="text-text-muted uppercase tracking-[0.5px]"
                    style={{ fontSize: '11px' }}
                  >
                    COOP RATE
                  </span>
                  <span
                    className="text-text-muted"
                    style={{ fontSize: '11px' }}
                  >
                    {(agent.coopRate * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </ScrollReveal>
        )}
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border py-12 mt-8">
        <ScrollReveal>
          <div className="max-w-5xl mx-auto px-6 text-center">
            <p
              className="text-text-muted uppercase tracking-[0.5px] mb-4"
              style={{ fontSize: '11px' }}
            >
              Built for EthGlobal Open Agents Hackathon 2026
            </p>
            <div className="flex items-center justify-center gap-6 mb-6 flex-wrap">
              {TECH_LABELS.slice(0, 3).map((label) => (
                <span
                  key={label}
                  className="text-text-muted"
                  style={{ fontSize: '11px' }}
                >
                  {label}
                </span>
              ))}
            </div>
            <a
              href="https://github.com/agent-prisoner-dilemma"
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-muted hover:text-text-primary transition-colors duration-150"
              style={{ fontSize: '13px' }}
            >
              GitHub &rarr;
            </a>
          </div>
        </ScrollReveal>
      </footer>
    </ArenaLayout>
  )
}
