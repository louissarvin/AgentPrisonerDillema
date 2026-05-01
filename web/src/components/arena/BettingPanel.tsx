import { useEffect, useState } from 'react'
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { Spinner } from '@heroui/react'
import type { OutcomeValue } from '@/lib/abis'
import { Outcome, bettingPoolAbi, erc20Abi } from '@/lib/abis'
import { config } from '@/config'
import { cnm } from '@/utils/style'

const USDC_ADDRESS = '0x31d0220469e10c4E71834a79b1f276d740d3768F' as const
const USDC_DECIMALS = 6

interface BettingPanelProps {
  matchId: string
  currentRound: number
}

type OutcomeKey = 'BOTH_COOPERATE' | 'BOTH_DEFECT' | 'MIXED'

const OUTCOME_META: Record<
  OutcomeKey,
  {
    label: string
    value: OutcomeValue
    colorClass: string
    borderClass: string
    bgClass: string
  }
> = {
  BOTH_COOPERATE: {
    label: 'Cooperate',
    value: Outcome.BOTH_COOPERATE,
    colorClass: 'text-cooperate',
    borderClass: 'border-cooperate',
    bgClass: 'bg-cooperate/8',
  },
  BOTH_DEFECT: {
    label: 'Defect',
    value: Outcome.BOTH_DEFECT,
    colorClass: 'text-defect',
    borderClass: 'border-defect',
    bgClass: 'bg-defect/8',
  },
  MIXED: {
    label: 'Mixed',
    value: Outcome.MIXED,
    colorClass: 'text-tee',
    borderClass: 'border-tee',
    bgClass: 'bg-tee/8',
  },
}

function formatUsdc(raw: bigint): string {
  const n = Number(raw) / 10 ** USDC_DECIMALS
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toFixed(2)
}

function toUsdcUnits(amount: string): bigint {
  const n = parseFloat(amount)
  if (isNaN(n) || n <= 0) return 0n
  return BigInt(Math.round(n * 10 ** USDC_DECIMALS))
}

function parseMatchId(id: string): bigint | null {
  try {
    return BigInt(id)
  } catch {
    return null
  }
}

