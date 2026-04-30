import { Network } from 'lucide-react'
import type { AxlStatus } from '@/lib/types'
import { cnm } from '@/utils/style'

interface AxlStatusPanelProps {
  status: AxlStatus | undefined
  isLoading?: boolean
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={cnm(
        'inline-block w-1.5 h-1.5 rounded-full shrink-0',
        connected ? 'bg-cooperate' : 'bg-defect',
        connected && 'animate-pulse',
      )}
    />
  )
}

export default function AxlStatusPanel({
  status,
  isLoading,
}: AxlStatusPanelProps) {
  const agentEntries = status ? Object.entries(status.agents) : []
  const connectedCount = agentEntries.filter(([, v]) => v.connected).length
  const totalCount = agentEntries.length

  return (
    <div className="bg-panel/60 backdrop-blur-xl border border-border/80 rounded-2xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network size={12} className="text-tee" />
          <span className="text-xs font-medium text-text-secondary uppercase tracking-widest">
            P2P Mesh
          </span>
        </div>
        {!isLoading && status && (
          <span className="text-[10px] text-text-muted font-mono">
            <span
              className={
                connectedCount === totalCount && totalCount > 0
                  ? 'text-cooperate'
                  : 'text-defect'
              }
            >
              {connectedCount}
            </span>
            <span className="text-text-ghost">/{totalCount}</span>
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton-shimmer h-8 rounded-lg" />
          ))}
        </div>
      ) : !status ? (
        <p className="text-[10px] text-text-muted text-center py-2">
          AXL offline
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {/* Hub row */}
          <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-canvas/60">
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot connected={status.hub.connected} />
              <span className="text-[11px] text-text-secondary font-medium truncate">
                Hub
              </span>
            </div>
            {status.hub.peerId && (
              <span className="text-[10px] text-tee/60 font-mono shrink-0">
                {status.hub.peerId.slice(0, 8)}
              </span>
            )}
          </div>

          {/* Agent rows */}
          {agentEntries.map(([name, info]) => (
            <div
              key={name}
              className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-canvas/40"
            >
              <div className="flex items-center gap-2 min-w-0">
                <StatusDot connected={info.connected} />
                <span className="text-[11px] text-text-secondary truncate max-w-[80px]">
                  {name}
                </span>
              </div>
              {info.peerId && (
                <span className="text-[10px] text-tee/50 font-mono shrink-0">
                  {info.peerId.slice(0, 8)}
                </span>
              )}
            </div>
          ))}

          {agentEntries.length === 0 && (
            <p className="text-[10px] text-text-muted text-center py-1">
              No agents registered
            </p>
          )}
        </div>
      )}
    </div>
  )
}
