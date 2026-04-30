import { Link2 } from 'lucide-react'
import { Chip } from '@heroui/react'
import { cnm } from '@/utils/style'
import type { SSEEvent } from '@/hooks/useMatchSSE'

interface OnChainTx {
  chain: '0g' | 'unichain'
  action: string
  txHash: string
  agent?: string
  round?: number
  details?: string
}

function explorerUrl(chain: '0g' | 'unichain', txHash: string): string {
  if (chain === '0g') return `https://chainscan-galileo.0g.ai/tx/${txHash}`
  return `https://sepolia.uniscan.xyz/tx/${txHash}`
}

function truncateHash(hash: string): string {
  if (hash.length <= 10) return hash
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

function normalizeToOnChainTx(event: SSEEvent): OnChainTx | null {
  if (event.type === 'onchain_tx') {
    const d = event.data as Partial<OnChainTx>
    if (!d.chain || !d.action || !d.txHash) return null
    return {
      chain: d.chain,
      action: d.action,
      txHash: d.txHash,
      agent: d.agent,
      round: d.round,
      details: d.details,
    }
  }

  if (event.type === 'agent_bet') {
    const d = event.data as {
      agent?: string
      txHash?: string
      round?: number
      outcome?: string
      amount?: string
    }
    if (!d.txHash) return null
    return {
      chain: 'unichain',
      action: 'Agent Bet',
      txHash: d.txHash,
      agent: d.agent,
      round: d.round,
    }
  }

  if (event.type === 'commitment_bond') {
    const d = event.data as {
      from?: string
      txHash?: string
      round?: number
      amountUsdc?: string
    }
    if (!d.txHash) return null
    return {
      chain: 'unichain',
      action: 'Commitment Bond',
      txHash: d.txHash,
      agent: d.from,
      round: d.round,
    }
  }

  return null
}

function TxRow({ tx }: { tx: OnChainTx }) {
  const url = explorerUrl(tx.chain, tx.txHash)

  return (
    <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-canvas/40 hover:bg-canvas/60 transition-colors">
      {/* Chain dot */}
      <div
        className={cnm(
          'size-1.5 rounded-full shrink-0',
          tx.chain === '0g' ? 'bg-emerald-400' : 'bg-purple-400',
        )}
      />

      {/* Action + agent */}
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-medium text-text-secondary truncate">
            {tx.action}
          </span>
          {tx.round !== undefined && (
            <Chip
              size="sm"
              classNames={{
                base: 'border border-border/50 bg-canvas/60 h-4 px-1',
                content: 'text-[9px] text-text-muted px-0',
              }}
            >
              R{tx.round}
            </Chip>
          )}
        </div>
        {tx.agent && (
          <span className="text-[10px] text-text-muted truncate">
            {tx.agent}
          </span>
        )}
      </div>

      {/* Tx hash link */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[9px] text-text-ghost font-mono hover:text-cooperate transition-colors shrink-0"
      >
        {truncateHash(tx.txHash)}
      </a>
    </div>
  )
}

export default function OnChainActivity({ events }: { events: SSEEvent[] }) {
  const txs: OnChainTx[] = events
    .map(normalizeToOnChainTx)
    .filter((tx): tx is OnChainTx => tx !== null)
    .slice(-20)
    .reverse()

  return (
    <div className="bg-panel/60 backdrop-blur-xl border border-border/80 rounded-2xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link2 size={12} className="text-cooperate shrink-0" />
        <span className="text-xs font-medium text-text-secondary uppercase tracking-widest">
          On-Chain
        </span>
      </div>

      {/* Feed */}
      {txs.length === 0 ? (
        <p className="text-[10px] text-text-muted text-center py-3">
          No on-chain activity yet
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {txs.map((tx, i) => (
            <TxRow key={`${tx.txHash}-${i}`} tx={tx} />
          ))}
        </div>
      )}
    </div>
  )
}
