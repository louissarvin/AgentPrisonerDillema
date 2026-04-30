import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { AnimatePresence, motion } from 'framer-motion'
import { Chip, Spinner } from '@heroui/react'
import {
  Banknote,
  Check,
  Copy,
  Network,
  Radio,
  Shield,
  Swords,
} from 'lucide-react'
import ArenaLayout from '@/components/layout/ArenaLayout'
import NegotiationFeed from '@/components/arena/NegotiationFeed'
import DecisionReveal from '@/components/arena/DecisionReveal'
import RoundTimeline from '@/components/arena/RoundTimeline'
import BettingPanel from '@/components/arena/BettingPanel'
import SpectatorSwapPanel from '@/components/arena/SpectatorSwapPanel'
import AxlStatusPanel from '@/components/arena/AxlStatusPanel'
import TreasuryFeed from '@/components/arena/TreasuryFeed'
import OnChainActivity from '@/components/arena/OnChainActivity'
import { useAxlStatus, useMatch } from '@/hooks/useGameData'
import { useMatchSSE } from '@/hooks/useMatchSSE'
import { cnm } from '@/utils/style'

export const Route = createFileRoute('/arena/$matchId')({
  component: MatchArenaPage,
})

function normalizeMove(
  move: string | number | null | undefined,
): 'COOPERATE' | 'DEFECT' | null {
  if (move === null || move === undefined) return null
  if (move === 0 || move === 'COOPERATE') return 'COOPERATE'
  if (move === 1 || move === 'DEFECT') return 'DEFECT'
  return null
}