export default function BettingPanel({
  matchId,
  currentRound,
}: BettingPanelProps) {
  const [mounted, setMounted] = useState(false)
  const [selectedOutcome, setSelectedOutcome] = useState<OutcomeKey | null>(
    null,
  )
  const [amount, setAmount] = useState('10')

  useEffect(() => {
    setMounted(true)
  }, [])

  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain()
  const isWrongChain = chainId !== config.contracts.bettingChainId

  const matchIdBigInt = parseMatchId(matchId)
  const roundBigInt = BigInt(currentRound)
  const amountUnits = toUsdcUnits(amount)
  const bettingPoolAddress = config.contracts.bettingPool as `0x${string}`
  const isNumericMatchId = matchIdBigInt !== null

  const { data: roundData, refetch: refetchRound } = useReadContract({
    address: bettingPoolAddress,
    abi: bettingPoolAbi,
    functionName: 'getRound',
    args: isNumericMatchId ? [matchIdBigInt, roundBigInt] : undefined,
    query: { enabled: isNumericMatchId },
  })

  const { data: totalPool, refetch: refetchPool } = useReadContract({
    address: bettingPoolAddress,
    abi: bettingPoolAbi,
    functionName: 'getTotalPool',
    args: isNumericMatchId ? [matchIdBigInt, roundBigInt] : undefined,
    query: { enabled: isNumericMatchId },
  })

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, bettingPoolAddress] : undefined,
    query: { enabled: !!address },
  })

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  const selectedOutcomeValue = selectedOutcome
    ? OUTCOME_META[selectedOutcome].value
    : null
  const { data: userBet, refetch: refetchUserBet } = useReadContract({
    address: bettingPoolAddress,
    abi: bettingPoolAbi,
    functionName: 'getUserBet',
    args:
      address && isNumericMatchId && selectedOutcomeValue !== null
        ? [matchIdBigInt, roundBigInt, address, selectedOutcomeValue as number]
        : undefined,
    query: {
      enabled: !!address && isNumericMatchId && selectedOutcomeValue !== null,
    },
  })

  const {
    writeContract: approveWrite,
    data: approveTxHash,
    isPending: approveIsPending,
  } = useWriteContract()
  const { isLoading: approveConfirming, isSuccess: approveSuccess } =
    useWaitForTransactionReceipt({ hash: approveTxHash })

  const {
    writeContract: placeBetWrite,
    data: betTxHash,
    isPending: betIsPending,
  } = useWriteContract()
  const { isLoading: betConfirming, isSuccess: betSuccess } =
    useWaitForTransactionReceipt({ hash: betTxHash })

  const {
    writeContract: claimWrite,
    data: claimTxHash,
    isPending: claimIsPending,
    error: claimError,
  } = useWriteContract()
  const { isLoading: claimConfirming, isSuccess: claimSuccess } =
    useWaitForTransactionReceipt({ hash: claimTxHash })

  const [claimErrorMsg, setClaimErrorMsg] = useState<string | null>(null)

  const prevRoundBigInt = currentRound > 1 ? roundBigInt - 1n : null
  const { data: prevRoundData, refetch: refetchPrevRound } = useReadContract({
    address: bettingPoolAddress,
    abi: bettingPoolAbi,
    functionName: 'getRound',
    args:
      isNumericMatchId && prevRoundBigInt !== null
        ? [matchIdBigInt, prevRoundBigInt]
        : undefined,
    query: { enabled: isNumericMatchId && prevRoundBigInt !== null },
  })

  useEffect(() => {
    if (approveSuccess) refetchAllowance()
  }, [approveSuccess, refetchAllowance])

  useEffect(() => {
    if (betSuccess) {
      refetchRound()
      refetchPool()
      refetchUserBet()
    }
  }, [betSuccess, refetchRound, refetchPool, refetchUserBet])

  useEffect(() => {
    if (claimSuccess) {
      refetchRound()
      refetchPool()
      refetchPrevRound()
    }
  }, [claimSuccess, refetchRound, refetchPool, refetchPrevRound])

  useEffect(() => {
    if (!claimError) return
    // 0x969bf728 = NothingToClaim()
    const msg = claimError.message?.includes('0x969bf728')
      ? 'No winnings to claim'
      : claimError.message?.includes('AlreadyClaimed')
        ? 'Already claimed'
        : claimError.message?.includes('RoundNotSettled')
          ? 'Round not settled yet'
          : 'Claim failed'
    setClaimErrorMsg(msg)
    const t = setTimeout(() => setClaimErrorMsg(null), 5000)
    return () => clearTimeout(t)
  }, [claimError])

  const needsApproval =
    allowance !== undefined && amountUnits > 0n && allowance < amountUnits
  const isSettled = roundData?.settled ?? false
  const isCancelled = roundData?.cancelled ?? false

  const poolCooperate = roundData?.poolCooperate ?? 0n
  const poolDefect = roundData?.poolDefect ?? 0n
  const poolMixed = roundData?.poolMixed ?? 0n
  const poolTotal = poolCooperate + poolDefect + poolMixed

  function getPct(pool: bigint): string {
    if (poolTotal === 0n) return '0'
    return ((Number(pool) / Number(poolTotal)) * 100).toFixed(0)
  }

  function handleApprove() {
    // Approve max so user only needs to approve once
    const MAX_UINT256 = 2n ** 256n - 1n
    approveWrite({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [bettingPoolAddress, MAX_UINT256],
    })
  }

  function handlePlaceBet() {
    if (!selectedOutcome || !isNumericMatchId) return
    placeBetWrite({
      address: bettingPoolAddress,
      abi: bettingPoolAbi,
      functionName: 'placeBet',
      args: [
        matchIdBigInt,
        roundBigInt,
        OUTCOME_META[selectedOutcome].value as number,
        amountUnits,
      ],
    })
  }

  function handleClaim(roundNumber: bigint) {
    if (!isNumericMatchId) return
    claimWrite({
      address: bettingPoolAddress,
      abi: bettingPoolAbi,
      functionName: 'claimWinnings',
      args: [matchIdBigInt, roundNumber],
    })
  }

  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    if (/^\d*\.?\d{0,2}$/.test(val)) setAmount(val)
  }

  if (!mounted) return null

  // Fallback states
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-6 gap-2">
        <p className="text-xs text-text-muted">Connect wallet to place bets</p>
      </div>
    )
  }

  if (isWrongChain) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <p className="text-[11px] text-text-muted">Wrong network</p>
        <button
          onClick={() =>
            switchChain({ chainId: config.contracts.bettingChainId })
          }
          disabled={isSwitchingChain}
          className="w-full py-2 rounded-xl border border-cooperate text-[11px] font-medium text-cooperate hover:bg-cooperate/8 bg-transparent transition-all duration-150 disabled:opacity-40"
        >
          {isSwitchingChain ? 'Switching...' : 'Switch to Unichain'}
        </button>
      </div>
    )
  }

  if (!isNumericMatchId) {
    return (
      <div className="flex flex-col items-center justify-center py-6">
        <p className="text-xs text-text-muted">Waiting for on-chain match...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          Place Bet
        </span>
        <span className="text-[10px] text-text-muted">
          Round {currentRound}
        </span>
      </div>

      {/* Outcome buttons */}
      <div className="flex gap-1.5">
        {(Object.keys(OUTCOME_META) as Array<OutcomeKey>).map((key) => {
          const meta = OUTCOME_META[key]
          const isSelected = selectedOutcome === key
          const poolMap: Record<OutcomeKey, bigint> = {
            BOTH_COOPERATE: poolCooperate,
            BOTH_DEFECT: poolDefect,
            MIXED: poolMixed,
          }
          return (
            <button
              key={key}
              onClick={() => setSelectedOutcome(key)}
              className={cnm(
                'flex-1 flex flex-col items-center py-2 rounded-xl border transition-all duration-150 cursor-pointer',
                isSelected
                  ? `${meta.borderClass} ${meta.bgClass}`
                  : 'border-border hover:border-border-hover bg-surface',
              )}
            >
              <span
                className={cnm(
                  'text-[10px] font-semibold uppercase leading-tight',
                  isSelected ? meta.colorClass : 'text-text-secondary',
                )}
              >
                {meta.label}
              </span>
              <span
                className={cnm(
                  'text-[10px] leading-tight',
                  isSelected ? meta.colorClass : 'text-text-muted',
                )}
              >
                {getPct(poolMap[key])}%
              </span>
            </button>
          )
        })}
      </div>

      {/* Amount input */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={handleAmountChange}
            placeholder="0.00"
            className="flex-1 bg-surface border border-border rounded-xl px-3 py-2 text-xs text-text-primary placeholder:text-text-ghost focus:outline-none focus:border-cooperate/40 transition-colors"
          />
          <span className="text-[10px] text-text-muted shrink-0">USDC</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-muted">
            Pool: {totalPool !== undefined ? formatUsdc(totalPool) : '0.00'}
          </span>
          {usdcBalance !== undefined && (
            <span className="text-[10px] text-text-muted">
              Bal: {formatUsdc(usdcBalance)}
            </span>
          )}
        </div>
      </div>

      {/* Action button */}
      <div className="flex flex-col gap-1">
        {isSettled ? (
          <button
            onClick={() => handleClaim(roundBigInt)}
            disabled={claimIsPending || claimConfirming}
            className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl border border-cooperate/60 text-[11px] font-medium text-cooperate hover:bg-cooperate/8 bg-transparent transition-all duration-150 disabled:opacity-40"
          >
            {(claimIsPending || claimConfirming) && (
              <Spinner size="sm" color="success" />
            )}
            {claimConfirming
              ? 'Confirming...'
              : claimIsPending
                ? 'Claiming...'
                : 'Claim Winnings'}
          </button>
        ) : isCancelled ? (
          <div className="py-2 text-center">
            <span className="text-[10px] text-text-muted">Round Cancelled</span>
          </div>
        ) : needsApproval ? (
          <button
            onClick={handleApprove}
            disabled={
              approveIsPending || approveConfirming || amountUnits === 0n
            }
            className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl border border-border-strong text-[11px] font-medium text-text-secondary hover:text-text-primary bg-surface transition-all duration-150 disabled:opacity-40"
          >
            {(approveIsPending || approveConfirming) && (
              <Spinner size="sm" color="default" />
            )}
            {approveConfirming
              ? 'Confirming...'
              : approveIsPending
                ? 'Approving...'
                : 'Approve USDC'}
          </button>
        ) : (
          <button
            onClick={handlePlaceBet}
            disabled={
              !selectedOutcome ||
              betIsPending ||
              betConfirming ||
              amountUnits === 0n
            }
            className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl border border-cooperate text-[11px] font-medium text-cooperate hover:bg-cooperate/8 bg-transparent shadow-[0px_0px_14px_rgba(0,217,146,0.10)] hover:shadow-[0px_0px_20px_rgba(0,217,146,0.2)] transition-all duration-150 disabled:opacity-40"
          >
            {(betIsPending || betConfirming) && (
              <Spinner size="sm" color="success" />
            )}
            {betConfirming
              ? 'Confirming...'
              : betIsPending
                ? 'Placing...'
                : 'Place Bet'}
          </button>
        )}
        {betSuccess && (
          <span className="text-[9px] text-cooperate text-center">
            Bet placed!
          </span>
        )}
        {claimSuccess && (
          <span className="text-[9px] text-cooperate text-center">
            Claimed!
          </span>
        )}
        {claimErrorMsg && (
          <span className="text-[9px] text-red-400 text-center">
            {claimErrorMsg}
          </span>
        )}
        {userBet !== undefined && userBet > 0n && selectedOutcome && (
          <span className="text-[9px] text-text-muted text-center">
            Your bet: {formatUsdc(userBet)} USDC
          </span>
        )}
      </div>

      {/* Previous round claim section */}
      {prevRoundBigInt !== null && prevRoundData?.settled && (
        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          <span className="text-[10px] text-text-muted">
            Round {currentRound - 1} settled
          </span>
          <button
            onClick={() => handleClaim(prevRoundBigInt)}
            disabled={claimIsPending || claimConfirming}
            className="px-3 py-1.5 rounded-lg border border-cooperate/40 text-[10px] font-medium text-cooperate hover:bg-cooperate/8 bg-transparent transition-all duration-150 disabled:opacity-40"
          >
            {(claimIsPending || claimConfirming) && (
              <Spinner size="sm" color="success" className="mr-1" />
            )}
            Claim
          </button>
        </div>
      )}
    </div>
  )
}

