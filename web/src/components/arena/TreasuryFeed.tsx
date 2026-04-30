import { ArrowLeftRight } from 'lucide-react'
import { Chip } from '@heroui/react'
import type { SwapTransaction, SwapType } from '@/lib/types'
import { useSwaps } from '@/hooks/useGameData'
import { cnm } from '@/utils/style'

const TYPE_META: Record<
  SwapType,
  { label: string; colorClass: string; borderClass: string; bgClass: string }
> = {
  STAKE: {
    label: 'STAKE',
    colorClass: 'text-cooperate',
    borderClass: 'border-cooperate/40',
    bgClass: 'bg-cooperate/8',
  },
  CASHOUT: {
    label: 'CASHOUT',
    colorClass: 'text-defect',
    borderClass: 'border-defect/40',
    bgClass: 'bg-defect/8',
  },
  COMMITMENT_BOND: {
    label: 'BOND',
    colorClass: 'text-tee',
    borderClass: 'border-tee/40',
    bgClass: 'bg-tee/8',
  },
  AGENT_BET: {
    label: 'BET',
    colorClass: 'text-purple-400',
    borderClass: 'border-purple-400/40',
    bgClass: 'bg-purple-400/8',
  },
}

const FALLBACK_META = {
  label: 'TX',
  colorClass: 'text-text-muted',
  borderClass: 'border-border/40',
  bgClass: 'bg-border/8',
}

function formatTokenAmount(raw: string, token: string): string {
  const decimals = token === 'ETH' ? 18 : 6
  const n = Number(raw) / 10 ** decimals
  if (n === 0) return '0'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(4)
  return n.toFixed(6)
}

function truncateTx(hash: string): string {
  if (hash.length <= 12) return hash
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`
}

function SwapRow({ swap }: { swap: SwapTransaction }) {
  const meta = TYPE_META[swap.type] ?? FALLBACK_META
  return (
    <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-canvas/40 hover:bg-canvas/60 transition-colors">
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-medium text-text-secondary truncate">
            {swap.agentName}
          </span>
          <Chip
            size="sm"
            classNames={{
              base: cnm(
                'border h-4 min-w-0 px-1',
                meta.borderClass,
                meta.bgClass,
              ),
              content: cnm('text-[9px] font-bold px-0', meta.colorClass),
            }}
          >
            {meta.label}
          </Chip>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-text-muted font-mono">
          <span>
            {formatTokenAmount(swap.amountIn, swap.tokenIn)} {swap.tokenIn}
          </span>
          <ArrowLeftRight size={8} className="text-text-ghost shrink-0" />
          <span>
            {formatTokenAmount(swap.amountOut, swap.tokenOut)} {swap.tokenOut}
          </span>
        </div>
      </div>
      <span className="text-[9px] text-text-ghost font-mono shrink-0">
        {truncateTx(swap.txHash)}
      </span>
    </div>
  )
}

export default function TreasuryFeed() {
  const { data: swaps, isLoading } = useSwaps()

  const recent = swaps?.slice(0, 12) ?? []

  return (
    <div className="bg-panel/60 backdrop-blur-xl border border-border/80 rounded-2xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowLeftRight size={12} className="text-cooperate shrink-0" />
          <span className="text-xs font-medium text-text-secondary uppercase tracking-widest">
            Treasury
          </span>
        </div>
        <Chip
          size="sm"
          classNames={{
            base: 'border border-tee/30 bg-tee/8 h-4 px-1.5',
            content: 'text-[9px] font-medium text-tee px-0',
          }}
        >
          via Uniswap
        </Chip>
      </div>

      {/* Feed */}
      {isLoading ? (
        <div className="flex flex-col gap-1.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton-shimmer h-10 rounded-lg" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <p className="text-[10px] text-text-muted text-center py-3">
          No swap activity yet
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {recent.map((swap) => (
            <SwapRow key={swap.id} swap={swap} />
          ))}
        </div>
      )}

      {/* Footer */}
      <p className="text-[9px] text-text-ghost text-center pt-0.5">
        Powered by Uniswap Trading API
      </p>
    </div>
  )
}
