import { useReadContracts } from 'wagmi'
import { erc20Abi } from 'viem'
import { arcTestnet } from 'viem/chains'
import { getUsdc, buildAddressExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import { CLAIM_RECEIVER, receiverAbi } from '@/lib/receiver'

/** Live reads of the receiver: its USDC balance (ERC-20 view), lifetime paid and budget. */
export function RewardPool() {
  const usdc = getUsdc(arcTestnet.id)
  const enabled = Boolean(CLAIM_RECEIVER && usdc)
  const { data, isLoading } = useReadContracts({
    allowFailure: false,
    query: { enabled, refetchInterval: 10_000 },
    contracts:
      CLAIM_RECEIVER && usdc
        ? [
            { address: usdc.address as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [CLAIM_RECEIVER], chainId: arcTestnet.id },
            { address: CLAIM_RECEIVER, abi: receiverAbi, functionName: 'totalPaid', chainId: arcTestnet.id },
            { address: CLAIM_RECEIVER, abi: receiverAbi, functionName: 'maxRewardBudget', chainId: arcTestnet.id },
            { address: CLAIM_RECEIVER, abi: receiverAbi, functionName: 'paused', chainId: arcTestnet.id },
          ]
        : [],
  })

  if (!CLAIM_RECEIVER) {
    return (
      <p className="text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
        Set VITE_CLAIM_RECEIVER to the existing ArcClaimReceiver address to see its live USDC pool.
      </p>
    )
  }

  const [balance, paid, budget, paused] = data ?? []
  return (
    <section className="rounded-3xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>X completion reward pool (USDC)</span>
        <a
          href={buildAddressExplorerUrl(arcTestnet.id, CLAIM_RECEIVER)}
          target="_blank"
          rel="noopener noreferrer"
          className="mono text-[11px]"
          style={{ color: 'var(--accent-hover)' }}
        >
          {CLAIM_RECEIVER.slice(0, 6)}...{CLAIM_RECEIVER.slice(-4)}
        </a>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="display text-3xl font-bold tabular-nums">{isLoading || balance === undefined ? '...' : formatUsdc(balance)}</span>
        <span className="text-sm" style={{ color: 'var(--subtle)' }}>USDC</span>
      </div>
      <p className="mt-1 text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
        {paid === undefined || budget === undefined
          ? 'Reading budget...'
          : `${formatUsdc(paid)} paid of ${formatUsdc(budget)} budget${paused ? ' · claims paused' : ''}`}
      </p>
    </section>
  )
}
