import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Chip } from '@heroui/react'
import type { Negotiation } from '@/lib/types'
import { cnm } from '@/utils/style'

interface NegotiationFeedProps {
  negotiations: Array<Negotiation>
  agentAName: string
  agentBName: string
}

export default function NegotiationFeed({
  negotiations,
  agentAName,
  agentBName,
}: NegotiationFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [negotiations.length])

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1">
      <AnimatePresence initial={false}>
        {negotiations.map((msg) => {
          const isAgentA = msg.agentName === agentAName
          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={cnm(
                'flex flex-col gap-1 max-w-[85%]',
                isAgentA ? 'self-start items-start' : 'self-end items-end',
              )}
            >
              <div className="flex items-center gap-2">
                <Chip
                  size="sm"
                  variant="bordered"
                  className={cnm(
                    'text-xs',
                    isAgentA
                      ? 'border-cooperate text-cooperate'
                      : 'border-defect text-defect',
                  )}
                >
                  {msg.agentName}
                </Chip>
                <span className="text-xs text-text-muted">T{msg.turn}</span>
                <span className="text-[9px] text-tee/60 uppercase tracking-wider">
                  via AXL
                </span>
              </div>
              <div
                className={cnm(
                  'px-3 py-2 border text-xs text-text-secondary leading-relaxed rounded-xl',
                  isAgentA
                    ? 'bg-panel border-cooperate/20'
                    : 'bg-panel border-defect/20',
                )}
              >
                {msg.message}
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
      <div ref={bottomRef} />
    </div>
  )
}

