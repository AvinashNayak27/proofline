import { ConnectKitButton } from 'connectkit'
import { Wallet } from 'lucide-react'
import { useMemo } from 'react'
import { useAccount } from 'wagmi'
import { ManagedCampaign } from '@/components/brand/ManagedCampaign'
import { Usdc } from '@/components/campaigns/Usdc'
import { Button, LinkButton } from '@/components/ui/Button'
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback'
import { Stat } from '@/components/ui/Stat'
import { useCampaigns, useRewards } from '@/hooks/useProofline'
import { PROOFLINE_CONTRACT } from '@/lib/proofline/config'
import { count } from '@/lib/proofline/format'

export function Dashboard() {
  const { address, isConnected } = useAccount()
  const campaigns = useCampaigns()
  const rewards = useRewards()

  const mine = useMemo(() => (campaigns.data ?? []).filter((c) => address && c.brand.toLowerCase() === address.toLowerCase()), [campaigns.data, address])
  const rewardsFor = (id: bigint) => (rewards.data ?? []).filter((r) => r.campaignId === id)
  const totals = mine.reduce((t, c) => ({ funded: t.funded + c.deposited, paid: t.paid + c.paid, left: t.left + c.remaining }), { funded: 0n, paid: 0n, left: 0n })
  const posts = mine.reduce((n, c) => n + rewardsFor(c.id).length, 0)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="pl-eyebrow">For brands</p>
          <h1 className="display text-4xl font-bold">Brand dashboard</h1>
          <p style={{ color: 'var(--muted)' }}>Your campaigns, what they have paid, and the controls only your wallet has.</p>
        </div>
        <LinkButton to="/create">Launch a campaign</LinkButton>
      </header>

      {!PROOFLINE_CONTRACT ? <Notice tone="warn" title="Contract address not set">Set VITE_PROOFLINE_CONTRACT to load your campaigns.</Notice> : null}

      {!isConnected ? (
        <EmptyState
          title="Connect the wallet you launched campaigns from"
          action={<ConnectKitButton.Custom>{({ show }) => <Button onClick={show} icon={<Wallet className="size-4" aria-hidden />}>Connect wallet</Button>}</ConnectKitButton.Custom>}
        >
          Campaigns belong to the wallet that created them, so your dashboard follows it.
        </EmptyState>
      ) : campaigns.isError ? (
        <Notice tone="danger" title="Could not load your campaigns">Arc Testnet did not answer. Reload to try again.</Notice>
      ) : campaigns.isPending ? (
        <Skeleton className="h-64" />
      ) : mine.length === 0 ? (
        <EmptyState title="No campaigns from this wallet yet" action={<LinkButton to="/create">Launch your first campaign</LinkButton>}>
          Fund a budget, set the rules, and creators can start earning.
        </EmptyState>
      ) : (
        <>
          <section className="pl-card grid grid-cols-2 gap-6 p-6 lg:grid-cols-4">
            <Stat label="Campaigns" value={count(mine.length)} />
            <Stat label="Funded" value={<Usdc amount={totals.funded} />} />
            <Stat label="Paid to creators" value={<Usdc amount={totals.paid} />} sub={`${count(posts)} posts`} />
            <Stat label="Still in escrow" value={<Usdc amount={totals.left} />} />
          </section>
          <div className="grid gap-4 xl:grid-cols-2">
            {mine.map((c) => <ManagedCampaign key={String(c.id)} campaign={c} rewards={rewardsFor(c.id)} />)}
          </div>
        </>
      )}
    </div>
  )
}