function ScoreCounter({
  value,
  className,
}: {
  value: number
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const prevValue = useRef(value)

  useEffect(() => {
    if (!ref.current || prevValue.current === value) return
    const obj = { v: prevValue.current }
    gsap.to(obj, {
      v: value,
      duration: 0.6,
      ease: 'power2.out',
      onUpdate: () => {
        if (ref.current) ref.current.textContent = Math.round(obj.v).toString()
      },
    })
    prevValue.current = value
  }, [value])

  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-[10px] text-text-muted hover:text-cooperate transition-colors"
      title="Copy match ID"
    >
      {copied ? <Check size={9} /> : <Copy size={9} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

interface BondData {
  from: string
  to: string
  amountUsdc: string
  condition: string
  txHash: string
  round: number
}

function CommitmentBondCard({ data }: { data: BondData }) {
  const shortTx =
    data.txHash.length > 14
      ? `${data.txHash.slice(0, 8)}...${data.txHash.slice(-6)}`
      : data.txHash

  return (
    <div className="flex flex-col gap-1 self-center w-full max-w-[90%]">
      <div className="flex items-center gap-1.5 justify-center">
        <Banknote size={11} className="text-tee/70" />
        <span className="text-[9px] text-tee/60 uppercase tracking-wider">
          Commitment Bond — Round {data.round}
        </span>
      </div>
      <div className="px-3 py-2 border border-tee/25 bg-tee/5 rounded-xl text-xs text-center">
        <p className="text-tee font-medium">
          {data.from} sent {data.amountUsdc} USDC to {data.to}
        </p>
        <p className="text-text-secondary mt-0.5 italic">
          &ldquo;{data.condition}&rdquo;
        </p>
        <p className="text-[10px] text-text-muted font-mono mt-1">{shortTx}</p>
      </div>
    </div>
  )
}

function MatchArenaPage() {
  const { matchId } = Route.useParams()
  const { data: match, isLoading } = useMatch(matchId)
  const { events, connected } = useMatchSSE(matchId)
  const { data: axlStatus, isLoading: axlLoading } = useAxlStatus()

  if (isLoading) {
    return (
      <ArenaLayout>
        <div className="flex items-center justify-center min-h-[80vh]">
          <Spinner color="success" size="lg" />
        </div>
      </ArenaLayout>
    )
  }

  if (!match) {
    return (
      <ArenaLayout>
        <div className="flex items-center justify-center min-h-[80vh]">
          <p className="text-text-muted">Match not found</p>
        </div>
      </ArenaLayout>
    )
  }

  const rounds = match.rounds
  const currentRoundData = rounds.find(
    (r) => r.roundNumber === match.currentRound,
  )
  const allNegotiations = rounds.flatMap((r) => r.negotiations)
  const currentNegotiations = currentRoundData?.negotiations ?? []

  const lastRoundWithMoves = [...rounds]
    .reverse()
    .find((r) => r.moveA !== null && r.moveB !== null)

  const lastMoveA = normalizeMove(lastRoundWithMoves?.moveA ?? null)
  const lastMoveB = normalizeMove(lastRoundWithMoves?.moveB ?? null)

  const coopRateA =
    rounds.length > 0
      ? rounds.filter((r) => normalizeMove(r.moveA) === 'COOPERATE').length /
        rounds.length
      : 0

  const coopRateB =
    rounds.length > 0
      ? rounds.filter((r) => normalizeMove(r.moveB) === 'COOPERATE').length /
        rounds.length
      : 0

  const roundRevealed = currentRoundData
    ? currentRoundData.moveA !== null && currentRoundData.moveB !== null
    : false

  return (
    <ArenaLayout>
      <div className="flex flex-col h-[calc(100vh-6rem)] overflow-hidden">
        {/* Header bar */}
        <div className="bg-canvas/90 backdrop-blur-xl border-b border-border px-4 flex items-center justify-between shrink-0 h-10">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-text-muted uppercase tracking-widest">
              Match
            </span>
            <span className="text-[11px] text-text-secondary font-mono">
              {match.id.slice(0, 8)}...
            </span>
            <CopyButton value={match.id} />
          </div>
          <div className="flex items-center gap-3">
            {match.status === 'ACTIVE' && (
              <Chip
                size="sm"
                variant="dot"
                classNames={{
                  base: 'border-cooperate h-5',
                  dot: 'bg-cooperate animate-pulse',
                  content: 'text-cooperate text-[10px] px-1',
                }}
              >
                LIVE
              </Chip>
            )}
            <span className="text-[10px] text-text-muted">
              R{match.currentRound}/{match.totalRounds ?? 50}
            </span>
            <div className="flex items-center gap-1">
              <Radio
                size={9}
                className={
                  connected ? 'text-cooperate animate-pulse' : 'text-text-muted'
                }
              />
              <span
                className={cnm(
                  'text-[10px]',
                  connected ? 'text-cooperate' : 'text-text-muted',
                )}
              >
                {connected ? 'SSE' : 'POLLING'}
              </span>
            </div>
          </div>
        </div>

        {/* Scoreboard: Agent A stats | Decision Reveal | Agent B stats */}
        <div className="border-b border-border shrink-0 px-4 py-3 flex items-center gap-4">
          {/* Agent A info */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text-primary truncate">
                  {match.agentA.name}
                </span>
                <Chip
                  size="sm"
                  variant="bordered"
                  classNames={{
                    base: 'border-cooperate/30 h-4',
                    content: 'text-[9px] text-cooperate/80 px-1',
                  }}
                >
                  {match.agentA.personality}
                </Chip>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-cooperate tabular-nums leading-none">
                  <ScoreCounter
                    value={match.scoreA}
                    className="text-2xl font-bold text-cooperate tabular-nums"
                  />
                </span>
                {lastMoveA && (
                  <div
                    className={cnm(
                      'flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold',
                      lastMoveA === 'COOPERATE'
                        ? 'bg-cooperate/8 border-cooperate/40 text-cooperate'
                        : 'bg-defect/8 border-defect/40 text-defect',
                    )}
                  >
                    {lastMoveA === 'COOPERATE' ? (
                      <Shield size={8} />
                    ) : (
                      <Swords size={8} />
                    )}
                    {lastMoveA === 'COOPERATE' ? 'COOP' : 'DFCT'}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-text-muted">Coop</span>
                  <div className="w-12 h-1.5 rounded-full bg-canvas/80 border border-border overflow-hidden">
                    <div
                      className={cnm(
                        'h-full rounded-full',
                        coopRateA > 0.5 ? 'bg-cooperate' : 'bg-defect',
                      )}
                      style={{ width: `${coopRateA * 100}%` }}
                    />
                  </div>
                  <span
                    className={cnm(
                      'text-[9px] font-mono',
                      coopRateA > 0.5 ? 'text-cooperate' : 'text-defect',
                    )}
                  >
                    {(coopRateA * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Decision Reveal (center) */}
          <div className="shrink-0">
            <DecisionReveal
              moveA={normalizeMove(currentRoundData?.moveA ?? null)}
              moveB={normalizeMove(currentRoundData?.moveB ?? null)}
              payoffA={
                currentRoundData?.payoffA ?? currentRoundData?.scoreA ?? 0
              }
              payoffB={
                currentRoundData?.payoffB ?? currentRoundData?.scoreB ?? 0
              }
              revealed={roundRevealed}
            />
          </div>

          {/* Agent B info */}
          <div className="flex items-center gap-3 flex-1 min-w-0 justify-end">
            <div className="flex flex-col gap-0.5 min-w-0 items-end">
              <div className="flex items-center gap-2">
                <Chip
                  size="sm"
                  variant="bordered"
                  classNames={{
                    base: 'border-defect/30 h-4',
                    content: 'text-[9px] text-defect/80 px-1',
                  }}
                >
                  {match.agentB.personality}
                </Chip>
                <span className="text-sm font-semibold text-text-primary truncate">
                  {match.agentB.name}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cnm(
                      'text-[9px] font-mono',
                      coopRateB > 0.5 ? 'text-cooperate' : 'text-defect',
                    )}
                  >
                    {(coopRateB * 100).toFixed(0)}%
                  </span>
                  <div className="w-12 h-1.5 rounded-full bg-canvas/80 border border-border overflow-hidden">
                    <div
                      className={cnm(
                        'h-full rounded-full',
                        coopRateB > 0.5 ? 'bg-cooperate' : 'bg-defect',
                      )}
                      style={{ width: `${coopRateB * 100}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-text-muted">Coop</span>
                </div>
                {lastMoveB && (
                  <div
                    className={cnm(
                      'flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold',
                      lastMoveB === 'COOPERATE'
                        ? 'bg-cooperate/8 border-cooperate/40 text-cooperate'
                        : 'bg-defect/8 border-defect/40 text-defect',
                    )}
                  >
                    {lastMoveB === 'COOPERATE' ? (
                      <Shield size={8} />
                    ) : (
                      <Swords size={8} />
                    )}
                    {lastMoveB === 'COOPERATE' ? 'COOP' : 'DFCT'}
                  </div>
                )}
                <span className="text-2xl font-bold text-defect tabular-nums leading-none">
                  <ScoreCounter
                    value={match.scoreB}
                    className="text-2xl font-bold text-defect tabular-nums"
                  />
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Main content: Negotiation feed + Betting sidebar */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Negotiation feed (main area) */}
          <div className="flex-1 overflow-hidden flex flex-col px-4 pt-3 pb-2 gap-2 min-h-0">
            <p className="text-[10px] text-text-muted uppercase tracking-widest shrink-0">
              Negotiation — Round {match.currentRound}
              {match.status === 'ACTIVE' && !roundRevealed && (
                <span className="inline-block w-1 h-3 bg-text-primary/40 animate-pulse ml-2 align-middle" />
              )}
            </p>
            <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1 min-h-0">
              {currentNegotiations.length === 0 &&
              allNegotiations.length > 0 ? (
                <div className="opacity-50">
                  <NegotiationFeed
                    negotiations={allNegotiations.slice(-20)}
                    agentAName={match.agentA.name}
                    agentBName={match.agentB.name}
                  />
                </div>
              ) : (
                <NegotiationFeed
                  negotiations={currentNegotiations}
                  agentAName={match.agentA.name}
                  agentBName={match.agentB.name}
                />
              )}

              {/* Commitment bonds from SSE */}
              <AnimatePresence initial={false}>
                {events
                  .filter((e) => e.type === 'commitment_bond')
                  .map((e, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                      className="flex justify-center"
                    >
                      <CommitmentBondCard
                        data={e.data as unknown as BondData}
                      />
                    </motion.div>
                  ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Right sidebar: Betting + Tools */}
          <div className="w-72 xl:w-80 shrink-0 border-l border-border flex flex-col overflow-y-auto">
            {/* Betting card */}
            <div className="p-3 border-b border-border/50">
              <BettingPanel
                matchId={String(match.onChainId ?? '')}
                currentRound={match.currentRound}
              />
            </div>

            {/* Tools section */}
            <div className="p-3 flex flex-col gap-3">
              <OnChainActivity events={events} />
              <SpectatorSwapPanel />
              <TreasuryFeed />
              <AxlStatusPanel status={axlStatus} isLoading={axlLoading} />
            </div>
          </div>
        </div>

        {/* Bottom bar: just timeline */}
        <div className="border-t border-border bg-panel/80 backdrop-blur-xl shrink-0 flex items-center gap-3 px-4 py-1.5">
          <span className="text-[10px] text-text-muted uppercase tracking-widest shrink-0">
            Rounds
          </span>
          <div className="flex-1 overflow-hidden">
            <RoundTimeline
              rounds={rounds}
              currentRound={match.currentRound}
              totalRounds={match.totalRounds ?? 50}
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Network
              size={11}
              className={cnm(connected ? 'text-cooperate' : 'text-text-muted')}
            />
            <span className="text-[10px] text-text-muted font-mono">
              {axlStatus
                ? `${Object.values(axlStatus.agents as Record<string, { connected: boolean }>).filter((v) => v.connected).length}/${Object.keys(axlStatus.agents as object).length}`
                : ''}
            </span>
          </div>
        </div>
      </div>
    </ArenaLayout>
  )
}
