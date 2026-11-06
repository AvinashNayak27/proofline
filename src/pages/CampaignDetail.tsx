import { ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PayoutCalculator } from '@/components/campaigns/PayoutCalculator'
import { RewardsList } from '@/components/campaigns/RewardsList'
import { RuleSummary } from '@/components/campaigns/RuleSummary'
import { ShareButton } from '@/components/campaigns/ShareButton'
import { StatusBadge } from '@/components/campaigns/StatusBadge'
import { Usdc } from '@/components/campaigns/Usdc'
import { ParticipatePanel } from '@/components/participate/ParticipatePanel'
import { EmptyState, Notice, ProgressBar, Skeleton } from '@/components/ui/Feedback'
import { Stat } from '@/components/ui/Stat'
import { useNow } from '@/hooks/useNow'
import { useCampaign, useRewards } from '@/hooks/useProofline'
import { dateLabel, shortAddress, timeLeft } from '@/lib/proofline/format'

const safeLink = (link: string): string | null => (/^https:\/\/[^\s]+$/.test(link) ? link : null)

export function CampaignDetail() {
  const { id } = useParams()
  const campaignId = id && /^[1-9][0-9]{0,17}$/.test(id) ? BigInt(id) : null
  const now = useNow()
  const { campaign, isPending, isError } = useCampaign(campaignId)
  const rewards = useRewards()
  const mine = useMemo(() => (rewards.data ?? []).filter((r) => r.campaignId === campaignId), [rewards.data, campaignId])

  if (campaignId === null) return <EmptyState title="Campaign not found" action={<Link to="/campaigns" className="pl-link">Back to campaigns</Link>} />
  if (isError) return <Notice tone="danger" title="Could not load this campaign">Arc Testnet did not answer. Reload the page to try again.</Notice>
  if (isPending) return <div className="grid gap-6 lg:grid-cols-[1fr_26rem]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
  if (!campaign) return <EmptyState title="Campaign not found" action={<Link to="/campaigns" className="pl-link">Back to campaigns</Link>}>No campaign with that number exists on this contract.</EmptyState>

  const spent = campaign.deposited === 0n ? 0 : Number((campaign.paid * 10_000n) / campaign.deposited) / 100
  const site = safeLink(campaign.link)

  return (
    <div className="space-y-6">
      <Link to="/campaigns" className="pl-link text-sm">← All campaigns</Link>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_26rem]">
        <div className="space-y-6">
          <section className="pl-card space-y-5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="pl-eyebrow">{campaign.brandName || 'Independent brand'} · by <span className="mono">{shortAddress(campaign.brand)}</span></p>
                <h1 className="display text-balance text-3xl font-bold sm:text-4xl">{campaign.title}</h1>
              </div>
              <div className="flex items-center gap-2"><StatusBadge phase={campaign.phase} /><ShareButton path={`/campaigns/${campaign.id}`} /></div>
            </div>
            <p className="max-w-prose whitespace-pre-line text-pretty" style={{ color: 'var(--ink-2)' }}>{campaign.brief || 'The brand did not add a brief.'}</p>
            {site ? <a href={site} target="_blank" rel="noopener noreferrer nofollow" className="pl-link inline-flex items-center gap-1 text-sm">Brand website <ExternalLink className="size-3.5" aria-hidden /></a> : null}
            <div className="grid grid-cols-3 gap-4 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
              <Stat label="Remaining" value={<Usdc amount={campaign.remaining} />} />
              <Stat label="Paid out" value={<Usdc amount={campaign.paid} />} />
              <Stat label="Funded" value={<Usdc amount={campaign.deposited} />} />
            </div>
            <ProgressBar value={spent} label="Share of the campaign budget already paid out" />
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {dateLabel(campaign.startsAt)} to {dateLabel(campaign.endsAt)} · {timeLeft(campaign.endsAt, now)}
            </p>
          </section>

          <section className="pl-card space-y-2 p-6">
            <h2 className="display text-xl font-bold">Payout rules</h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Set by the brand when it funded the campaign and enforced by the contract. They cannot change.</p>
            <RuleSummary campaign={campaign} />
          </section>

          <section className="pl-card space-y-3 p-6">
            <h2 className="display text-xl font-bold">What would a post earn?</h2>
            <PayoutCalculator campaign={campaign} />
          </section>

          <section className="pl-card space-y-3 p-6">
            <h2 className="display text-xl font-bold">Rewards paid</h2>
            {rewards.isPending ? <Skeleton className="h-24" /> : <RewardsList rewards={mine} empty="Be the first creator to earn from this campaign." />}
          </section>
        </div>

        <aside className="pl-card space-y-4 p-6 lg:sticky lg:top-28">
          <div className="space-y-1">
            <h2 className="display text-2xl font-bold">Earn from this campaign</h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Four steps. You are paid the moment your post is verified.</p>
          </div>
          <ParticipatePanel campaign={campaign} />
        </aside>
      </div>
    </div>
  )
}
