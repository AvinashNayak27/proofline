import { RuleSummary } from '@/components/campaigns/RuleSummary'
import { Usdc } from '@/components/campaigns/Usdc'
import type { CampaignInput } from '@/lib/proofline/campaignForm'
import type { Campaign } from '@/lib/proofline/events'
import { count } from '@/lib/proofline/format'

/** How the campaign will look to creators, built from the form as it is filled in. */
export function CampaignPreview({ input, deposit, brand }: { input: CampaignInput; deposit: bigint; brand: `0x${string}` }) {
  const draft: Campaign = {
    id: 0n,
    brand,
    ...input,
    deposit,
    txHash: '0x',
    status: 1,
    deposited: deposit,
    paid: 0n,
    withdrawn: 0n,
    remaining: deposit,
    phase: 'live',
  }
  const posts = input.maxPerPost > 0n ? deposit / input.maxPerPost : 0n
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="pl-eyebrow">{input.brandName || 'Your brand'}</p>
        <h3 className="display text-balance text-2xl font-bold">{input.title || 'Your campaign title'}</h3>
        {input.brief ? <p className="line-clamp-4 whitespace-pre-line text-pretty text-sm" style={{ color: 'var(--muted)' }}>{input.brief}</p> : null}
      </div>
      <RuleSummary campaign={draft} />
      <div className="pl-inner space-y-1 px-4 py-3 text-sm">
        <p><span className="font-semibold"><Usdc amount={deposit} /></span> funds about <span className="font-semibold tabular-nums">{count(posts)}</span> posts at the per-post cap.</p>
        <p style={{ color: 'var(--muted)' }}>Unspent budget is refundable to your wallet when you close the campaign.</p>
      </div>
    </div>
  )
}
