import { useState } from 'react'
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { arcTestnet } from 'viem/chains'
import { Check, ExternalLink, Loader2 } from 'lucide-react'
import { buildTxExplorerUrl, getUsdc } from '@/onchain-facts'
import { AmountError, parseAmount } from '@/onchain-money'
import { CLAIM_RECEIVER } from '@/lib/receiver'

/**
 * Funds the receiver with an ERC-20 USDC transfer from the connected wallet. A plain native send
 * to the receiver reverts on purpose (it has no receive function), so this is the supported path.
 */
export function FundPool() {
  const { isConnected, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash, chainId: arcTestnet.id })
  const [amount, setAmount] = useState('1')

  const usdc = getUsdc(arcTestnet.id)
  const receiver = CLAIM_RECEIVER
  if (!receiver || !usdc) return null

  let raw: bigint | null = null
  try {
    const parsed = parseAmount(arcTestnet.id, amount).raw
    raw = parsed > 0n ? parsed : null
  } catch (err) {
    if (!(err instanceof AmountError)) throw err
  }

  const fund = async () => {
    if (raw === null) return
    reset()
    if (chainId !== arcTestnet.id) await switchChainAsync({ chainId: arcTestnet.id })
    await writeContractAsync({
      address: usdc.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [receiver, raw],
      chainId: arcTestnet.id,
    })
  }

  const rejected = error?.message.toLowerCase().includes('user rejected')
  const busy = isPending || confirming

  return (
    <section className="rounded-3xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Fund the X completion pool</div>
      <div className="mt-2 flex items-center gap-2">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            const v = e.target.value
            if (v === '' || /^\d*\.?\d{0,6}$/.test(v)) setAmount(v)
          }}
          className="min-h-11 w-24 rounded-2xl border bg-white/80 px-3 text-sm tabular-nums outline-none focus:border-[var(--focus)]"
          style={{ borderColor: 'var(--border)' }}
          aria-label="USDC amount"
        />
        <span className="text-sm" style={{ color: 'var(--subtle)' }}>USDC</span>
        <button
          onClick={() => void fund().catch(() => undefined)}
          disabled={!isConnected || raw === null || busy}
          className="ml-auto flex min-h-11 items-center gap-2 rounded-2xl px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {isPending ? 'Confirm in wallet...' : confirming ? 'Confirming...' : isConnected ? 'Fund pool' : 'Connect wallet first'}
        </button>
      </div>
      {isSuccess && hash ? (
        <a
          href={buildTxExplorerUrl(arcTestnet.id, hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold"
          style={{ color: 'var(--success)' }}
        >
          <Check className="size-3" /> Funded. View transaction <ExternalLink className="size-3" />
        </a>
      ) : null}
      {error && !rejected ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>The transfer failed. Check your USDC balance and try again.</p>
      ) : null}
      <p className="mt-2 text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
        Optional Arc Testnet transfer to the existing receiver. Each claim pays up to 5 USDC based on unique video views and completion rate, subject to the receiver budget and per-claim cap.
      </p>
    </section>
  )
}
