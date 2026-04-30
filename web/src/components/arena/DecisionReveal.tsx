import { AnimatePresence, motion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'
import type { Move } from '@/lib/types'
import { cnm } from '@/utils/style'

interface DecisionRevealProps {
  moveA: Move | null
  moveB: Move | null
  payoffA: number
  payoffB: number
  revealed: boolean
}

function MoveCard({
  move,
  revealed,
  label,
}: {
  move: Move | null
  revealed: boolean
  label: string
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-text-muted uppercase tracking-widest">
        {label}
      </span>
      <div className="relative w-14 h-14" style={{ perspective: 400 }}>
        <AnimatePresence mode="wait">
          {!revealed || move === null ? (
            <motion.div
              key="hidden"
              initial={{ rotateY: 0 }}
              exit={{ rotateY: 90 }}
              transition={{ duration: 0.15, ease: 'easeIn' }}
              className="absolute inset-0 bg-panel border border-border-strong flex items-center justify-center rounded-xl"
            >
              <span className="text-2xl text-text-muted">?</span>
            </motion.div>
          ) : (
            <motion.div
              key="revealed"
              initial={{ rotateY: -90 }}
              animate={{ rotateY: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={cnm(
                'absolute inset-0 flex items-center justify-center border rounded-xl',
                move === 'COOPERATE'
                  ? 'bg-cooperate/10 border-cooperate shadow-[0_0_12px_rgba(0,217,146,0.15)]'
                  : 'bg-defect/10 border-defect shadow-[0_0_12px_rgba(255,107,53,0.15)]',
              )}
            >
              <span
                className={cnm(
                  'text-[10px] font-bold tracking-widest',
                  move === 'COOPERATE' ? 'text-cooperate' : 'text-defect',
                )}
              >
                {move === 'COOPERATE' ? 'COOP' : 'DFCT'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default function DecisionReveal({
  moveA,
  moveB,
  payoffA,
  payoffB,
  revealed,
}: DecisionRevealProps) {
  return (
    <div className="flex items-center gap-4 w-full justify-center">
      <MoveCard move={moveA} revealed={revealed} label="Agent A" />

      <div className="flex flex-col items-center gap-1.5">
        {/* TEE badge */}
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-tee/25 bg-tee/5">
          <ShieldCheck size={9} className="text-tee shrink-0" />
          <span className="text-[9px] font-medium text-tee tracking-wide">
            TEE
          </span>
        </div>
        <span className="text-text-muted/60 text-xs">VS</span>
        {/* Payoffs inline */}
        <AnimatePresence>
          {revealed && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, delay: 0.25 }}
              className="flex gap-2"
            >
              <span
                className={cnm(
                  'text-sm font-bold',
                  payoffA >= 0 ? 'text-cooperate' : 'text-defect',
                )}
              >
                {payoffA >= 0 ? '+' : ''}
                {payoffA}
              </span>
              <span className="text-text-muted/40 text-sm">/</span>
              <span
                className={cnm(
                  'text-sm font-bold',
                  payoffB >= 0 ? 'text-cooperate' : 'text-defect',
                )}
              >
                {payoffB >= 0 ? '+' : ''}
                {payoffB}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <MoveCard move={moveB} revealed={revealed} label="Agent B" />
    </div>
  )
}
