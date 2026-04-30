import { useEffect, useRef, useState } from 'react'
import {
  useAccount,
  useChainId,
  useSendTransaction,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { Chip, Spinner } from '@heroui/react'
import { ArrowDownUp, Loader2 } from 'lucide-react'
import { config } from '@/config'
import { cnm } from '@/utils/style'

const UNICHAIN_SEPOLIA_ID = 1301
const ETH_ADDRESS = '0x0000000000000000000000000000000000000000'
const USDC_ADDRESS = '0x31d0220469e10c4E71834a79b1f276d740d3768F'
const USDC_DECIMALS = 6
const QUOTE_TTL_MS = 30_000

interface UniswapQuoteResponse {
  requestId: string
  quote: {
    chainId: number
    swapper: string
    input: { token: string; amount: string }
    output: {
      token: string
      amount: string
      recipient: string
      minAmount: string
    }
    slippage: { tolerance: number }
    tradeType: string
    gasFee: string
    gasFeeUSD: string
    gasFeeQuote: string
    gasUseEstimate: string
    routeString: string
    permitData: null | object
    portionBips?: number
    portionAmount?: string
    portionRecipient?: string
    quoteId: string
  }
}

interface UniswapSwapResponse {
  requestId: string
  swap: {
    from: string
    to: string
    data: string
    value: string
    gasLimit: string
    chainId: number
  }
  permitData?: null
  signature?: null
}

type PanelState =
  | { phase: 'idle' }
  | { phase: 'quoting' }
  | { phase: 'quoted'; quote: UniswapQuoteResponse; expiresAt: number }
  | { phase: 'quote_expired' }
  | { phase: 'pending'; txHash: `0x${string}` }
  | { phase: 'success'; txHash: `0x${string}` }
  | { phase: 'error'; message: string }

function formatUsdc(raw: string): string {
  const n = Number(raw) / 10 ** USDC_DECIMALS
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function ethToWei(eth: string): string {
  // Avoid floating-point by splitting at decimal
  const [whole = '0', frac = ''] = eth.split('.')
  const padded = frac.padEnd(18, '0').slice(0, 18)
  const raw = BigInt(whole) * BigInt(10 ** 18) + BigInt(padded || '0')
  return raw.toString()
}

function truncateTx(hash: string): string {
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`
}

export default function SpectatorSwapPanel() {
  const [mounted, setMounted] = useState(false)
  const [ethAmount, setEthAmount] = useState('')
  const [state, setState] = useState<PanelState>({ phase: 'idle' })
  const [countdown, setCountdown] = useState(0)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setMounted(true)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const { sendTransaction, isPending: isSendPending } = useSendTransaction()
  const [txHashForReceipt, setTxHashForReceipt] = useState<
    `0x${string}` | undefined
  >()
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHashForReceipt })

  // Mark success when receipt confirms
  useEffect(() => {
    if (isConfirmed && txHashForReceipt) {
      setState({ phase: 'success', txHash: txHashForReceipt })
    }
  }, [isConfirmed, txHashForReceipt])

  // Countdown timer for quote expiry
  useEffect(() => {
    if (state.phase !== 'quoted') {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }

    const { expiresAt } = state
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
      setCountdown(remaining)
      if (remaining === 0) {
        setState({ phase: 'quote_expired' })
        if (timerRef.current) clearInterval(timerRef.current)
      }
    }

    tick()
    timerRef.current = setInterval(tick, 500)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [state])

  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    // Allow up to 18 decimal places, no negatives
    if (/^\d*\.?\d{0,18}$/.test(val)) {
      setEthAmount(val)
      // Reset any stale quote/error when amount changes
      if (
        state.phase === 'quoted' ||
        state.phase === 'quote_expired' ||
        state.phase === 'error'
      ) {
        setState({ phase: 'idle' })
      }
    }
  }

  async function handleGetQuote() {
    if (!address || !ethAmount || Number(ethAmount) <= 0) return

    setState({ phase: 'quoting' })
    try {
      const amountWei = ethToWei(ethAmount)
      const res = await fetch(`${config.apiUrl}/uniswap/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'EXACT_INPUT',
          amount: amountWei,
          tokenIn: ETH_ADDRESS,
          tokenOut: USDC_ADDRESS,
          tokenInChainId: UNICHAIN_SEPOLIA_ID,
          tokenOutChainId: UNICHAIN_SEPOLIA_ID,
          swapper: address,
          slippageTolerance: 0.5,
        }),
      })

      const json = (await res.json()) as {
        success: boolean
        error?: { message: string }
        data: UniswapQuoteResponse
      }
      if (!json.success) throw new Error(json.error?.message ?? 'Quote failed')

      setState({
        phase: 'quoted',
        quote: json.data,
        expiresAt: Date.now() + QUOTE_TTL_MS,
      })
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Failed to get quote',
      })
    }
  }

  async function handleSwap() {
    if (state.phase !== 'quoted') return

    // Capture quote before state changes
    const quotedState = state
    try {
      const res = await fetch(`${config.apiUrl}/uniswap/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote: quotedState.quote.quote }),
      })

      const json = (await res.json()) as {
        success: boolean
        error?: { message: string }
        data: UniswapSwapResponse
      }
      if (!json.success)
        throw new Error(json.error?.message ?? 'Swap request failed')

      const { swap } = json.data
      sendTransaction(
        {
          to: swap.to as `0x${string}`,
          data: swap.data as `0x${string}`,
          value: BigInt(swap.value),
          gas: BigInt(swap.gasLimit),
          chainId: UNICHAIN_SEPOLIA_ID,
        },
        {
          onSuccess: (hash) => {
            setTxHashForReceipt(hash)
            setState({ phase: 'pending', txHash: hash })
          },
          onError: (err) => {
            setState({ phase: 'error', message: err.message })
          },
        },
      )
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Swap failed',
      })
    }
  }

  function handleReset() {
    setState({ phase: 'idle' })
    setEthAmount('')
    setTxHashForReceipt(undefined)
  }

  if (!mounted) return null

  const onWrongChain = isConnected && chainId !== UNICHAIN_SEPOLIA_ID
  const isLoading = state.phase === 'quoting' || isSendPending || isConfirming

  const hasValidAmount = ethAmount.length > 0 && Number(ethAmount) > 0

  return (
    <div className="bg-panel/60 backdrop-blur-xl border border-border/80 rounded-2xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowDownUp size={11} className="text-tee shrink-0" />
          <span className="text-xs font-medium text-text-secondary uppercase tracking-widest">
            Get USDC
          </span>
        </div>
        <Chip
          size="sm"
          classNames={{
            base: 'border border-tee/30 bg-tee/8 h-4 px-1.5',
            content: 'text-[9px] font-medium text-tee px-0',
          }}
        >
          ETH → USDC
        </Chip>
      </div>

      {!isConnected ? (
        <p className="text-[11px] text-text-muted text-center py-3">
          Connect wallet to swap
        </p>
      ) : onWrongChain ? (
        <div className="flex flex-col gap-2 py-1">
          <p className="text-[10px] text-text-muted text-center">
            Switch to Unichain Sepolia
          </p>
          <button
            onClick={() => switchChain({ chainId: UNICHAIN_SEPOLIA_ID })}
            disabled={isSwitching}
            className="flex items-center justify-center gap-2 w-full py-2 rounded-xl border border-tee/60 text-[11px] font-medium text-tee hover:bg-tee/8 bg-transparent transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSwitching && <Loader2 size={11} className="animate-spin" />}
            {isSwitching ? 'Switching...' : 'Switch Chain'}
          </button>
        </div>
      ) : state.phase === 'success' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 px-2 py-2.5 rounded-xl bg-cooperate/8 border border-cooperate/25">
            <p className="text-[11px] font-medium text-cooperate text-center">
              Swap confirmed
            </p>
            <a
              href={`https://sepolia.uniscan.xyz/tx/${state.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-cooperate/70 font-mono text-center hover:text-cooperate transition-colors"
            >
              {truncateTx(state.txHash)} ↗
            </a>
          </div>
          <button
            onClick={handleReset}
            className="w-full py-2 rounded-xl border border-border text-[11px] text-text-secondary hover:text-text-primary hover:border-border-hover bg-surface transition-all duration-150"
          >
            Swap again
          </button>
        </div>
      ) : (
        <>
          {/* ETH input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-text-muted uppercase tracking-widest">
              Amount (ETH)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={ethAmount}
              onChange={handleAmountChange}
              placeholder="0.0"
              disabled={isLoading}
              className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-ghost focus:outline-none focus:border-border-strong transition-colors disabled:opacity-50"
            />
          </div>

          {/* Quote result */}
          {state.phase === 'quoted' && (
            <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl bg-surface border border-border">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-muted">You receive</span>
                <span className="text-[11px] font-semibold font-mono text-text-primary">
                  {formatUsdc(state.quote.quote.output.amount)} USDC
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-muted">Gas (USD)</span>
                <span className="text-[10px] font-mono text-text-secondary">
                  ~${Number(state.quote.quote.gasFeeUSD).toFixed(4)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-muted">
                  Min received
                </span>
                <span className="text-[10px] font-mono text-text-secondary">
                  {formatUsdc(state.quote.quote.output.minAmount)} USDC
                </span>
              </div>
              <div className="flex items-center justify-between pt-0.5 border-t border-border">
                <span className="text-[10px] text-text-muted">Expires in</span>
                <span
                  className={cnm(
                    'text-[10px] font-mono tabular-nums',
                    countdown <= 5 ? 'text-defect' : 'text-text-secondary',
                  )}
                >
                  {countdown}s
                </span>
              </div>
            </div>
          )}

          {state.phase === 'quote_expired' && (
            <p className="text-[10px] text-defect text-center">
              Quote expired. Fetch a new one.
            </p>
          )}

          {state.phase === 'error' && (
            <p className="text-[10px] text-defect text-center leading-tight px-1">
              {state.message}
            </p>
          )}

          {/* Pending tx hash */}
          {state.phase === 'pending' && (
            <div className="flex items-center justify-center gap-1.5">
              <Spinner size="sm" color="default" />
              <a
                href={`https://sepolia.uniscan.xyz/tx/${state.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-mono text-text-muted hover:text-text-secondary transition-colors"
              >
                {truncateTx(state.txHash)} ↗
              </a>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            {state.phase !== 'quoted' ? (
              <button
                onClick={handleGetQuote}
                disabled={
                  !hasValidAmount ||
                  state.phase === 'quoting' ||
                  state.phase === 'pending' ||
                  isSendPending ||
                  isConfirming
                }
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-border-strong text-[11px] font-medium text-text-secondary hover:text-text-primary hover:border-border-hover bg-surface transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {state.phase === 'quoting' && (
                  <Loader2 size={11} className="animate-spin" />
                )}
                {state.phase === 'quoting' ? 'Getting quote...' : 'Get Quote'}
              </button>
            ) : (
              <button
                onClick={handleSwap}
                disabled={countdown === 0 || isSendPending}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-tee text-[11px] font-medium text-tee hover:bg-tee/8 bg-transparent shadow-[0px_0px_14px_rgba(167,139,250,0.10)] hover:shadow-[0px_0px_20px_rgba(167,139,250,0.2)] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSendPending && (
                  <Loader2 size={11} className="animate-spin" />
                )}
                {isSendPending ? 'Confirm in wallet...' : 'Swap'}
              </button>
            )}
          </div>
        </>
      )}

      {/* Footer */}
      <p className="text-[9px] text-text-ghost text-center pt-0.5">
        Powered by Uniswap Trading API
      </p>
    </div>
  )
}
