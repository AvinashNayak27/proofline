import { ConnectKitButton } from 'connectkit'
import { Wallet } from 'lucide-react'
import { useMemo } from 'react'
import { useAccount } from 'wagmi'
import { RewardsList } from '@/components/campaigns/RewardsList'
import { Usdc } from '@/components/campaigns/Usdc'
import { Button, LinkButton } from '@/components/ui/Button'
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback'
import { Stat } from '@/components/ui/Stat'
import { useRewards } from '@/hooks/useProofline'
import { PROOFLINE_CONTRACT } from '@/lib/proofline/config'
import { count } from '@/lib/proofline/format'

export function Rewards() {
  const { address, isConnected } = useAccount()
  const { data, isPending, isError } = useRewards()
  const mine = useMemo(() => (data ?? []).filter((r) => address && r.recipient.toLowerCase() === address.toLowerCase()), [data, address])
  const total = mine.reduce((sum, r) => sum + r.amount, 0n)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="pl-eyebrow">For creators</p>
        <h1 className="display text-4xl font-bold">My rewards</h1>
        <p style={{ color: 'var(--muted)' }}>Every reward paid to the connected wallet, read straight from Arc Testnet.</p>
      </header>
      {!PROOFLINE_CONTRACT ? <Notice tone="warn" title="Contract address not set">Set VITE_PROOFLINE_CONTRACT to load rewards.</Notice> : null}
      {!isConnected ? (
        <EmptyState
          title="Connect your wallet to see what you earned"
          action={<ConnectKitButton.Custom>{({ show }) => <Button onClick={show} icon={<Wallet className="size-4" aria-hidden />}>Connect wallet</Button>}</ConnectKitButton.Custom>}
        >
          Rewards are paid to the wallet you submit posts with.
        </EmptyState>
      ) : isError ? (
        <Notice tone="danger" title="Could not load rewards">Arc Testnet did not answer. Reload to try again.</Notice>
      ) : isPending ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <section className="pl-card grid grid-cols-2 gap-6 p-6">
            <Stat label="Total earned" value={<Usdc amount={total} />} />
            <Stat label="Posts rewarded" value={count(mine.length)} />
          </section>
          <section className="pl-card space-y-3 p-6">
            <RewardsList rewards={mine} empty="Find a live campaign, post with your code, and your first reward shows up here." />
            {mine.length === 0 ? <div><LinkButton to="/campaigns">Browse campaigns</LinkButton></div> : null}
          </section>
        </>
      )}
    </div>
  )
}
